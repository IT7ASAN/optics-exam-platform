import fs from 'node:fs';
import path from 'node:path';

const outputDir = path.resolve(process.argv[2] || 'dist');
const examsPath = path.join(outputDir, 'data', 'exams.json');

if (!fs.existsSync(examsPath)) {
  throw new Error(`Missing Pages data file: ${examsPath}`);
}

const exams = JSON.parse(fs.readFileSync(examsPath, 'utf8'));
let extractedCount = 0;

for (const stage of exams.stages || []) {
  for (const subject of stage.subjects || []) {
    for (const file of subject.files || []) {
      if (typeof file.path !== 'string' || (!file.path.startsWith('data:') && !file.path.includes(';base64,'))) continue;

      const base64 = file.path.slice(file.path.indexOf(',') + 1).replace(/\s/g, '');
      const pdf = Buffer.from(base64, 'base64');
      if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new Error(`Invalid PDF upload found in ${stage.id}/${subject.id}/${file.id}`);
      }

      const relativePath = path.posix.join('files', 'uploads', stage.id, subject.id, `${file.id}.pdf`);
      const destination = path.join(outputDir, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, pdf);
      file.path = `./${relativePath}`;
      extractedCount++;
    }
  }
}

fs.writeFileSync(examsPath, `${JSON.stringify(exams, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(outputDir, '.nojekyll'), '', 'utf8');
console.log(`Prepared GitHub Pages payload and extracted ${extractedCount} PDF upload(s).`);
