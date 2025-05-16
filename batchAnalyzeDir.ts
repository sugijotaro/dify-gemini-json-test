import 'dotenv/config';
import { GoogleGenAI, createUserContent, createPartFromUri, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';

async function ensureOutputDir() {
  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  return outputDir;
}

async function uploadFile(ai: GoogleGenAI, filePath: string, localName: string) {
  let mimeType = mime.lookup(filePath) || '';
  if (mimeType === 'application/mp4') {
    mimeType = 'video/mp4';
  }
  if (!mimeType) {
    console.warn(`Skipped (unknown mime): ${localName}`);
    return null;
  }
  try {
    const myfile = await ai.files.upload({
      file: filePath,
      config: { mimeType: mimeType as string },
    });
    return {
      name: myfile.name ?? '',
      localName,
      uri: myfile.uri ?? '',
      mimeType: myfile.mimeType ?? '',
    };
  } catch (err: any) {
    console.error(`Failed to upload ${localName}:`, err?.message || err);
    return null;
  }
}

async function waitForActive(ai: GoogleGenAI, fileName: string): Promise<boolean> {
  const maxWaitMs = 30000;
  const pollIntervalMs = 2000;
  let waited = 0;
  let fileState = '';
  while (waited < maxWaitMs) {
    const fileInfo = await ai.files.get({ name: fileName });
    fileState = fileInfo.state ?? '';
    if (fileState === 'ACTIVE') {
      return true;
    }
    await new Promise((res) => setTimeout(res, pollIntervalMs));
    waited += pollIntervalMs;
  }
  return false;
}

async function analyzeFile(ai: GoogleGenAI, file: { uri: string; mimeType: string; localName: string; name: string }, outputDir: string) {
  try {
    const ok = await waitForActive(ai, file.name);
    if (!ok) {
      console.error(`ファイルがACTIVE状態になりませんでした: ${file.localName}`);
      return;
    }
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: createUserContent([
        createPartFromUri(file.uri, file.mimeType),
        'この動画をクリップごとに分割し、各クリップの開始時刻・終了時刻（MM:SS形式）、タイトル、重要度（1=高、2=中、3=低）を抽出し、clips配列として構造化JSONで出力してください。',
      ]),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            clips: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start_time: { type: Type.STRING, description: 'クリップの開始時刻（MM:SS形式）' },
                  end_time:   { type: Type.STRING, description: 'クリップの終了時刻（MM:SS形式）' },
                  name:       { type: Type.STRING, description: 'クリップのタイトル' },
                  importance: { type: Type.INTEGER, description: '重要度（1=高、2=中、3=低）' },
                },
                required: ['start_time', 'end_time', 'name', 'importance'],
                propertyOrdering: ['start_time', 'end_time', 'name', 'importance'],
              },
            },
          },
          required: ['clips'],
          propertyOrdering: ['clips'],
        },
      },
    });
    const outputPath = path.join(outputDir, `${file.localName}.json`);
    fs.writeFileSync(outputPath, response.text ?? '', 'utf-8');
    console.log(`Saved analysis for ${file.localName} to ${outputPath}`);
  } catch (err: any) {
    console.error(`Failed to analyze ${file.localName}:`, err?.message || err);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  const dirPath = process.argv[2];
  if (!dirPath) {
    console.error('Usage: npx tsx batchAnalyzeDir.ts <directory_path>');
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
  const outputDir = await ensureOutputDir();
  const uploadedFiles: Array<{ name: string; localName: string; uri: string; mimeType: string }> = [];

  // アップロード
  for (const localName of files) {
    const filePath = path.join(dirPath, localName);
    const uploaded = await uploadFile(ai, filePath, localName);
    if (uploaded) {
      uploadedFiles.push(uploaded);
    }
  }

  // 分析
  for (const file of uploadedFiles) {
    await analyzeFile(ai, file, outputDir);
  }
}

main();
