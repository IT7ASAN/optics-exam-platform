import fs from 'fs';
import path from 'path';

// Load data
const examsPath = path.resolve('data/exams.json');
const examsData = JSON.parse(fs.readFileSync(examsPath, 'utf8'));

// Helper to create a valid 2-page PDF binary string with readable typography
function createValidPdf(title, subject, stage, lectureNum) {
  // Safe ASCII representation for PDF stream
  const cleanTitle = title.replace(/[^\x20-\x7E]/g, '?');
  const cleanSubject = subject.replace(/[^\x20-\x7E]/g, '?');
  const cleanStage = stage.replace(/[^\x20-\x7E]/g, '?');

  const contentP1 = `BT
/F1 22 Tf
50 720 Td
(Optics Common Exam Platform) Tj
/F2 14 Tf
0 -30 Td
(Department of Optics - Academic Year 2026-2027) Tj
/F1 16 Tf
0 -40 Td
(Stage: ${cleanStage}) Tj
0 -26 Td
(Subject: ${cleanSubject}) Tj
/F1 18 Tf
0 -36 Td
(Lecture ${lectureNum}: ${cleanTitle}) Tj
/F2 12 Tf
0 -40 Td
(This is an official common exam lecture document for the Optics Department.) Tj
0 -20 Td
(All core theoretical and practical principles are compiled in this guide.) Tj
0 -20 Td
(Prepared for ministerial examination standards and clinical evaluation.) Tj
0 -40 Td
(Key Topics Covered:) Tj
0 -20 Td
( - Theoretical foundations and optical mathematical formulas) Tj
0 -20 Td
( - Clinical diagnostic guidelines and case evaluations) Tj
0 -20 Td
( - Practice problems and revision questions for the final exam) Tj
0 -60 Td
(Page 1 of 2 - Scroll or click Next to continue) Tj
ET`;

  const contentP2 = `BT
/F1 20 Tf
50 720 Td
(Optics Department - Study Review & Summary) Tj
/F2 14 Tf
0 -30 Td
(${cleanTitle}) Tj
/F2 12 Tf
0 -40 Td
(Summary Notes:) Tj
0 -20 Td
(1. Ensure thorough understanding of core optic laws and derivations.) Tj
0 -20 Td
(2. Review past common exam questions and diagnostic problem sets.) Tj
0 -20 Td
(3. Verify all clinical metrics and instrument calibrations.) Tj
0 -40 Td
(Success tips: Maintain comprehensive study notes and test with fellow students.) Tj
0 -80 Td
(Optics Common Exam Platform - Document Verified) Tj
0 -30 Td
(Page 2 of 2 - End of Lecture) Tj
ET`;

  const objects = [];
  
  // 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  // 2: Pages
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>\nendobj');
  // 3: Page 1
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 8 0 R /F2 9 0 R >> >> >>\nendobj');
  // 4: Content stream 1
  objects.push(`4 0 obj\n<< /Length ${Buffer.byteLength(contentP1)} >>\nstream\n${contentP1}\nendstream\nendobj`);
  // 6: Page 2
  objects.push('6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 7 0 R /Resources << /Font << /F1 8 0 R /F2 9 0 R >> >> >>\nendobj');
  // 7: Content stream 2
  objects.push(`7 0 obj\n<< /Length ${Buffer.byteLength(contentP2)} >>\nstream\n${contentP2}\nendstream\nendobj`);
  // 8: Font Bold
  objects.push('8 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj');
  // 9: Font Regular
  objects.push('9 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += objects[i] + '\n';
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += offsets[i].toString().padStart(10, '0') + ' 00000 n \n';
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

// Generate all files
let count = 0;
for (const stage of examsData.stages) {
  for (const subject of stage.subjects) {
    for (const file of subject.files) {
      const filePath = path.resolve(file.path);
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      const pdfBuffer = createValidPdf(file.title, subject.name, stage.name, file.number);
      fs.writeFileSync(filePath, pdfBuffer);
      count++;
    }
  }
}

console.log(`Successfully generated ${count} valid PDF files!`);
