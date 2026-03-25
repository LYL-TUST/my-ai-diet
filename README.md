# 减脂饮食智能助手（Vue3 + 流式对话）

一个前后端分离的个人减脂饮食 AI 助手：前端使用 Vue3 展示聊天界面，并通过 **SSE 流式**接收模型增量；后端使用 **Express + WebSocket**对接讯飞星火 Spark Lite，并把增量转为前端可消费的 SSE 流。

> 适合用于前端实习项目展示：包含流式渲染、停止生成/继续生成、Markdown 渲染、安全过滤、对接 WebSocket 模型等工程能力。

## 功能亮点

- 基于 Vue3/Vite 的聊天 UI，支持**流式输出**（逐字/逐段更新）
- 对接讯飞星火 Spark Lite（WebSocket），后端把回复转换为前端可用的 SSE 数据帧
- **停止生成**：立即中断流式请求，并在停止期间禁用输入框与快捷按钮，避免并发请求
- **继续生成**：点击停止后会切换为继续按钮，支持对同一条会话继续生成
- 聊天内容使用 Markdown 渲染（`marked`）并通过 `DOMPurify` 进行 XSS 清理
- 聊天支持**聊天历史带入模型**（前端传历史给后端；后端拼入 `payload.message.text`）
- 前后端统一错误结构（鉴权失败/超时/网络错误等）

## 技术栈

- 前端：Vue3、Vite、Fetch SSE 流读取、Markdown 渲染（marked）、XSS 过滤（DOMPurify）
- 后端：Node.js、Express、`ws`（WebSocket）、`crypto`（鉴权签名）、SSE 输出

## 运行环境

- Node.js（建议 18+）
- 浏览器支持 `ReadableStream` 与 `fetch` 流式读取

## 环境变量（必填）

后端（`server.js`）需要以下环境变量：

- `SPARK_APP_ID`：讯飞星火 AppID
- `SPARK_API_KEY`：讯飞星火 APIKey
- `SPARK_API_SECRET`：讯飞星火 APISecret

在启动后端前，在终端设置（Windows CMD 示例）：

```bat
set SPARK_APP_ID=e84a17fb
set SPARK_API_KEY=a34785a8bd30aa8a85173da4fa0bb1a8
set SPARK_API_SECRET=N2M3Y2FkZTY3NTBjNmRlNGFhNzgwMTBh
npm run server
```

## 快速开始

### 1. 安装依赖

```bat
cd my-ai-diet
npm install
```

### 2. 启动后端（3001）

```bat
npm run server
```

后端监听：`http://localhost:3001`

### 3. 启动前端（5173）

另开终端：

```bat
npm run dev
```

前端：`http://localhost:5173`

## 使用说明

- 输入你的饮食/热量/搭配问题，按“发送”
- 回复会以流式方式逐步显示
- 点击“停止”：停止生成，并将按钮切换为“继续”
- 点击“继续”：对同一条会话继续生成

## 后端接口说明

### `POST /api/chat`

- 请求体：
  - `message`：用户输入字符串
  - `history`：可选，前端传入的聊天历史（`role: user|assistant`，`content` 为文本）
- 响应：
  - `text/event-stream`（SSE）
  - 增量帧：`data: {"content":"..."}\n\n`
  - 完成帧：`data: [DONE]\n\n`
  - 错误帧：`data: {"error":{"type":"auth|timeout|network|no_content|unknown","message":"..."}}\n\n`

前端会持续读取流并把 `content` 增量拼接到当前 assistant 消息中。

## 对话历史如何带入模型

- 前端在发送时会收集“当前用户问题之前”的 `user/assistant` 历史，并传给后端
- 后端对历史做裁剪（避免上下文过长），然后拼入星火 Spark Lite 要求的：
  - `payload.message.text = [...history, { role: "user", content: currentTurnContent }]`
- 首轮对话：后端将 `SYSTEM_PROMPT` 拼到第一条 user 内容里

## 常见问题排查

1. **前端显示“未获取到模型回复”**
   - WebSocket 回包解析不到 `payload.choices.text.content`
   - 或鉴权/网络问题导致握手失败

2. **鉴权失败**
   - 检查 `SPARK_*` 环境变量是否正确
   - 如你使用代理/Clash，确认星火相关域名放行且 TLS 握手正常

3. **停止后控制台出现中断类错误**
   - 这是停止生成时 fetch 流被中断的正常现象
   - 已在前端对 Abort 情况做静默处理，避免影响 UI
