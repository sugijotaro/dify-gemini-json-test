import { uploadFile, runWorkflow } from './utils/difyApi.js';
import dotenv from 'dotenv';

dotenv.config();

const FILE_PATH = 'upload_test.txt';
const API_KEY = process.env.DIFY_API_KEY;
const USER_ID = process.env.DIFY_USER_ID;

async function main() {
  if (!API_KEY) {
    console.error('DIFY_API_KEYが設定されていません。');
    process.exit(1);
  }
  if (!USER_ID) {
    console.error('DIFY_USER_IDが設定されていません。');
    process.exit(1);
  }
  const fileId = await uploadFile(FILE_PATH, USER_ID);
  if (fileId) {
    const result = await runWorkflow(fileId, USER_ID);
    console.log('結果:', result);
  } else {
    console.log('アップロード失敗');
  }
}

main(); 