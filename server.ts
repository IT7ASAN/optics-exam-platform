import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// دعم استقبال البيانات الكبيرة مثل ملفات PDF بترميز Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// مسارات ملفات البيانات
const EXAMS_DATA_PATH = path.resolve(__dirname, 'data/exams.json');
const EXAMS_BACKUP_PATH = path.resolve(__dirname, 'data/exams.last.json');
const USERS_DATA_PATH = path.resolve(__dirname, 'data/users.json');

// التأكد من وجود مجلد data والملفات
if (!fs.existsSync(path.resolve(__dirname, 'data'))) {
  fs.mkdirSync(path.resolve(__dirname, 'data'), { recursive: true });
}

// توفير الملفات الثابتة مباشرة مع منع كاش ملفات البيانات
app.use('/files', express.static(path.resolve(__dirname, 'files')));
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
    if (fs.existsSync(USERS_DATA_PATH)) {
      const content = fs.readFileSync(USERS_DATA_PATH, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.send(content);
    }
    return res.json([]);
  } catch (err: any) {
    console.error('Error reading users.json:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 4. حفظ وتحديث قائمة المستخدمين والطلاب
app.post('/api/users', (req, res) => {
  try {
    const users = req.body;
    if (!Array.isArray(users)) {
      return res.status(400).json({ error: 'قائمة المستخدمين غير صالحة' });
    }

    const jsonString = JSON.stringify(users, null, 2);
    fs.writeFileSync(USERS_DATA_PATH, jsonString, 'utf8');

    const distUsersPath = path.resolve(__dirname, 'dist/data/users.json');
    if (fs.existsSync(path.dirname(distUsersPath))) {
      fs.writeFileSync(distUsersPath, jsonString, 'utf8');
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Error writing users.json:', err);
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
