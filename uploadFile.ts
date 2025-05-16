import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import mime from 'mime-types';

async function main(): Promise<void> {
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

  const ai = new GoogleGenAI({ apiKey });

  try {
    const myfile = await ai.files.upload({
      file: filePath,
      config: { mimeType: mimeType as string },
    });
    console.log(JSON.stringify({ uri: myfile.uri, mimeType: myfile.mimeType }, null, 2));
  } catch (err: any) {
    console.error('Upload failed:', err?.message || err);
    process.exit(1);
  }
}

main(); 