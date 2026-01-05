import { useEffect, useRef } from 'react'

/**
 * Custom hook for automatic sync polling
 * Automatically syncs Google Sheet → MySQL at regular intervals
 * 
 * @param {boolean} isConnected - Whether sheet is connected
 * @param {string} sheetId - Google Sheet ID
 * @param {number} intervalMs - Polling interval in milliseconds (default: 30000 = 30 seconds)
 * @param {function} onSyncComplete - Callback when sync completes
 */
export function useAutoSync(isConnected, sheetId, intervalMs = 30000, onSyncComplete) {
  const intervalRef = useRef(null)
  const lastSyncRef = useRef(null)

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // Only start polling if connected and sheetId exists
    if (!isConnected || !sheetId) {
      return
    }

    // Initial sync immediately when connected
    const performSync = async () => {
      try {
        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            direction: 'sheet-to-db',
            sheetId: sheetId,
          }),
        })

        const result = await response.json()

        if (result.success) {
          lastSyncRef.current = new Date()

          if (onSyncComplete) {
            onSyncComplete(result)
          }

          console.log(`Auto-sync completed: ${result.rowsSynced} rows synced`)
        } else {
          console.warn('Auto-sync failed:', result.message)
        }
      } catch (error) {
        console.error('Auto-sync error:', error)
      }
    }

    // Perform initial sync
    performSync()

    // Set up interval for automatic polling
    intervalRef.current = setInterval(performSync, intervalMs)

    // Cleanup on unmount or when dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isConnected, sheetId, intervalMs, onSyncComplete])

  return {
    lastSync: lastSyncRef.current,
    stop: () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }
}



