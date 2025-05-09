import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.DIFY_API_KEY;
const BASE_URL = 'https://api.dify.ai/v1';

export async function uploadFile(filePath: string, userId: string): Promise<string | null> {
  const url = `${BASE_URL}/files/upload`;
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
    contentType: 'text/plain',
  });
  form.append('user', userId);
  form.append('type', 'TXT');

  try {
    const response = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${API_KEY}`,
      },
      maxBodyLength: Infinity,
    });
    if (response.status === 201) {
      return response.data.id;
    }
    console.error('アップロード失敗:', response.data);
    return null;
  } catch (err: any) {
    console.error('アップロード失敗:', err.response?.data || err.message);
    return null;
  }
}

export async function runWorkflow(fileId: string, userId: string, responseMode = 'blocking'): Promise<any> {
  const url = `${BASE_URL}/workflows/run`;
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  };
  const jsonData = {
    inputs: {
      orig_mail: [
        {
          transfer_method: 'local_file',
          upload_file_id: fileId,
          type: 'document',
        },
      ],
    },
    response_mode: responseMode,
    user: userId,
  };
  try {
    const response = await axios.post(url, jsonData, { headers });
    return response.data;
  } catch (err: any) {
    console.error('ワークフロー実行失敗:', err.response?.data || err.message);
    return null;
  }
} 