import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const listResponse = await ai.files.list({ config: { pageSize: 50 } });
    let count = 0;
    for await (const file of listResponse) {
      count++;
      console.log(JSON.stringify({
        name: file.name,
        uri: file.uri,
        mimeType: file.mimeType,
        createTime: file.createTime,
      }, null, 2));
    }
    if (count === 0) {
      console.log('No files found.');
    }
  } catch (err: any) {
    console.error('Failed to list files:', err?.message || err);
    process.exit(1);
  }
}

main(); 