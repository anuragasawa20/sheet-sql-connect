import { NextResponse } from 'next/server'
import { addConnection, removeConnection } from '@/lib/sse-broadcaster'

/**
 * GET /api/sync/sse
 * Server-Sent Events endpoint for real-time sync notifications
 * 
 * Query params: { sheetId: string }
 * 
 * Clients connect to this endpoint and receive events when
 * database sync completes from Google Sheets.
 * 
 * Flow:
 * 1. Client connects via EventSource
 * 2. Server stores connection in memory
 * 3. When sync completes, server broadcasts event to all connected clients
 * 4. Client receives event and refreshes UI
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url)
    const sheetId = searchParams.get('sheetId')
    
    if (!sheetId) {
        return NextResponse.json(
            { error: 'sheetId query parameter is required' },
            { status: 400 }
        )
    }
    
    // Create SSE response stream
    const encoder = new TextEncoder()
    
    const stream = new ReadableStream({
        start(controller) {
            // Send initial connection confirmation
            const connectMessage = `data: ${JSON.stringify({ type: 'connected', sheetId, timestamp: new Date().toISOString() })}\n\n`
            controller.enqueue(encoder.encode(connectMessage))
            
            // Store controller for broadcasting
            addConnection(sheetId, controller)
            
            // Send heartbeat every 30 seconds to keep connection alive
            const heartbeatInterval = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(`: heartbeat\n\n`))
                } catch (error) {
                    clearInterval(heartbeatInterval)
                    removeConnection(sheetId, controller)
                }
            }, 30000) // 30 seconds
            
            // Cleanup on close/disconnect
            request.signal.addEventListener('abort', () => {
                clearInterval(heartbeatInterval)
                removeConnection(sheetId, controller)
            })
        }
    })
    
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no', // Disable buffering in nginx
        },
    })
}

