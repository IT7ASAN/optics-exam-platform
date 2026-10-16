// Admin-only account management: create, update (username/password/name/stage) and delete students.
import { createClient } from 'npm:@supabase/supabase-js@2';

const AUTH_EMAIL_DOMAIN = 'optics.local';
const USERNAME_RE = /^[a-z][a-z0-9._-]{2,29}$/;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function toEmail(username: string) {
  return `${username}@${AUTH_EMAIL_DOMAIN}`;
}

function translateError(message = '') {
  if (/already.*(registered|exists)|duplicate key/i.test(message)) return 'اسم المستخدم مسجل مسبقاً.';
  if (/password/i.test(message) && /least|short|weak/i.test(message)) return 'رمز المرور قصير جداً (6 أحرف على الأقل).';
  return message || 'حدث خطأ غير متوقع.';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: authData, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !authData?.user) return json({ error: 'يجب تسجيل الدخول.' }, 401);

  const { data: caller } = await admin.from('profiles').select('role').eq('id', authData.user.id).single();
  if (caller?.role !== 'admin') return json({ error: 'هذه العملية متاحة للمشرف فقط.' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const action = String(body.action || '');
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const stage = typeof body.stage === 'string' ? body.stage.trim() : '';

  if (username && !USERNAME_RE.test(username)) {
    return json({ error: 'اسم المستخدم يجب أن يكون من 3 إلى 30 حرفاً، يبدأ بحرف إنجليزي، ويسمح بالأرقام والنقطة والشرطة والشرطة السفلية.' }, 400);
  }

  if (action === 'create') {
    if (!username || !password) return json({ error: 'يرجى إدخال اسم المستخدم ورمز المرور.' }, 400);
    const { data, error } = await admin.auth.admin.createUser({
      email: toEmail(username),
      password,
      email_confirm: true,
      user_metadata: { username, full_name: fullName || username, stage: stage || 'المرحلة الثانية' }
    });
    if (error) return json({ error: translateError(error.message) }, 400);
    const { data: profile } = await admin.from('profiles').select('*').eq('id', data.user.id).single();
    return json({ user: profile });
  }

  const userId = String(body.userId || '');
  if (!userId) return json({ error: 'userId is required' }, 400);

  const { data: target } = await admin.from('profiles').select('*').eq('id', userId).single();
  if (!target) return json({ error: 'الحساب غير موجود.' }, 404);
  if (target.role === 'admin') return json({ error: 'لا يمكن تعديل حساب المشرف من هنا.' }, 403);

  if (action === 'update') {
    const authUpdate: Record<string, unknown> = {};
    if (username && username !== target.username) authUpdate.email = toEmail(username);
    if (password) authUpdate.password = password;
    if (Object.keys(authUpdate).length) {
      authUpdate.email_confirm = true;
      const { error } = await admin.auth.admin.updateUserById(userId, authUpdate);
      if (error) return json({ error: translateError(error.message) }, 400);
    }
    const profileUpdate: Record<string, string> = {};
    if (username) profileUpdate.username = username;
    if (fullName) profileUpdate.full_name = fullName;
    if (stage) profileUpdate.stage = stage;
    const { data: profile, error } = await admin.from('profiles').update(profileUpdate).eq('id', userId).select('*').single();
    if (error) return json({ error: translateError(error.message) }, 400);
    return json({ user: profile });
  }

  if (action === 'delete') {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json({ error: translateError(error.message) }, 400);
    return json({ success: true });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
