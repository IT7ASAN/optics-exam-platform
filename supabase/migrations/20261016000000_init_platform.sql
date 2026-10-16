-- Optics Common Exam Platform: schema, RLS, RPCs and storage.

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z][a-z0-9._-]{2,29}$'),
  full_name text not null default '',
  stage text not null default 'المرحلة الثانية',
  role text not null default 'student' check (role in ('student', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
begin
  insert into public.profiles (id, username, full_name, stage)
  values (
    new.id,
    uname,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), uname),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'stage'), ''), 'المرحلة الثانية')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: admin update" on public.profiles;
create policy "profiles: admin update" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Platform content
-- ---------------------------------------------------------------------------
create table if not exists public.site_settings (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.stages (
  id text primary key,
  number integer,
  name text not null,
  subtitle text,
  description text,
  badge text,
  icon text,
  accent_color text,
  sort_order integer not null default 0,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id text primary key,
  stage_id text not null references public.stages (id) on delete cascade,
  name text not null,
  name_en text,
  code text,
  description text,
  instructor text,
  color text,
  icon text,
  sort_order integer not null default 0,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists subjects_stage_id_idx on public.subjects (stage_id);

create table if not exists public.lecture_files (
  id text primary key,
  subject_id text not null references public.subjects (id) on delete cascade,
  number integer,
  title text not null,
  description text,
  path text not null check (char_length(path) <= 2048),
  pages integer,
  size text,
  date text,
  is_local_uploaded boolean not null default false,
  sort_order integer not null default 0,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists lecture_files_subject_id_idx on public.lecture_files (subject_id);

do $$
declare
  t text;
begin
  foreach t in array array['site_settings', 'stages', 'subjects', 'lecture_files'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s: public read" on public.%I', t, t);
    execute format('create policy "%s: public read" on public.%I for select to anon, authenticated using (true)', t, t);
    execute format('drop policy if exists "%s: admin write" on public.%I', t, t);
    execute format('create policy "%s: admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end;
$$;

-- Returns the whole platform document in the same shape as data/exams.json.
create or replace function public.get_platform_data()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce((select data from site_settings where id = 1), '{}'::jsonb)
    || jsonb_build_object('stages', coalesce((
      select jsonb_agg(
        s.extra || jsonb_strip_nulls(jsonb_build_object(
          'id', s.id, 'number', s.number, 'name', s.name, 'subtitle', s.subtitle,
          'description', s.description, 'badge', s.badge, 'icon', s.icon, 'accentColor', s.accent_color
        )) || jsonb_build_object('subjects', coalesce((
          select jsonb_agg(
            sub.extra || jsonb_strip_nulls(jsonb_build_object(
              'id', sub.id, 'name', sub.name, 'nameEn', sub.name_en, 'code', sub.code,
              'description', sub.description, 'instructor', sub.instructor, 'color', sub.color, 'icon', sub.icon
            )) || jsonb_build_object('files', coalesce((
              select jsonb_agg(
                f.extra || jsonb_strip_nulls(jsonb_build_object(
                  'id', f.id, 'number', f.number, 'title', f.title, 'description', f.description,
                  'path', f.path, 'pages', f.pages, 'size', f.size, 'date', f.date,
                  'isLocalUploaded', f.is_local_uploaded
                ))
                order by f.sort_order, f.number
              )
              from lecture_files f where f.subject_id = sub.id
            ), '[]'::jsonb))
            order by sub.sort_order
          )
          from subjects sub where sub.stage_id = s.id
        ), '[]'::jsonb))
        order by s.sort_order, s.number
      )
      from stages s
    ), '[]'::jsonb));
$$;

-- Replaces the platform content with the given document (admin only).
create or replace function public.save_platform_data(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stages_json jsonb := coalesce(payload -> 'stages', '[]'::jsonb);
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(stages_json) <> 'array' then
    raise exception 'stages must be an array';
  end if;

  insert into site_settings (id, data, updated_at)
  values (1, payload - 'stages', now())
  on conflict (id) do update set data = excluded.data, updated_at = now();

  create temporary table _stages on commit drop as
    select st.value as v, st.ordinality::int as o
    from jsonb_array_elements(stages_json) with ordinality st;

  create temporary table _subjects on commit drop as
    select s.v ->> 'id' as stage_id, sub.value as v, sub.ordinality::int as o
    from _stages s, jsonb_array_elements(coalesce(s.v -> 'subjects', '[]'::jsonb)) with ordinality sub;

  create temporary table _files on commit drop as
    select sb.v ->> 'id' as subject_id, f.value as v, f.ordinality::int as o
    from _subjects sb, jsonb_array_elements(coalesce(sb.v -> 'files', '[]'::jsonb)) with ordinality f;

  insert into stages (id, number, name, subtitle, description, badge, icon, accent_color, sort_order, extra, updated_at)
  select v ->> 'id', nullif(v ->> 'number', '')::numeric::int, coalesce(v ->> 'name', ''), v ->> 'subtitle',
         v ->> 'description', v ->> 'badge', v ->> 'icon', v ->> 'accentColor', o,
         v - array['id', 'number', 'name', 'subtitle', 'description', 'badge', 'icon', 'accentColor', 'subjects'], now()
  from _stages
  on conflict (id) do update set
    number = excluded.number, name = excluded.name, subtitle = excluded.subtitle,
    description = excluded.description, badge = excluded.badge, icon = excluded.icon,
    accent_color = excluded.accent_color, sort_order = excluded.sort_order, extra = excluded.extra,
    updated_at = now();

  insert into subjects (id, stage_id, name, name_en, code, description, instructor, color, icon, sort_order, extra, updated_at)
  select v ->> 'id', stage_id, coalesce(v ->> 'name', ''), v ->> 'nameEn', v ->> 'code', v ->> 'description',
         v ->> 'instructor', v ->> 'color', v ->> 'icon', o,
         v - array['id', 'name', 'nameEn', 'code', 'description', 'instructor', 'color', 'icon', 'files'], now()
  from _subjects
  on conflict (id) do update set
    stage_id = excluded.stage_id, name = excluded.name, name_en = excluded.name_en, code = excluded.code,
    description = excluded.description, instructor = excluded.instructor, color = excluded.color,
    icon = excluded.icon, sort_order = excluded.sort_order, extra = excluded.extra, updated_at = now();

  insert into lecture_files (id, subject_id, number, title, description, path, pages, size, date, is_local_uploaded, sort_order, extra, updated_at)
  select v ->> 'id', subject_id, nullif(v ->> 'number', '')::numeric::int, coalesce(v ->> 'title', ''),
         v ->> 'description', coalesce(v ->> 'path', ''), nullif(v ->> 'pages', '')::numeric::int,
         v ->> 'size', v ->> 'date', coalesce((v ->> 'isLocalUploaded')::boolean, false), o,
         v - array['id', 'number', 'title', 'description', 'path', 'pages', 'size', 'date', 'isLocalUploaded', 'base64Data'], now()
  from _files
  on conflict (id) do update set
    subject_id = excluded.subject_id, number = excluded.number, title = excluded.title,
    description = excluded.description, path = excluded.path, pages = excluded.pages, size = excluded.size,
    date = excluded.date, is_local_uploaded = excluded.is_local_uploaded, sort_order = excluded.sort_order,
    extra = excluded.extra, updated_at = now();

  delete from lecture_files where id not in (select v ->> 'id' from _files);
  delete from subjects where id not in (select v ->> 'id' from _subjects);
  delete from stages where id not in (select v ->> 'id' from _stages);

  return public.get_platform_data();
end;
$$;

revoke all on function public.save_platform_data(jsonb) from public, anon;
grant execute on function public.save_platform_data(jsonb) to authenticated, service_role;
grant execute on function public.get_platform_data() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: lecture PDFs
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lectures', 'lectures', true, 52428800, array['application/pdf'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "lectures: admin read" on storage.objects;
create policy "lectures: admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'lectures' and public.is_admin());

drop policy if exists "lectures: admin insert" on storage.objects;
create policy "lectures: admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lectures' and public.is_admin());

drop policy if exists "lectures: admin update" on storage.objects;
create policy "lectures: admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'lectures' and public.is_admin());

drop policy if exists "lectures: admin delete" on storage.objects;
create policy "lectures: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'lectures' and public.is_admin());
