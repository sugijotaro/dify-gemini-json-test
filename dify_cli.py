import os
from dotenv import load_dotenv
import requests
import mimetypes

# .envからAPIキーとBASE_URLをロード
load_dotenv()
DIFY_API_KEY = os.getenv('DIFY_API_KEY')
DIFY_BASE_URL = os.getenv('DIFY_BASE_URL')

if not DIFY_API_KEY:
    print("[ERROR] DIFY_API_KEYが設定されていません。環境変数または.envファイルを確認してください。")
    exit(1)
if not DIFY_BASE_URL:
    print("[ERROR] DIFY_BASE_URLが設定されていません。環境変数または.envファイルを確認してください。")
    exit(1)

FILE_PATH = 'example_video.mp4'
USER = 'user'


def upload_file(file_path, user):
    upload_url = f"{DIFY_BASE_URL.rstrip('/')}/files/upload"
    mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type:
        mime_type = 'application/octet-stream'
    headers = {
        "Authorization": f"Bearer {DIFY_API_KEY}",
    }
    try:
        with open(file_path, 'rb') as file:
            files = {
                'file': (os.path.basename(file_path), file, mime_type)
            }
            data = {
                "user": user,
                "type": "MP4"  # 動画ファイルなのでMP4
            }
            response = requests.post(upload_url, headers=headers, files=files, data=data)
            if response.status_code == 201:
                print("[INFO] ファイルが正常にアップロードされました")
                return response.json().get("id")
            else:
                print(f"[ERROR] ファイルのアップロードに失敗しました。ステータスコード: {response.status_code}")
                print(response.text)
                return None
    except Exception as e:
        print(f"[ERROR] ファイルアップロード中にエラー: {str(e)}")
        return None

def run_workflow(file_id, user, response_mode="blocking"):
    workflow_url = f"{DIFY_BASE_URL.rstrip('/')}/workflows/run"
    headers = {
        "Authorization": f"Bearer {DIFY_API_KEY}",
        "Content-Type": "application/json"
    }
    data = {
        "inputs": {
            "orig_mail": [{
                "transfer_method": "local_file",
                "upload_file_id": file_id,
                "type": "video"
            }]
        },
        "response_mode": response_mode,
        "user": user
    }
    try:
        print("[INFO] ワークフローを実行中...")
        response = requests.post(workflow_url, headers=headers, json=data)
        if response.status_code == 200:
            print("[INFO] ワークフローが正常に実行されました")
            print(response.json())
            return response.json()
        else:
            print(f"[ERROR] ワークフローの実行に失敗しました。ステータスコード: {response.status_code}")
            print(response.text)
            return None
    except Exception as e:
        print(f"[ERROR] ワークフロー実行中にエラー: {str(e)}")
        return None

def main():
    file_id = upload_file(FILE_PATH, USER)
    if not file_id:
        print("[ERROR] ファイルアップロードに失敗したため、ワークフローを実行できません。")
        return
    print(f"[INFO] アップロードファイルID: {file_id}")
    run_workflow(file_id, USER, response_mode="blocking")

if __name__ == '__main__':
    main() 