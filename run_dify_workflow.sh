#!/bin/bash

# .envが存在すれば読み込む
if [ -f ./.env ]; then
  source ./.env
else
  echo ".envが見つかりません。"
  exit 1
fi

FILE_PATH="example_video.mp4"  # アップロードする動画ファイル

# ファイルアップロード
UPLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/files/upload" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@$FILE_PATH;type=video/mp4" \
  -F "user=$USER_ID" \
  -F "type=VIDEO")

FILE_ID=$(echo "$UPLOAD_RESPONSE" | jq -r '.id')

if [ "$FILE_ID" = "null" ] || [ -z "$FILE_ID" ]; then
  echo "ファイルアップロード失敗: $UPLOAD_RESPONSE"
  exit 1
fi

echo "ファイルアップロード成功: $FILE_ID"

# ワークフロー実行
WORKFLOW_RESPONSE=$(curl -s -X POST "$BASE_URL/workflows/run" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {
      "video": [
        {
          "transfer_method": "local_file",
          "upload_file_id": "'$FILE_ID'",
          "type": "video"
        }
      ]
    },
    "response_mode": "blocking",
    "user": "'$USER_ID'"
  }')

echo "ワークフロー実行結果:"
echo "$WORKFLOW_RESPONSE" | jq 