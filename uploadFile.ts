import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import mime from 'mime-types';

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log(`Start: ${new Date(startTime).toLocaleString()}`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx uploadFile.ts <file_path>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const mimeType = mime.lookup(filePath);
  if (!mimeType) {
    console.error('Could not determine MIME type for the file.');
    process.exit(1);
  }

  const fileSizeBytes = fs.statSync(filePath).size;
  const fileSizeMB = fileSizeBytes / (1024 * 1024);
  const fileName = filePath.split(/[\/]/).pop() || filePath;

  const ai = new GoogleGenAI({ apiKey });

  try {
    const myfile = await ai.files.upload({
      file: filePath,
      config: { mimeType: mimeType as string },
    });
    const endTime = Date.now();
    const durationSec = (endTime - startTime) / 1000;
    console.log(JSON.stringify({ name: myfile.name, localName: fileName, uri: myfile.uri, mimeType: myfile.mimeType }, null, 2));
    console.log(`End:   ${new Date(endTime).toLocaleString()}`);
    console.log(`File size: ${fileSizeMB.toFixed(2)} MB`);
    console.log(`Elapsed:   ${durationSec.toFixed(2)} seconds`);
  } catch (err: any) {
    console.error('Upload failed:', err?.message || err);
    process.exit(1);
  }
}

main(); 