# 个人减脂饮食智能助手

## 项目简介

基于 Vue3 \+ FastAPI \+ 讯飞星火 Spark X1 开发的减脂饮食 AI 流式对话助手。专注食物热量查询、减脂饮食建议、三餐搭配指导，前端采用原生 SSE 实现逐字流式输出，拥有流畅的实时对话交互体验，适配个人减脂场景核心需求，可用于项目展示或个人日常使用。

## 技术栈

### 前端

- Vue3 组合式 API

- 原生 SSE 流式请求封装

- 自定义聊天交互逻辑

- 多轮对话上下文记忆功能

### 后端

- Python FastAPI 轻量后端框架

- 对接讯飞星火 Spark X1 WebSocket 官方接口

- CORS 跨域配置，兼容前端请求

- SSE 流式响应封装，实现逐字推送

### 第三方服务

- 讯飞星火大模型 Spark X1

## 核心功能

- 智能查询：食物热量、升糖指数、减脂适配度精准查询

- 饮食指导：减脂三餐搭配、饮食忌口、科学吃法专业建议

- 流式交互：AI 回答逐字实时输出，仿 ChatGPT 打字效果

- 上下文记忆：保留多轮对话历史，连续追问无需重复描述

- 简洁输出：专属系统提示词约束，回答精炼、不闲聊、不冗余

## 项目结构

```plain text
my-ai-diet/
├── src/                # Vue3 前端源码（页面、交互、请求封装）
├── python/
│   └── main.py         # FastAPI 后端唯一入口（对接讯飞星火）
├── .env                # 存放讯飞密钥（已加入.gitignore，不上传仓库）
├── README.md           # 项目说明文档
└── package.json        # 前端依赖配置
```

## 环境准备

### 版本要求

- Python：3\.8 及以上

- Node\.js：14 及以上

### 依赖安装

#### 后端依赖（Python）

```bash
# 进入python目录
cd python
# 安装依赖包
pip install fastapi uvicorn websocket-client
```

#### 前端依赖（Vue3）

```bash
# 项目根目录执行
npm install
```

### 讯飞密钥配置

1\. 前往 [讯飞开放平台控制台](https://console.xfyun.cn/services/bmx1)，开通 Spark X1 服务，获取 SPARK\_APP\_ID、SPARK\_API\_KEY、SPARK\_API\_SECRET 密钥。

2\. 在项目根目录新建 \.env 文件，填入密钥（替换为自己的信息）：

```env
SPARK_APP_ID=你的APPID
SPARK_API_KEY=你的APIKey
SPARK_API_SECRET=你的APISecret
```

## 项目运行

### 1\. 启动 FastAPI 后端

```bash
cd python
python main.py
```

后端默认运行地址：`http://localhost:3001`，启动成功后即可接收前端请求。

### 2\. 启动 Vue3 前端

```bash
npm run dev
```

前端启动后自动弹出浏览器窗口，默认地址：`http://localhost:5173`，进入页面即可使用对话功能。

## 项目优化亮点

- 鉴权优化：严格遵循讯飞官方 WebSocket 鉴权流程，解决接口 400 鉴权报错问题，确保服务稳定。

- 接口修复：解决 FastAPI 异步与同步混用引发的接口异常，提升接口响应稳定性。

- 速度优化：调低模型 max\_tokens（1024）和 temperature（0\.3），减少模型计算负担，显著提升响应速度。

- 输出优化：定制减脂专属系统提示词，约束 AI 回答贴合场景、简洁无冗余。

- 界面优化：前端过滤流式响应中的 \[DONE\] 结束标记，避免界面显示多余字符，提升交互体验。

- 架构优化：完全废弃 Node\.js 后端，统一使用 Python FastAPI 架构，精简项目结构，降低维护成本。

## 注意事项

- 讯飞 APPID、APIKey、APISecret 为敏感信息，严禁泄露、提交至代码仓库或公开分享。

- 项目固定适配讯飞星火 Spark X1 接口路径（/v1/x1）与 domain（spark\-x），请勿随意修改，否则会导致鉴权失败。

- 后端端口固定为 3001，前端 useChat\.js 中请求地址已固定，无需修改，确保前后端端口一致。

- 单次会话建议控制对话轮次，避免历史文本过长导致卡顿或 token 超限。

- 若出现接口报错，可查看 Python 终端日志，重点排查密钥配置、网络连接及讯飞服务开通状态。

