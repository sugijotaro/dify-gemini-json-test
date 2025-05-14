#!/bin/bash

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
LOCAL_FILE_PATH="/Users/jotarosugiyama/repositories/aapp/output_20250512-151207_resized_full_video_1fps/part1_resized_full_video_0-600.MP4"
# LOCAL_FILE_PATH="/Users/jotarosugiyama/repositories/aapp/output_20250512-154934_resized_full_video_1fps/part1_resized_full_video_0-60.MP4"
# LOCAL_FILE_PATH="./example_video.mp4"
# LOCAL_FILE_PATH="/Users/jotarosugiyama/Downloads/1046-142621379_small.mp4"
# LOCAL_FILE_PATH="/Users/jotarosugiyama/Downloads/20250424_1747_Sushi Cat Adventure_simple_compose_01jskfp3xzemd9p1273ef32zgf.mp4"
USER_ID="user"

# === ファイル存在チェック ===
if [ ! -f "$LOCAL_FILE_PATH" ]; then
  echo "ローカルファイルが見つかりません: $LOCAL_FILE_PATH"
  exit 1
fi

FILE_NAME=$(basename "$LOCAL_FILE_PATH")

# === ファイルアップロード ===
echo "アップロード中: $LOCAL_FILE_PATH"
upload_response=$(curl -s -X POST "$UPLOAD_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@${LOCAL_FILE_PATH};type=video/mp4" \
  -F "user=$USER_ID" \
  -F "type=MP4")

upload_file_id=$(echo "$upload_response" | jq -r '.id')

echo "$upload_response" | jq

# 必要に応じて size チェックなども追加できる
upload_size=$(echo "$upload_response" | jq -r '.size')
if [ "$upload_size" -gt 104857600 ]; then
  echo "⚠️ 警告：アップロードされたファイルサイズが100MBを超えています"
fi

if [ "$upload_file_id" == "null" ] || [ -z "$upload_file_id" ]; then
  echo "❌ ファイルアップロードに失敗しました:"
  echo "$upload_response"
  exit 1
fi

echo "✅ アップロード成功: file_id = $upload_file_id"

# === ワークフロー実行 ===
echo "ワークフローを実行中..."

workflow_response=$(curl -s -X POST "$WORKFLOW_URL" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"inputs\": {
      \"video\": {
        \"transfer_method\": \"local_file\",
        \"upload_file_id\": \"$upload_file_id\",
        \"type\": \"video\"
      }
    },
    \"user\": \"$USER_ID\",
    \"response_mode\": \"blocking\"
  }")

echo "$workflow_response" | jq