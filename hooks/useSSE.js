import { useEffect, useRef } from 'react'

/**
 * Custom hook for Server-Sent Events
 * Connects to SSE endpoint and listens for sync events
 * 
 * @param {string} sheetId - Google Sheet ID
 * @param {Function} onSyncComplete - Callback when sync event received
 * 
 * @example
 * useSSE(sheetId, (event) => {
 *   console.log('Sync completed:', event)
 *   refreshData()
 * })
 */
export function useSSE(sheetId, onSyncComplete) {
    const eventSourceRef = useRef(null)

    useEffect(() => {
        if (!sheetId) {
            return
        }

        // Create EventSource connection
        const eventSource = new EventSource(`/api/sync/sse?sheetId=${encodeURIComponent(sheetId)}`)
        eventSourceRef.current = eventSource

        // Listen for messages
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)

                if (data.type === 'sync-completed') {
                    console.log('📡 SSE: Sync completed event received', data)
                    if (onSyncComplete) {
                        onSyncComplete(data)
                    }
                } else if (data.type === 'connected') {
                    console.log('📡 SSE: Connected to server', data)
                }
            } catch (error) {
                console.error('Error parsing SSE message:', error)
            }
        }

        // Handle connection errors
        eventSource.onerror = (error) => {
            console.error('SSE connection error:', error)
            // EventSource will automatically attempt to reconnect
        }

        // Handle connection open
        eventSource.onopen = () => {
            console.log('📡 SSE: Connection opened for sheet', sheetId)
        }

        // Cleanup on unmount
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close()
                eventSourceRef.current = null
                console.log('📡 SSE: Connection closed for sheet', sheetId)
            }
        }
    }, [sheetId, onSyncComplete])

    return eventSourceRef.current
}

