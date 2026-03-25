export function useStorage() {
    const STORAGE_KEY = 'diet_chat_history'

    const loadMessages = () => {
        try {
            const data = localStorage.getItem(STORAGE_KEY)
            return data ? JSON.parse(data) : []
        } catch (error) {
            console.error('Failed to load messages:', error)
            return []
        }
    }

    const saveMessages = (messages) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
        } catch (error) {
            console.error('Failed to save messages:', error)
        }
    }

    return {
        loadMessages,
        saveMessages
    }
}
