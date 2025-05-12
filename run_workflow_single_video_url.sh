#!/bin/bash

# Difyワークフローに1つの動画をURLで渡して実行するスクリプト
# .envファイルからAPIキーを読み込みます

# === .env の読み込み ===
if [ -f ./.env ]; then
  source ./.env
else
  echo ".envが見つかりません。"
  exit 1
fi

# === 設定 ===
API_KEY="$SINGLE_VIDEO_URL_API_KEY"
WORKFLOW_URL="https://api.dify.ai/v1/workflows/run"
VIDEO_URL="https://samplelib.com/lib/preview/mp4/sample-5s.mp4"
USER_ID="user"

# === 実行 ===
curl -X POST "$WORKFLOW_URL" \
  --header "Authorization: Bearer $API_KEY" \
  --header "Content-Type: application/json" \
  --data-raw "{
    \"inputs\": {
      \"video\": {
        \"type\": \"video\",
        \"transfer_method\": \"remote_url\",
        \"url\": \"$VIDEO_URL\"
      }
    },
    \"user\": \"$USER_ID\",
    \"response_mode\": \"blocking\"
  }" | jq