// One-time migration: uploads PDFs referenced by data/exams.json to Supabase Storage
// and writes all platform content into the database.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-to-supabase.mjs
import fs from 'node:fs';
import path from 'node:path';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

const BUCKET = 'lectures';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
const exams = JSON.parse(fs.readFileSync(path.join(root, 'data', 'exams.json'), 'utf8'));

async function uploadPdf(storagePath, bytes) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    body: bytes
  });
  if (!res.ok) throw new Error(`Upload failed for ${storagePath}: ${res.status} ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

let uploaded = 0;
for (const stage of exams.stages || []) {
  for (const subject of stage.subjects || []) {
    for (const file of subject.files || []) {
      if (typeof file.path !== 'string' || /^https?:\/\//.test(file.path)) continue;
      let bytes;
      let storagePath;
      if (file.path.startsWith('data:')) {
        bytes = Buffer.from(file.path.slice(file.path.indexOf(',') + 1), 'base64');
        storagePath = `uploads/${stage.id}/${subject.id}/${file.id}.pdf`;
      } else {
        const relative = file.path.replace(/^\.?\//, '');
        const local = path.join(root, relative);
        if (!fs.existsSync(local)) {
          console.warn(`Skipping missing file: ${relative}`);
          continue;
        }
        bytes = fs.readFileSync(local);
        storagePath = relative.replace(/^files\//, '');
      }
      file.path = await uploadPdf(storagePath, bytes);
      uploaded++;
    }
  }
}

const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_platform_data`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload: exams })
});
if (!res.ok) throw new Error(`save_platform_data failed: ${res.status} ${await res.text()}`);
const saved = await res.json();
const subjects = saved.stages.flatMap(s => s.subjects);
console.log(`Uploaded ${uploaded} PDF(s). Saved ${saved.stages.length} stages, ${subjects.length} subjects, ${subjects.flatMap(s => s.files).length} files.`);
