import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, 'data');
const ALLOWED_ORIGINS = new Set([
  'https://it7asan.github.io',
  'https://optics-exam-platform.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);

type StoredUser = {
  id: string;
  username: string;
  password?: string;
  passwordHash?: string;
  passwordSalt?: string;
  fullName?: string;
  stage?: string;
  role?: string;
  createdAt?: string;
  [key: string]: unknown;
};

// دعم استقبال البيانات الكبيرة مثل ملفات PDF بترميز Base64
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// مسارات ملفات البيانات
const EXAMS_DATA_PATH = path.join(DATA_DIR, 'exams.json');
const EXAMS_BACKUP_PATH = path.join(DATA_DIR, 'exams.last.json');
const USERS_DATA_PATH = path.join(DATA_DIR, 'users.json');

// التأكد من وجود مجلد data والملفات
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const filename of ['exams.json', 'users.json']) {
  const destination = path.join(DATA_DIR, filename);
  const bundledDefault = path.resolve(__dirname, 'data', filename);
  if (!fs.existsSync(destination) && fs.existsSync(bundledDefault)) {
    fs.copyFileSync(bundledDefault, destination);
  }
}

function readUsers(): StoredUser[] {
  if (!fs.existsSync(USERS_DATA_PATH)) return [];
  const users = JSON.parse(fs.readFileSync(USERS_DATA_PATH, 'utf8'));
  return Array.isArray(users) ? users : [];
}

function writeUsers(users: StoredUser[]): void {
  fs.writeFileSync(USERS_DATA_PATH, JSON.stringify(users, null, 2), 'utf8');
}

function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function passwordMatches(user: StoredUser, password: string): boolean {
  if (user.passwordHash && user.passwordSalt) {
    const candidate = scryptSync(password, user.passwordSalt, 64);
    const saved = Buffer.from(user.passwordHash, 'hex');
    return saved.length === candidate.length && timingSafeEqual(saved, candidate);
  }
  // Migrate older server records that stored plain-text passwords on first login.
  return user.password === password;
}

function publicUser(user: StoredUser): Omit<StoredUser, 'password' | 'passwordHash' | 'passwordSalt'> {
  const { password, passwordHash, passwordSalt, ...safeUser } = user;
  return safeUser;
}

function validUsername(username: string): boolean {
  return /^[a-z][a-z0-9._-]{2,29}$/i.test(username);
}

function isAdminRequest(req: express.Request) {
  const configuredPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : '20032003');
  const suppliedPassword = req.header('x-admin-password') || '';
  return suppliedPassword.length > 0 && suppliedPassword === configuredPassword;
}

// توفير الملفات الثابتة مباشرة مع منع كاش ملفات البيانات
app.use('/files', express.static(path.resolve(__dirname, 'files')));
app.use('/data', (req, res, next) => {
  if (req.path === '/users.json') return res.sendStatus(404);
  next();
});
app.use('/data', express.static(path.resolve(__dirname, 'data'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));
app.use('/assets', express.static(path.resolve(__dirname, 'assets')));

// =========================================================================
// API Routes (واجهات البرمجة لمزامنة البيانات بين جميع المستخدمين)
// =========================================================================

// فحص حالة الخادم
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'fullstack',
    hasServer: true,
    timestamp: new Date().toISOString()
  });
});

// 1. جلب بيانات الامتحان المشترك المحدثة
app.get('/api/exams', (req, res) => {
  try {
    if (fs.existsSync(EXAMS_DATA_PATH)) {
      const content = fs.readFileSync(EXAMS_DATA_PATH, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.send(content);
    }
    return res.status(404).json({ error: 'ملف البيانات غير موجود' });
  } catch (err: any) {
    console.error('Error reading exams.json:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 2. حفظ وتحديث بيانات الامتحان المشترك من قبل المشرف
app.post('/api/exams', (req, res) => {
  try {
    const updatedData = req.body;
    if (!updatedData || !Array.isArray(updatedData.stages)) {
      return res.status(400).json({ error: 'بنية البيانات غير صالحة' });
    }

    const jsonString = JSON.stringify(updatedData, null, 2);
    fs.writeFileSync(EXAMS_DATA_PATH, jsonString, 'utf8');
    fs.writeFileSync(EXAMS_BACKUP_PATH, jsonString, 'utf8');

    // تحديث نسخة dist إذا كانت موجودة
    const distDataPath = path.resolve(__dirname, 'dist/data/exams.json');
    if (fs.existsSync(path.dirname(distDataPath))) {
      fs.writeFileSync(distDataPath, jsonString, 'utf8');
    }

    console.log('✅ تم حفظ ونشر تعديلات المنصة على الخادم لجميع المستخدمين بنجاح!');
    return res.json({ success: true, message: 'تم حفظ التعديلات ونشرها لجميع المستخدمين بنجاح' });
  } catch (err: any) {
    console.error('Error writing exams.json:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 3. جلب قائمة المستخدمين والطلاب
app.get('/api/users', (req, res) => {
  try {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'يلزم تسجيل دخول المشرف لعرض الحسابات.' });
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.json(readUsers().map(publicUser));
  } catch (err: any) {
    console.error('Error reading users.json:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Account creation is stored on the shared server, not in an individual browser.
app.post('/api/register', (req, res) => {
  try {
    const { username, password, fullName, stage } = req.body || {};
    const cleanUsername = String(username || '').trim().toLowerCase();
    const cleanPassword = String(password || '').trim();
    if (!validUsername(cleanUsername)) {
      return res.status(400).json({ error: 'اسم المستخدم يجب أن يكون إنجليزياً من 3 إلى 30 حرفاً، ويبدأ بحرف.' });
    }
    if (cleanPassword.length < 8) return res.status(400).json({ error: 'يجب أن يتكون رمز المرور من 8 أحرف على الأقل.' });
    const users = readUsers();
    if (users.some(user => String(user.username).toLowerCase() === cleanUsername)) {
      return res.status(409).json({ error: 'اسم المستخدم مسجل بالفعل، اختر اسماً آخر.' });
    }
    const { salt, hash } = hashPassword(cleanPassword);
    const user = {
      id: `usr-${Date.now()}-${randomBytes(4).toString('hex')}`,
      username: cleanUsername,
      passwordHash: hash,
      passwordSalt: salt,
      fullName: String(fullName || cleanUsername).trim(),
      stage: String(stage || 'المرحلة الثانية').trim(),
      role: 'student',
      createdAt: new Date().toISOString().slice(0, 10)
    };
    users.push(user);
    writeUsers(users);
    return res.status(201).json({ success: true, user: publicUser(user) });
  } catch (err: any) {
    console.error('Error registering user:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '').trim();
    const users = readUsers();
    const user = users.find(item => String(item.username).toLowerCase() === username);
    if (!user || !passwordMatches(user, password)) {
      return res.status(401).json({ error: 'اسم المستخدم أو رمز المرور غير صحيح.' });
    }
    if (user.password && !user.passwordHash) {
      const { salt, hash } = hashPassword(user.password);
      delete user.password;
      user.passwordSalt = salt;
      user.passwordHash = hash;
      writeUsers(users);
    }
    return res.json({ success: true, user: publicUser(user) });
  } catch (err: any) {
    console.error('Error logging in user:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/login', (req, res) => {
  const expectedUsername = 'it7asan';
  const expectedPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : '20032003');
  if (!expectedPassword) {
    return res.status(503).json({ error: 'يجب ضبط ADMIN_PASSWORD كمتغير سري في إعدادات الخادم.' });
  }
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();
  if (username !== expectedUsername || password !== expectedPassword) {
    return res.status(401).json({ error: 'اسم المستخدم أو رمز مرور المشرف غير صحيح.' });
  }
  return res.json({ success: true });
});

app.post('/api/github/test', async (req, res) => {
  try {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'يجب تسجيل دخول المشرف قبل فحص مستودع GitHub.' });
    const repo = String(req.body?.repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    const token = String(req.body?.token || '').trim();
    const branch = String(req.body?.branch || 'main').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) {
      return res.status(400).json({ error: 'أدخل المستودع بصيغة owner/repo ورمز GitHub صالح.' });
    }

    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, { headers });
    const repoInfo = await repoResponse.json().catch(() => ({}));
    if (!repoResponse.ok) return res.status(repoResponse.status).json({ error: repoInfo.message || 'تعذر الوصول إلى المستودع أو التوكن.' });

    const branchResponse = await fetch(`https://api.github.com/repos/${repo}/branches/${encodeURIComponent(branch)}`, { headers });
    return res.json({
      success: true,
      repoFullName: repoInfo.full_name,
      isPrivate: repoInfo.private,
      branchExists: branchResponse.ok,
      branchName: branch,
      defaultBranch: repoInfo.default_branch,
      stars: repoInfo.stargazers_count
    });
  } catch (error: any) {
    console.error('GitHub connection proxy error:', error);
    return res.status(502).json({ error: 'تعذر الاتصال بخدمة GitHub من الخادم.' });
  }
});

app.post('/api/github/publish-exams', async (req, res) => {
  try {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'يجب تسجيل دخول المشرف قبل نشر البيانات.' });
    const repo = String(req.body?.repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    const token = String(req.body?.token || '').trim();
    const branch = String(req.body?.branch || 'main').trim();
    const content = req.body?.content;
    const message = String(req.body?.commitMessage || 'Update exam platform data');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token || !content || typeof content !== 'object') {
      return res.status(400).json({ error: 'بيانات النشر غير مكتملة أو غير صالحة.' });
    }

    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const fileUrl = `https://api.github.com/repos/${repo}/contents/data/exams.json`;
    const currentResponse = await fetch(`${fileUrl}?ref=${encodeURIComponent(branch)}`, { headers });
    let sha: string | undefined;
    if (currentResponse.ok) {
      const currentFile = await currentResponse.json();
      sha = currentFile.sha;
    } else if (currentResponse.status !== 404) {
      const details = await currentResponse.json().catch(() => ({}));
      return res.status(currentResponse.status).json({ error: details.message || 'تعذر قراءة ملف البيانات من GitHub.' });
    }

    const encodedContent = Buffer.from(JSON.stringify(content, null, 2), 'utf8').toString('base64');
    const payload: Record<string, string> = { message, content: encodedContent, branch };
    if (sha) payload.sha = sha;
    const publishResponse = await fetch(fileUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await publishResponse.json().catch(() => ({}));
    if (!publishResponse.ok) return res.status(publishResponse.status).json({ error: result.message || 'فشل نشر الملف على GitHub.' });
    return res.json({ success: true, commitUrl: result.commit?.html_url, commitSha: result.commit?.sha, branch });
  } catch (error: any) {
    console.error('GitHub publish proxy error:', error);
    return res.status(502).json({ error: 'تعذر الاتصال بخدمة GitHub من الخادم.' });
  }
});

app.put('/api/users/:id', (req, res) => {
  try {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح بتعديل الحسابات.' });
    const users = readUsers();
    const user = users.find(item => item.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'الحساب غير موجود.' });
    const username = String(req.body?.username ?? user.username).trim().toLowerCase();
    if (!validUsername(username)) return res.status(400).json({ error: 'اسم المستخدم يجب أن يكون إنجليزياً من 3 إلى 30 حرفاً، ويبدأ بحرف.' });
    if (users.some(item => item.id !== user.id && String(item.username).toLowerCase() === username)) {
      return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل بحساب آخر.' });
    }
    user.username = username;
    if (req.body?.fullName !== undefined) user.fullName = String(req.body.fullName).trim();
    if (req.body?.stage !== undefined) user.stage = String(req.body.stage).trim();
    if (req.body?.password) {
      const password = String(req.body.password).trim();
      if (password.length < 8) return res.status(400).json({ error: 'يجب أن يتكون رمز المرور من 8 أحرف على الأقل.' });
      const { salt, hash } = hashPassword(password);
      user.passwordSalt = salt;
      user.passwordHash = hash;
      delete user.password;
    }
    writeUsers(users);
    return res.json({ success: true, user: publicUser(user) });
  } catch (err: any) {
    console.error('Error updating user:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', (req, res) => {
  try {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'غير مصرح بحذف الحسابات.' });
    const users = readUsers();
    const remaining = users.filter(user => user.id !== req.params.id);
    if (remaining.length === users.length) return res.status(404).json({ error: 'الحساب غير موجود.' });
    writeUsers(remaining);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting user:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 5. رفع ملف PDF وحفظه على الخادم
app.post('/api/upload-pdf', (req, res) => {
  try {
    const { filename, base64Data, stageId, subjectId } = req.body;
    if (!filename || !base64Data) {
      return res.status(400).json({ error: 'اسم الملف والبيانات مطلوبة' });
    }

    // تنظيف اسم الملف والمسار
    const cleanStage = stageId || 'uploads';
    const cleanSub = (subjectId || 'general').replace(cleanStage + '-', '');
    const targetDir = path.resolve(__dirname, `files/${cleanStage}/${cleanSub}`);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const safeFilename = filename.replace(/[^a-zA-Z0-9_\u0600-\u06FF.-]/g, '_');
    const filePath = path.join(targetDir, safeFilename);

    // استخراج بيانات base64 وحفظ الملف
    const cleanBase64 = base64Data.replace(/^data:application\/pdf;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    fs.writeFileSync(filePath, buffer);

    // تحديث مجلد dist إن وجد
    const distFilePath = path.resolve(__dirname, `dist/files/${cleanStage}/${cleanSub}/${safeFilename}`);
    const distDir = path.dirname(distFilePath);
    if (fs.existsSync(distDir)) {
      fs.writeFileSync(distFilePath, buffer);
    }

    const publicPath = `files/${cleanStage}/${cleanSub}/${safeFilename}`;
    console.log(`✅ تم حفظ الملف بنجاح على الخادم: ${publicPath}`);

    return res.json({ success: true, path: publicPath });
  } catch (err: any) {
    console.error('Error uploading PDF:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// Frontend Mounting (Vite in Development or Static Dist in Production)
// =========================================================================

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(__dirname, 'dist'));

  if (!isProduction) {
    // Development mode with Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Production mode serving dist
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Optics Platform server running live at http://0.0.0.0:${PORT}`);
  });
}

startServer();
