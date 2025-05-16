import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  const fileName = process.argv[2];
  if (!fileName) {
    console.error('Usage: npx tsx deleteFile.ts <file_name>');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    await ai.files.delete({ name: fileName });
    console.log(`Deleted file: ${fileName}`);
  } catch (err: any) {
    console.error('Failed to delete file:', err?.message || err);
    process.exit(1);
  }
}

main(); 