#!/bin/bash

# Dify API にローカルの動画ファイルをアップロードし、ワークフローを実行するスクリプト

# === .env 読み込み ===
if [ -f ./.env ]; then
  source ./.env
else
  echo ".envが見つかりません。"
  exit 1
fi

# === 設定 ===
API_KEY="$SINGLE_VIDEO_URL_API_KEY"
UPLOAD_URL="https://api.dify.ai/v1/files/upload"
WORKFLOW_URL="https://api.dify.ai/v1/workflows/run"
LOCAL_FILE_PATH="./example_video.mp4"  # ← ここにアップロードしたいファイルのパス
USER_ID="user"

# === ファイルの存在確認 ===
if [ ! -f "$LOCAL_FILE_PATH" ]; then
  echo "ローカルファイルが見つかりません: $LOCAL_FILE_PATH"
  exit 1
fi

# === ファイルアップロード ===
echo "アップロード中: $LOCAL_FILE_PATH"
upload_response=$(curl -s -X POST "$UPLOAD_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@${LOCAL_FILE_PATH}" \
  -F "user=$USER_ID" \
  -F "type=video")

upload_file_id=$(echo "$upload_response" | jq -r '.id')

if [ "$upload_file_id" == "null" ] || [ -z "$upload_file_id" ]; then
  echo "ファイルアップロードに失敗しました:"
  echo "$upload_response"
  exit 1
fi

echo "アップロード成功: file_id = $upload_file_id"

# === ワークフロー実行 ===
echo "ワークフローを実行中..."
curl -s -X POST "$WORKFLOW_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"inputs\": {
      \"video\": {
        \"type\": \"video\",
        \"transfer_method\": \"local_file\",
        \"upload_file_id\": \"$upload_file_id\"
      }
    },
    \"user\": \"$USER_ID\",
    \"response_mode\": \"blocking\"
  }" | jq