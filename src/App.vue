<template>
  <div class="app-container">
    <!-- 头部 -->
    <header class="app-header">
      <div class="header-content">
        <h1 class="app-title">🥗 减脂饮食助手</h1>
        <p class="app-subtitle">AI 智能营养建议</p>
      </div>
      <button class="clear-btn" @click="clearHistory" title="清空对话">
        <span>🗑️</span>
      </button>
    </header>

    <!-- 聊天区域 -->
    <main class="chat-container">
      <div class="messages-wrapper">
        <div
          v-for="(msg, idx) in messages"
          :key="idx"
          :class="['message', msg.role]"
        >
          <div class="message-avatar">
            {{ msg.role === 'user' ? '👤' : '🤖' }}
          </div>
          <div class="message-content">
            <div class="message-text" v-html="renderMarkdown(msg.content)"></div>
            <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
            <button
              v-if="msg.role === 'assistant' && msg.retryable"
              class="retry-btn"
              @click="retryAssistant(idx, msg.retryUserMessage)"
            >
              继续
            </button>
          </div>
        </div>

        <!-- 加载指示器 -->
        <div v-if="loading" class="message assistant">
          <div class="message-avatar">🤖</div>
          <div class="message-content">
            <div class="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 快捷按钮 -->
    <section class="quick-buttons">
      <button
        v-for="btn in quickButtons"
        :key="btn"
        class="quick-btn"
        @click="sendQuickQuestion(btn)"
        :disabled="loading || isStopped"
      >
        {{ btn }}
      </button>
    </section>

    <!-- 输入区域 -->
    <footer class="input-section">
      <div class="input-wrapper">
        <input
          v-model="userInput"
          type="text"
          class="input-field"
          placeholder="输入你的饮食问题..."
          @keyup.enter="sendMessage"
          :disabled="loading || isStopped"
        />
        <button
          class="send-btn"
          @click="sendMessage"
          :disabled="loading || isStopped || !userInput.trim()"
        >
          <span v-if="!loading">发送</span>
          <span v-else class="loading-spinner"></span>
        </button>
        <button
          class="stop-btn"
          @click="isStopped ? continueAfterStop() : stopGeneration()"
          :disabled="!loading && !isStopped"
        >
          {{ isStopped ? '继续' : '停止' }}
        </button>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useChat } from './composables/useChat'
import { useStorage } from './composables/useStorage'

const userInput = ref('')
const loading = ref(false)
const messages = ref([])
let abortController = null
let stopRequested = false
const isStopped = ref(false)
let currentAssistantIndex = -1
let currentUserMessageForStop = ''

const { loadMessages, saveMessages } = useStorage()
const { streamResponse } = useChat()

const quickButtons = [
  '一个鸡腿多少热量',
  '全麦面包热量高吗',
  '减脂一日三餐搭配',
  '减肥能吃烧饼吗'
]

const renderMarkdown = (text) => {
  if (!text) return ''
  // marked 输出 HTML，使用 DOMPurify 进行安全过滤，避免 XSS
  const html = marked.parse(String(text), { breaks: true, gfm: true })
  return DOMPurify.sanitize(html)
}

onMounted(() => {
  messages.value = loadMessages()
  scrollToBottom()
})

const scrollToBottom = async () => {
  await nextTick()
  const wrapper = document.querySelector('.messages-wrapper')
  if (wrapper) {
    wrapper.scrollTop = wrapper.scrollHeight
  }
}

const sendMessage = async () => {
  if (!userInput.value.trim() || loading.value) return

  // 提前置为 loading，避免在任意 await 期间重复触发导致请求被客户端关闭
  loading.value = true

  stopRequested = false
  isStopped.value = false

  const userMsg = userInput.value.trim()
  userInput.value = ''
  const userTimestamp = Date.now()

  currentUserMessageForStop = userMsg

  messages.value.push({
    role: 'user',
    content: userMsg,
    timestamp: userTimestamp
  })

  await scrollToBottom()
  // loading 已在开头置为 true

  let assistantIndex = -1

  try {
    stopRequested = false
    // 先插入 assistant 占位，保证流式过程中也能实时更新 UI
    abortController = new AbortController()
    const { signal } = abortController

    assistantIndex = messages.value.push({
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    }) - 1

    currentAssistantIndex = assistantIndex

    let aiResponse = ''
    let lastScrollTs = 0
    const maybeScroll = () => {
      const now = Date.now()
      // 简单节流，避免每个 chunk 都触发 nextTick/DOM 查询
      if (now - lastScrollTs > 120) {
        lastScrollTs = now
        scrollToBottom()
      }
    }

    await streamResponse(userMsg, (chunk) => {
      aiResponse += chunk
      if (messages.value[assistantIndex]) {
        messages.value[assistantIndex].content = aiResponse
        maybeScroll()
      }
    }, signal, messages.value.filter((m) => {
      if (!m || typeof m.content !== 'string' || !m.content.trim()) return false
      if (m.timestamp >= userTimestamp) return false
      return m.role === 'user' || m.role === 'assistant'
    }))

    // 流结束后再确保一次最终内容
    if (messages.value[assistantIndex]) {
      if (stopRequested) {
        // 用户点了停止：无论已输出多少，都给一个“继续”按钮
        messages.value[assistantIndex].retryable = true
        messages.value[assistantIndex].retryUserMessage = userMsg
        isStopped.value = true
        if (!aiResponse.trim()) {
          messages.value[assistantIndex].content = '已停止生成'
        }
      } else if (!aiResponse.trim()) {
        // 兜底：没有收到任何增量，也没有 error 时给出“可重试”的提示
        messages.value[assistantIndex].content = '未获取到模型回复，请稍后重试。'
        messages.value[assistantIndex].retryable = true
        messages.value[assistantIndex].retryUserMessage = userMsg
      } else {
        messages.value[assistantIndex].content = aiResponse
        isStopped.value = false
      }
    }

    saveMessages(messages.value)
  } catch (error) {
    console.error('Error:', error)
    if (error?.name === 'AbortError') {
      // 用户主动停止生成：保留已生成的内容即可
      const cur = messages.value[assistantIndex]?.content || ''
      if (!String(cur).trim()) messages.value[assistantIndex].content = '已停止生成'
      messages.value[assistantIndex].retryable = true
      messages.value[assistantIndex].retryUserMessage = userMsg
      isStopped.value = true
      return
    }
    const type = error?.type || 'unknown'
    const messageByType = {
      timeout: '请求超时，请稍后重试。',
      auth: '鉴权失败，请检查星火 AppID / APIKey / APISecret。',
      network: '网络连接失败，请检查网络/代理后重试。',
      unknown: '抱歉，出现了一些问题，请稍后重试。'
    }[type]

    if (messages.value[assistantIndex]) {
      messages.value[assistantIndex].content = messageByType
      messages.value[assistantIndex].timestamp = Date.now()
      messages.value[assistantIndex].retryable = true
      messages.value[assistantIndex].retryUserMessage = userMsg
    }

    saveMessages(messages.value)
  } finally {
    loading.value = false
    abortController = null
    await scrollToBottom()
  }
}

const continueAfterStop = async () => {
  // 继续生成使用当前停止对应的 assistant 消息
  if (!isStopped.value) return
  if (currentAssistantIndex < 0) return

  const msg = messages.value[currentAssistantIndex]
  if (!msg || msg.role !== 'assistant' || !msg.retryable) return

  isStopped.value = false
  stopRequested = false
  await retryAssistant(currentAssistantIndex, currentUserMessageForStop || msg.retryUserMessage)
}

const stopGeneration = () => {
  if (!abortController) return
  stopRequested = true
  isStopped.value = true

  // 立即标记当前 assistant 可继续生成，避免 UI 等 catch/finally 才出现按钮
  if (currentAssistantIndex >= 0 && messages.value[currentAssistantIndex]) {
    const msg = messages.value[currentAssistantIndex]
    if (msg.role === 'assistant') {
      msg.retryable = true
      msg.retryUserMessage = currentUserMessageForStop
      if (!String(msg.content || '').trim()) {
        msg.content = '已停止生成'
      }
      msg.timestamp = Date.now()
    }
  }

  abortController.abort()
}

const retryAssistant = async (assistantIndex, userMsg) => {
  if (loading.value) return
  if (!messages.value[assistantIndex] || messages.value[assistantIndex].role !== 'assistant') return
  const msg = messages.value[assistantIndex]
  if (!msg.retryable) return

  loading.value = true

  try {
    isStopped.value = false
    stopRequested = false
    abortController = new AbortController()
    const { signal } = abortController

    // 清掉错误态，开始重新生成
    msg.content = ''
    msg.timestamp = Date.now()
    msg.retryable = false
    msg.retryUserMessage = userMsg

    let aiResponse = ''
    let lastScrollTs = 0
    const maybeScroll = () => {
      const now = Date.now()
      if (now - lastScrollTs > 120) {
        lastScrollTs = now
        scrollToBottom()
      }
    }

    // 为重试也带入上下文：取“当前要回答的那条用户消息”之前的历史
    let currentUserTimestamp = null
    for (let i = assistantIndex - 1; i >= 0; i--) {
      const m = messages.value[i]
      if (m?.role === 'user' && m?.content === userMsg) {
        currentUserTimestamp = m.timestamp
        break
      }
    }

    const contextHistory = messages.value.filter((m) => {
      if (!m || typeof m.content !== 'string' || !m.content.trim()) return false
      if (m.role !== 'user' && m.role !== 'assistant') return false
      if (currentUserTimestamp != null && m.timestamp >= currentUserTimestamp) return false
      return true
    })

    await streamResponse(
      userMsg,
      (chunk) => {
      aiResponse += chunk
      msg.content = aiResponse
      maybeScroll()
      },
      signal,
      contextHistory
    )

    if (stopRequested && !aiResponse.trim()) {
      msg.content = '已停止生成'
    } else if (!aiResponse.trim()) {
      msg.content = '未获取到模型回复，请稍后重试。'
      msg.retryable = true
      msg.retryUserMessage = userMsg
    } else {
      msg.content = aiResponse
    }
    saveMessages(messages.value)
  } catch (error) {
    console.error('Retry error:', error)
    if (error?.name === 'AbortError') return
    const type = error?.type || 'unknown'
    const messageByType = {
      timeout: '请求超时，请稍后重试。',
      auth: '鉴权失败，请检查星火 AppID / APIKey / APISecret。',
      network: '网络连接失败，请检查网络/代理后重试。',
      unknown: '抱歉，出现了一些问题，请稍后重试。'
    }[type]
    msg.content = messageByType
    msg.timestamp = Date.now()
    msg.retryable = true
    msg.retryUserMessage = userMsg
    saveMessages(messages.value)
  } finally {
    loading.value = false
    abortController = null
    await scrollToBottom()
  }
}

const sendQuickQuestion = (question) => {
  userInput.value = question
  sendMessage()
}

const clearHistory = () => {
  if (confirm('确定要清空所有对话吗？')) {
    messages.value = []
    saveMessages([])
  }
}

const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: linear-gradient(135deg, #faf9f7 0%, #f5f3f0 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue',
    sans-serif;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  background: linear-gradient(135deg, #fff9f5 0%, #fffbf8 100%);
  border-bottom: 1px solid rgba(200, 150, 120, 0.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.header-content {
  flex: 1;
}

.app-title {
  font-size: 24px;
  font-weight: 600;
  color: #2c2416;
  letter-spacing: -0.5px;
}

.app-subtitle {
  font-size: 12px;
  color: #a89080;
  margin-top: 4px;
}

.clear-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: rgba(200, 150, 120, 0.08);
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-btn:hover {
  background: rgba(200, 150, 120, 0.15);
  transform: scale(1.05);
}

.clear-btn:active {
  transform: scale(0.95);
}

.chat-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
}

.messages-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  overflow-y: auto;
  padding-right: 8px;
}

.messages-wrapper::-webkit-scrollbar {
  width: 6px;
}

.messages-wrapper::-webkit-scrollbar-track {
  background: transparent;
}

.messages-wrapper::-webkit-scrollbar-thumb {
  background: rgba(200, 150, 120, 0.2);
  border-radius: 3px;
}

.messages-wrapper::-webkit-scrollbar-thumb:hover {
  background: rgba(200, 150, 120, 0.4);
}

.message {
  display: flex;
  gap: 12px;
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message.user {
  justify-content: flex-end;
}

.message-avatar {
  font-size: 24px;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 70%;
}

.message.user .message-content {
  align-items: flex-end;
}

.message-text {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  word-break: break-word;
  font-size: 14px;
}

.message-text :deep(p) {
  margin: 0 0 8px 0;
}

.message-text :deep(pre) {
  margin: 8px 0;
  padding: 12px 14px;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 10px;
  overflow-x: auto;
}

.message-text :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  font-size: 13px;
}

.message-text :deep(ul),
.message-text :deep(ol) {
  padding-left: 20px;
  margin: 0 0 8px 0;
}

.message-text :deep(a) {
  color: #c89560;
  text-decoration: underline;
}

.message.user .message-text {
  background: linear-gradient(135deg, #d4a574 0%, #c89560 100%);
  color: white;
  border-bottom-right-radius: 4px;
  box-shadow: 0 2px 8px rgba(212, 165, 116, 0.2);
}

.message.assistant .message-text {
  background: white;
  color: #2c2416;
  border-bottom-left-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid rgba(200, 150, 120, 0.1);
}

.message-time {
  font-size: 11px;
  color: #a89080;
  padding: 0 4px;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c89560;
  animation: typing 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%,
  60%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-8px);
  }
}

.quick-buttons {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  padding: 16px 24px;
  background: linear-gradient(135deg, #fff9f5 0%, #fffbf8 100%);
  border-top: 1px solid rgba(200, 150, 120, 0.1);
}

.quick-btn {
  padding: 10px 14px;
  border: 1px solid rgba(200, 150, 120, 0.2);
  background: white;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  color: #2c2416;
  transition: all 0.2s ease;
  font-weight: 500;
}

.quick-btn:hover:not(:disabled) {
  background: rgba(212, 165, 116, 0.08);
  border-color: rgba(200, 150, 120, 0.4);
  transform: translateY(-2px);
}

.quick-btn:active:not(:disabled) {
  transform: translateY(0);
}

.quick-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-section {
  padding: 16px 24px 24px;
  background: linear-gradient(135deg, #faf9f7 0%, #f5f3f0 100%);
}

.input-wrapper {
  display: flex;
  gap: 10px;
  background: white;
  border: 1px solid rgba(200, 150, 120, 0.15);
  border-radius: 12px;
  padding: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: all 0.2s ease;
}

.input-wrapper:focus-within {
  border-color: rgba(200, 150, 120, 0.4);
  box-shadow: 0 4px 12px rgba(212, 165, 116, 0.1);
}

.input-field {
  flex: 1;
  border: none;
  outline: none;
  padding: 10px 12px;
  font-size: 14px;
  color: #2c2416;
  background: transparent;
  font-family: inherit;
}

.input-field::placeholder {
  color: #a89080;
}

.input-field:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.send-btn {
  padding: 8px 20px;
  background: linear-gradient(135deg, #d4a574 0%, #c89560 100%);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 60px;
}

.send-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(212, 165, 116, 0.3);
}

.send-btn:active:not(:disabled) {
  transform: translateY(0);
}

.send-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.stop-btn {
  padding: 8px 14px;
  background: rgba(200, 150, 120, 0.12);
  color: #2c2416;
  border: 1px solid rgba(200, 150, 120, 0.25);
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
  min-width: 60px;
}

.stop-btn:hover:not(:disabled) {
  background: rgba(200, 150, 120, 0.18);
  border-color: rgba(200, 150, 120, 0.45);
  transform: translateY(-1px);
}

.stop-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.retry-btn {
  margin-top: 6px;
  padding: 6px 12px;
  background: rgba(200, 150, 120, 0.12);
  border: 1px solid rgba(200, 150, 120, 0.25);
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  color: #2c2416;
  transition: all 0.2s ease;
  align-self: flex-end;
}

.retry-btn:hover:not(:disabled) {
  background: rgba(212, 165, 116, 0.18);
  border-color: rgba(200, 150, 120, 0.45);
  transform: translateY(-1px);
}

.retry-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .app-header {
    padding: 16px 16px;
  }

  .app-title {
    font-size: 20px;
  }

  .chat-container {
    padding: 16px;
  }

  .message-content {
    max-width: 85%;
  }

  .quick-buttons {
    grid-template-columns: repeat(2, 1fr);
    padding: 12px 16px;
    gap: 8px;
  }

  .quick-btn {
    font-size: 11px;
    padding: 8px 10px;
  }

  .input-section {
    padding: 12px 16px 16px;
  }
}
</style>