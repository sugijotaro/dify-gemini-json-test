import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';

async function main(): Promise<void> {
  const totalStartTime = Date.now();
  console.log(`Total Start: ${new Date(totalStartTime).toLocaleString()}`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  const dirPath = process.argv[2];
  if (!dirPath) {
    console.error('Usage: npx tsx uploadDirFiles.ts <directory_path>');
    process.exit(1);
  }

  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    console.error(`Directory not found: ${dirPath}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dirPath)
    .filter((file) => fs.statSync(path.join(dirPath, file)).isFile())
    .sort((a, b) => a.localeCompare(b, 'ja'));

  if (files.length === 0) {
    console.log('No files found in the directory.');
    process.exit(0);
  }

  const ai = new GoogleGenAI({ apiKey });
  const results: Array<{ name: string; localName: string; uri: string; mimeType: string }> = [];

  for (const localName of files) {
    const filePath = path.join(dirPath, localName);
    const mimeType = mime.lookup(filePath);
    if (!mimeType) {
      console.warn(`Skipped (unknown mime): ${localName}`);
      continue;
    }
    const fileSizeBytes = fs.statSync(filePath).size;
    const fileSizeMB = fileSizeBytes / (1024 * 1024);
    const startTime = Date.now();
    console.log(`\n[${localName}] Start: ${new Date(startTime).toLocaleString()}`);
    try {
      const myfile = await ai.files.upload({
        file: filePath,
        config: { mimeType: mimeType as string },
      });
      const endTime = Date.now();
      const durationSec = (endTime - startTime) / 1000;
      results.push({
        name: myfile.name ?? '',
        localName,
        uri: myfile.uri ?? '',
        mimeType: myfile.mimeType ?? '',
      });
      console.log(JSON.stringify({ name: myfile.name ?? '', localName, uri: myfile.uri ?? '', mimeType: myfile.mimeType ?? '' }, null, 2));
      console.log(`[${localName}] End:   ${new Date(endTime).toLocaleString()}`);
      console.log(`[${localName}] File size: ${fileSizeMB.toFixed(2)} MB`);
      console.log(`[${localName}] Elapsed:   ${durationSec.toFixed(2)} seconds`);
    } catch (err: any) {
      console.error(`Failed to upload ${localName}:`, err?.message || err);
    }
  }

  const totalEndTime = Date.now();
  const totalDurationSec = (totalEndTime - totalStartTime) / 1000;
  console.log(`\nTotal End:   ${new Date(totalEndTime).toLocaleString()}`);
  console.log(`Total Elapsed: ${totalDurationSec.toFixed(2)} seconds`);
  console.log('\nAll results:');
  console.log(JSON.stringify(results, null, 2));
}

main(); 