import os
from dotenv import load_dotenv
import requests

# .envからAPIキーとBASE_URLをロード
load_dotenv()
DIFY_API_KEY = os.getenv('DIFY_API_KEY')
DIFY_BASE_URL = os.getenv('DIFY_BASE_URL', 'https://api.dify.ai/v1')

if not DIFY_API_KEY:
    print("DIFY_API_KEYが設定されていません。")
    exit(1)

FILE_PATH = 'example_video.mp4'
USER = 'user'

def upload_file(file_path, user):
    upload_url = f"{DIFY_BASE_URL.rstrip('/')}/files/upload"
    headers = {
        "Authorization": f"Bearer {DIFY_API_KEY}",
    }
    try:
        print("ファイルをアップロードしています...")
        with open(file_path, 'rb') as file:
            files = {
                'file': (os.path.basename(file_path), file, 'video/mp4')
            }
            data = {
                "user": user,
                "type": "MP4"
            }
            response = requests.post(upload_url, headers=headers, files=files, data=data)
            if response.status_code == 201:
                print("ファイルが正常にアップロードされました")
                return response.json().get("id")
            else:
                print(f"ファイルのアップロードに失敗しました。ステータス コード: {response.status_code}")
                print(response.text)
                return None
    except Exception as e:
        print(f"エラーが発生しました: {str(e)}")
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
                "type": "document"
            }]
        },
        "response_mode": response_mode,
        "user": user
    }
    try:
        print("ワークフローを実行...")
        response = requests.post(workflow_url, headers=headers, json=data)
        if response.status_code == 200:
            print("ワークフローが正常に実行されました")
            print(response.json())
            return response.json()
        else:
            print(f"ワークフローの実行がステータス コードで失敗しました: {response.status_code}")
            print(response.text)
            return {"status": "error", "message": f"Failed to execute workflow, status code: {response.status_code}"}
    except Exception as e:
        print(f"エラーが発生しました: {str(e)}")
        return {"status": "error", "message": str(e)}

def main():
    file_id = upload_file(FILE_PATH, USER)
    if file_id:
        result = run_workflow(file_id, USER)
        print(result)
    else:
        print("ファイルのアップロードに失敗し、ワークフローを実行できません")

if __name__ == '__main__':
    main() 