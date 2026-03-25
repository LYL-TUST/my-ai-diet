export function useChat() {
    const streamResponse = async (userMessage, onChunk, signal, history = []) => {
        try {
            // 方法1：直接请求后端，避免依赖 Vite proxy 生效导致的 404。
            const response = await fetch('http://localhost:3001/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message: userMessage, history }),
                signal
            })

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                if (signal?.aborted) {
                    // 用户主动停止：直接结束，不当作错误打印
                    return
                }

                buffer += decoder.decode(value, { stream: true })
                // 兼容 Windows 风格换行
                buffer = buffer.replace(/\r/g, '')

                // SSE：以空行分帧，每帧里通常有一行 `data: ...`
                const frames = buffer.split('\n\n')
                buffer = frames.pop() || ''

                for (const frame of frames) {
                    const lines = frame.split('\n')
                    for (const line of lines) {
                        const trimmed = line.trim()
                        if (!trimmed.startsWith('data:')) continue

                        const dataStr = trimmed.slice(5).trim() // 去掉 `data:`
                        if (!dataStr) continue

                        if (dataStr === '[DONE]') {
                            return
                        }

                        // data 可能是 JSON（我们后端这么发），也可能是纯文本
                        let parsed = null
                        try {
                            parsed = JSON.parse(dataStr)
                        } catch {
                            onChunk(dataStr)
                            continue
                        }

                        if (parsed?.content) onChunk(parsed.content)

                        if (parsed?.error) {
                            const errObj = parsed.error
                            const message =
                                typeof errObj === 'string'
                                    ? errObj
                                    : errObj?.message || '未知错误'
                            const type = typeof errObj === 'string' ? 'unknown' : errObj?.type || 'unknown'
                            const e = new Error(message)
                            e.type = type
                            throw e
                        }
                    }
                }
            }
        } catch (error) {
            // 用户停止生成时，fetch stream 会中断；这是正常行为
            if (error?.name === 'AbortError') return
            // 某些浏览器里 abort 可能表现为其他 message
            if (String(error?.message || '').toLowerCase().includes('aborted')) return

            console.error('Stream error:', error)
            throw error
        }
    }

    return {
        streamResponse
    }
}
