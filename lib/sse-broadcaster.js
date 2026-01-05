/**
 * SSE Event Broadcaster
 * 
 * Manages Server-Sent Events connections and broadcasts events
 * to all connected clients when database sync completes.
 */

// Store active SSE connections: sheetId -> Set of controller functions
const connections = new Map()

/**
 * Add a new SSE connection
 * @param {string} sheetId - Google Sheet ID
 * @param {ReadableStreamDefaultController} controller - SSE stream controller
 */
export function addConnection(sheetId, controller) {
    if (!connections.has(sheetId)) {
        connections.set(sheetId, new Set())
    }
    connections.get(sheetId).add(controller)

    console.log(`📡 SSE connection added for sheet ${sheetId} (total: ${connections.get(sheetId).size})`)
}

/**
 * Remove an SSE connection
 * @param {string} sheetId - Google Sheet ID
 * @param {ReadableStreamDefaultController} controller - SSE stream controller
 */
export function removeConnection(sheetId, controller) {
    if (connections.has(sheetId)) {
        connections.get(sheetId).delete(controller)

        // Clean up empty sets
        if (connections.get(sheetId).size === 0) {
            connections.delete(sheetId)
        }

        console.log(`📡 SSE connection removed for sheet ${sheetId} (remaining: ${connections.get(sheetId)?.size || 0})`)
    }
}

/**
 * Broadcast sync event to all connected clients for a sheet
 * @param {string} sheetId - Google Sheet ID
 * @param {object} data - Event data to send
 */
export function broadcastSync(sheetId, data) {
    if (!connections.has(sheetId)) {
        console.log(`📡 No SSE connections for sheet ${sheetId}`)
        return
    }

    const message = `data: ${JSON.stringify(data)}\n\n`
    const encoder = new TextEncoder()
    const deadConnections = []

    connections.get(sheetId).forEach(controller => {
        try {
            controller.enqueue(encoder.encode(message))
        } catch (error) {
            console.error('❌ Error broadcasting SSE message:', error)
            deadConnections.push(controller)
        }
    })

    // Clean up dead connections
    deadConnections.forEach(controller => {
        removeConnection(sheetId, controller)
    })

    const connectionCount = connections.get(sheetId)?.size || 0
    console.log(`📡 Broadcasted sync event to ${connectionCount} client(s) for sheet ${sheetId}`)
}

/**
 * Get connection count for a sheet
 * @param {string} sheetId - Google Sheet ID
 * @returns {number} Number of active connections
 */
export function getConnectionCount(sheetId) {
    return connections.get(sheetId)?.size || 0
}

