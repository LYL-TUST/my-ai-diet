import express from 'express'
import cors from 'cors'
import WebSocket from 'ws'
import crypto from 'node:crypto'

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

// 星火 Spark Lite API 配置（从你控制台截图提供的信息填到环境变量里）
// 注意：星火官方 WebSocket 域名是 spark-api.xf-yun.com（带横杠）
const SPARK_HOST = 'spark-api.xf-yun.com'
const SPARK_PATH = '/v1.1/chat'

const SYSTEM_PROMPT = '你是一个专业的减脂饮食智能助手。你需要根据用户的问题提供准确、实用的减脂饮食建议。'

function buildSparkAuthorization({ apiKey, apiSecret, host, date, path }) {
    // 讯飞 WebSocket 鉴权：HMAC-SHA256(host/date/request-line) -> base64(signature)
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`
    const signatureSha = crypto.createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64')
    const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`
    // 注意：authorization 参数需要对 authorizationOrigin 再做一次 base64 编码（讯飞通用 URL 鉴权）
    return Buffer.from(authorizationOrigin, 'utf8').toString('base64')
}

function buildSparkWsUrl({ apiKey, apiSecret, host, path }) {
    // 讯飞 WebSocket 鉴权对 date 格式敏感；这里使用 toUTCString() 的默认输出（包含 GMT）
    const date = new Date().toUTCString()
    const authorization = buildSparkAuthorization({ apiKey, apiSecret, host, date, path })
    // authorization/date/host 都需要放到 querystring
    return `wss://${host}${path}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(
        date
    )}&host=${encodeURIComponent(host)}`
}

app.post('/api/chat', async (req, res) => {
    const { message, history } = req.body || {}

    if (!message) {
        return res.status(400).json({ error: 'Message is required' })
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    try {
        const SPARK_APP_ID = process.env.SPARK_APP_ID || ''
        const SPARK_API_KEY = process.env.SPARK_API_KEY || ''
        const SPARK_API_SECRET = process.env.SPARK_API_SECRET || ''

        if (!SPARK_APP_ID || !SPARK_API_KEY || !SPARK_API_SECRET) {
            throw new Error('Missing env vars: SPARK_APP_ID / SPARK_API_KEY / SPARK_API_SECRET')
        }

        const wsUrl = buildSparkWsUrl({
            apiKey: SPARK_API_KEY,
            apiSecret: SPARK_API_SECRET,
            host: SPARK_HOST,
            path: SPARK_PATH
        })

        const normalizedHistory = Array.isArray(history) ? history : []

        // 将历史裁剪，避免上下文过长
        const cleanedHistory = normalizedHistory
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
            .slice(-10)
            .map((m) => ({
                role: m.role,
                // 简单截断内容，减少 token 压力
                content: m.content.slice(-1200)
            }))

        // lite 模型：parameter.chat.domain = "lite"
        // 说明：Lite 通常不支持 system role，这里把 SYSTEM_PROMPT 仅在“首轮对话”时拼到第一条 user 内容里
        const firstTurn = cleanedHistory.length === 0
        const currentUserContent = firstTurn
            ? `${SYSTEM_PROMPT}\n\n用户问题：${message}`
            : String(message)

        const sparkText = [...cleanedHistory, { role: 'user', content: currentUserContent }]

        const sparkRequest = {
            header: {
                app_id: SPARK_APP_ID,
                uid: `uid-${Date.now()}`
            },
            parameter: {
                chat: {
                    domain: 'lite',
                    temperature: 0.5,
                    // max_tokens 在不同版本有范围限制；先用一个偏保守的值即可
                    max_tokens: 2048
                }
            },
            payload: {
                message: {
                    text: sparkText
                }
            }
        }

        const ws = new WebSocket(wsUrl)

        let finished = false
        let anyContentSent = false
        let stopWithError = false
        let debugWsMsgCount = 0

        const extractContents = (json) => {
            const textNode = json?.payload?.choices?.text
            const contents = []

            if (Array.isArray(textNode)) {
                for (const t of textNode) {
                    const c = t?.content
                    if (c) contents.push(c)
                }
            } else if (typeof textNode === 'string') {
                if (textNode) contents.push(textNode)
            } else if (textNode && typeof textNode === 'object') {
                if (textNode?.content) contents.push(textNode.content)
            }

            return contents
        }

        const finish = ({ sendDone = true } = {}) => {
            if (finished) return
            finished = true
            try {
                ws.close()
            } catch {}
            try {
                if (sendDone && !res.writableEnded) {
                    // SSE 完成标记
                    res.write('data: [DONE]\n\n')
                }
            } catch {}
            try {
                if (!res.writableEnded) res.end()
            } catch {}
        }

        // 防止网络/鉴权问题导致一直挂起
        let timeoutId = setTimeout(() => {
            console.error('Spark timeout')
            stopWithError = true
            res.write(
                `data: ${JSON.stringify({
                    error: { type: 'timeout', message: '请求超时，请稍后重试。' }
                })}\n\n`
            )
            finish({ sendDone: false })
        }, 60000)

        // 客户端主动中断（前端 Abort/停止生成）时，关闭上游连接并释放资源
        // 用 res 事件而不是 req 事件，更符合 SSE 场景（req close 可能会在早期就触发）。
        res.on('close', () => {
            if (!finished) {
                clearTimeout(timeoutId)
                finish({ sendDone: false })
            }
        })

        ws.on('open', () => {
            ws.send(JSON.stringify(sparkRequest))
        })

        ws.on('unexpected-response', (req, response) => {
            stopWithError = true
            console.error('Spark unexpected-response:', response?.statusCode, response?.statusMessage)
            const status = response?.statusCode
            res.write(
                `data: ${JSON.stringify({
                    error: {
                        type: status === 401 ? 'auth' : 'network',
                        message: `星火 WebSocket 握手失败：HTTP ${status || 'unknown'}`
                    }
                })}\n\n`
            )
            finish({ sendDone: false })
        })

        ws.on('message', (data) => {
            try {
                const raw = data.toString()
                debugWsMsgCount++

                const handleJson = (json) => {
                    const contents = extractContents(json)
                    if (contents.length > 0) {
                        for (const content of contents) {
                            // 标准 SSE：每次增量写入一个 data frame
                            res.write(`data: ${JSON.stringify({ content })}\n\n`)
                            anyContentSent = true
                        }
                    }

                    const status = json?.payload?.choices?.status
                    const headerStatus = json?.header?.status
                    if (status === 2 || headerStatus === 2) {
                        clearTimeout(timeoutId)
                        finish()
                        return true
                    }

                    // 非 0 code 的情况（鉴权/参数问题）
                    const code = json?.header?.code
                    if (code && code !== 0 && !finished) {
                        clearTimeout(timeoutId)
                        stopWithError = true
                        res.write(
                            `data: ${JSON.stringify({
                                error: {
                                    type: String(code) === '401' ? 'auth' : 'server',
                                    message: `星火调用失败：${json?.header?.message || '未知错误'}`
                                }
                            })}\n\n`
                        )
                        finish({ sendDone: false })
                        return true
                    }

                    return false
                }

                // 优先：整条消息作为一个 JSON 解析，避免错误地按换行切割 JSON
                try {
                    const json = JSON.parse(raw)
                    if (handleJson(json)) return
                    return
                } catch {
                    // ignore and fallback to line split
                }

                // fallback：可能存在多段 JSON，用换行切分逐段解析
                const parts = raw.split('\n').map((s) => s.trim()).filter(Boolean)
                for (const part of parts) {
                    let json = null
                    try {
                        json = JSON.parse(part)
                    } catch {
                        continue
                    }
                    if (handleJson(json)) return
                }
            } catch (e) {
                console.error('Spark message parse error:', e)
            }
        })

        ws.on('error', (err) => {
            if (finished) return
            clearTimeout(timeoutId)
            console.error('Spark WS error:', err)
            stopWithError = true
            const msg = err?.message || ''
            const type = msg.includes('401') ? 'auth' : 'network'
            res.write(
                `data: ${JSON.stringify({
                    error: {
                        type,
                        message: `星火 WebSocket 请求失败：${msg || '未知错误'}`
                    }
                })}\n\n`
            )
            finish({ sendDone: false })
        })

        ws.on('close', () => {
            if (!finished) {
                clearTimeout(timeoutId)
                // close 时如果完全没发过 content，说明解析/字段提取可能不匹配
                if (!anyContentSent && !stopWithError) {
                    res.write(
                        `data: ${JSON.stringify({
                            error: { type: 'no_content', message: '未获取到模型回复内容，请检查字段解析或参数。' }
                        })}\n\n`
                    )
                }
                finish()
            }
        })
    } catch (error) {
        console.error('Error:', error)
        res.write(
            `data: ${JSON.stringify({
                error: { type: 'unknown', message: error.message || '未知错误' }
            })}\n\n`
        )
        res.end()
    }
})

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`)
    console.log('Using iFlytek Spark Lite (WebSocket) API')
})
