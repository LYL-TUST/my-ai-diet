from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import json
import os
from queue import Queue
import websocket
import threading

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 讯飞配置
APPID = os.getenv("SPARK_APP_ID")
APIKey = os.getenv("SPARK_API_KEY")
APISecret = os.getenv("SPARK_API_SECRET")
SPARK_URL = "wss://spark-api.xf-yun.com/v1/x1"
DOMAIN = "spark-x"


def chat_stream(question):
    q = Queue()

    def on_message(ws, msg):
        data = json.loads(msg)
        if data["header"]["code"] != 0:
            q.put(None)
            return

        choices = data["payload"]["choices"]
        for item in choices["text"]:
            if "content" in item:
                content = item["content"]
                q.put(json.dumps({"content": content}))

        if choices["status"] == 2:
            q.put("[DONE]")

    def on_error(ws, error):
        q.put(None)

    def on_close(ws, *args):
        q.put(None)

    def on_open(ws):
        def run():
            ws.send(
                json.dumps(
                    {
                        "header": {"app_id": APPID, "uid": "1234"},
                        "parameter": {
                            "chat": {
                                "domain": DOMAIN,
                                "temperature": 0.3,  # 🔥 变快
                                "max_tokens": 1024,  # 🔥 变快非常多
                            }
                        },
                        "payload": {"message": {"text": question}},
                    }
                )
            )

        threading.Thread(target=run).start()

    # 鉴权
    from urllib.parse import urlparse, urlencode
    from datetime import datetime
    from time import mktime
    from wsgiref.handlers import format_date_time
    import base64
    import hmac
    import hashlib

    host = urlparse(SPARK_URL).netloc
    path = urlparse(SPARK_URL).path
    now = datetime.now()
    date = format_date_time(mktime(now.timetuple()))
    signature_origin = f"host: {host}\ndate: {date}\nGET {path} HTTP/1.1"
    signature_sha = hmac.new(
        APISecret.encode(), signature_origin.encode(), digestmod=hashlib.sha256
    ).digest()
    signature_sha_base64 = base64.b64encode(signature_sha).decode()
    authorization_origin = f'api_key="{APIKey}", algorithm="hmac-sha256", headers="host date request-line", signature="{signature_sha_base64}"'
    authorization = base64.b64encode(authorization_origin.encode()).decode()
    url = (
        SPARK_URL
        + "?"
        + urlencode({"authorization": authorization, "date": date, "host": host})
    )

    ws = websocket.WebSocketApp(
        url,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
        on_open=on_open,
    )
    threading.Thread(target=ws.run_forever, kwargs={"sslopt": {"cert_reqs": 0}}).start()

    while True:
        item = q.get()
        if item is None:
            break
        if item == "[DONE]":
            break
        yield f"data: {item}\n\n"


@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    message = body.get("message", "")
    history = body.get("history", [])
    prompt = """
你是专业减脂饮食助手。回答简洁、精准、不啰嗦。
只回答食物热量、减脂吃法、饮食建议，不闲聊、不拓展。
输出简短口语化，不要格式、不要换行、不要多余内容。
"""

    question = (
        [{"role": "user", "content": prompt}]
        + history
        + [{"role": "user", "content": message}]
    )

    return StreamingResponse(chat_stream(question), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=3001)
