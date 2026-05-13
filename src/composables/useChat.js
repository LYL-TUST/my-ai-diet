export function useChat() {
    const streamResponse = async (userMessage, onChunk, signal, history = []) => {
        try {
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
                    return
                }

                buffer += decoder.decode(value, { stream: true })
                buffer = buffer.replace(/\r/g, '')

                const frames = buffer.split('\n\n')
                buffer = frames.pop() || ''

                for (const frame of frames) {
                    const lines = frame.split('\n')
                    for (const line of lines) {
                        const trimmed = line.trim()
                        if (!trimmed.startsWith('data:')) continue

                        const dataStr = trimmed.slice(5).trim()
                        if (!dataStr) continue

                        // ===================== 【关键：过滤 [DONE]】 =====================
                        if (dataStr === '[DONE]' || dataStr.includes('"[DONE]"')) {
                            return
                        }

                        let parsed = null
                        try {
                            parsed = JSON.parse(dataStr)
                        } catch {
                            onChunk(dataStr)
                            continue
                        }

                        // ===================== 【关键：这里过滤】 =====================
                        if (parsed?.content && parsed.content !== "[DONE]") {
                            onChunk(parsed.content)
                        }

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
            if (error?.name === 'AbortError') return
            if (String(error?.message || '').toLowerCase().includes('aborted')) return

            console.error('Stream error:', error)
            throw error
        }
    }

    return {
        streamResponse
    }
}