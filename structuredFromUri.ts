import 'dotenv/config';
import { GoogleGenAI, createUserContent, createPartFromUri, Type } from '@google/genai';

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log(`Start: ${new Date(startTime).toLocaleString()}`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  const uri = process.argv[2];
  const mimeType = process.argv[3];
  if (!uri || !mimeType) {
    console.error('Usage: npx tsx structuredFromUri.ts <file_uri> <mime_type>');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    console.log('Analyzing file with Gemini (structured output)...');
    const analyzeStart = Date.now();
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: createUserContent([
        createPartFromUri(uri, mimeType),
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