import 'dotenv/config';
import { GoogleGenAI, createUserContent, createPartFromUri, Type } from '@google/genai';
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
    console.error('Usage: npx tsx analyzeVideoStructured.ts <video_file_path>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  let mimeType = mime.lookup(filePath) || '';
  if (mimeType === 'application/mp4') {
    mimeType = 'video/mp4';
  }
  if (!mimeType) {
    console.error('Could not determine MIME type for the file.');
    process.exit(1);
  }

  const fileSizeBytes = fs.statSync(filePath).size;
  const fileSizeMB = fileSizeBytes / (1024 * 1024);
  const fileName = filePath.split(/[\/]/).pop() || filePath;

  const ai = new GoogleGenAI({ apiKey });

  try {
    console.log('Uploading video...');
    const myfile = await ai.files.upload({
      file: filePath,
      config: { mimeType: mimeType as string },
    });
    const uploadEnd = Date.now();
    const uploadDuration = (uploadEnd - startTime) / 1000;
    console.log(JSON.stringify({ name: myfile.name, localName: fileName, uri: myfile.uri, mimeType: myfile.mimeType }, null, 2));
    console.log(`Upload End:   ${new Date(uploadEnd).toLocaleString()}`);
    console.log(`File size: ${fileSizeMB.toFixed(2)} MB`);
    console.log(`Upload Elapsed:   ${uploadDuration.toFixed(2)} seconds`);

    // ポーリングでACTIVE状態を待つ
    const maxWaitMs = 30000;
    const pollIntervalMs = 2000;
    let waited = 0;
    let fileState = '';
    if (myfile.name) {
      while (waited < maxWaitMs) {
        const fileInfo = await ai.files.get({ name: myfile.name });
        fileState = fileInfo.state ?? '';
        if (fileState === 'ACTIVE') {
          break;
        }
        console.log(`Waiting for file to become ACTIVE... (current state: ${fileState})`);
        await new Promise((res) => setTimeout(res, pollIntervalMs));
        waited += pollIntervalMs;
      }
      if (fileState !== 'ACTIVE') {
        console.error(`ファイルがACTIVE状態になりませんでした（最終状態: ${fileState}）`);
        process.exit(1);
      }
    }

    console.log('Analyzing video with Gemini (structured output)...');
    const analyzeStart = Date.now();
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: createUserContent([
        createPartFromUri(myfile.uri ?? '', myfile.mimeType ?? ''),
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
    const analyzeEnd = Date.now();
    const analyzeDuration = (analyzeEnd - analyzeStart) / 1000;
    console.log('Structured analysis result:');
    console.log(response.text);
    console.log(`Analyze End:   ${new Date(analyzeEnd).toLocaleString()}`);
    console.log(`Analyze Elapsed:   ${analyzeDuration.toFixed(2)} seconds`);
    const totalEnd = Date.now();
    const totalDuration = (totalEnd - startTime) / 1000;
    console.log(`Total Elapsed:   ${totalDuration.toFixed(2)} seconds`);
  } catch (err: any) {
    console.error('Error:', err?.message || err);
    process.exit(1);
  }
}

main(); 