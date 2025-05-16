import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import readline from 'readline';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEYが.envに設定されていません');
    process.exit(1);
  }

  console.warn('警告: この操作はアップロード済みの全ファイルを削除します。本当に実行しますか？ (y/n)');
  const answer = (await prompt('> ')).trim().toLowerCase();
  if (answer !== 'y' && answer !== 'yes') {
    console.log('キャンセルされました。');
    process.exit(0);
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const listResponse = await ai.files.list({ config: { pageSize: 100 } });
    let count = 0;
    for await (const file of listResponse) {
      if (!file.name) continue;
      await ai.files.delete({ name: file.name });
      console.log(`Deleted: ${file.name}`);
      count++;
    }
    if (count === 0) {
      console.log('削除するファイルはありません。');
    } else {
      console.log(`合計${count}件のファイルを削除しました。`);
    }
  } catch (err: any) {
    console.error('ファイルの削除に失敗しました:', err?.message || err);
    process.exit(1);
  }
}

main(); 