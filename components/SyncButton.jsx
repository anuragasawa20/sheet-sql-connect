'use client'

import { useState } from 'react'

export default function SyncButton({ sheetId, onSyncComplete }) {
    const [isSyncing, setIsSyncing] = useState(false)
    const [syncStatus, setSyncStatus] = useState(null) // 'success' | 'error' | null

    const handleSync = async (direction = 'sheet-to-db') => {
        if (!sheetId) {
            alert('Please connect a Google Sheet first')
            return
        }

        setIsSyncing(true)
        setSyncStatus(null)

        try {
            const response = await fetch('/api/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    direction,
                    sheetId,
                }),
            })

            const result = await response.json()

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Sync failed')
            }

            setSyncStatus('success')

            // Show success message
            setTimeout(() => {
                setSyncStatus(null)
            }, 3000)

            // Notify parent component to refresh data
            if (onSyncComplete) {
                onSyncComplete(result)
            }
        } catch (err) {
            setSyncStatus('error')
            console.error('Sync error:', err)
            alert(`Sync failed: ${err.message}`)
            setTimeout(() => {
                setSyncStatus(null)
            }, 3000)
        } finally {
            setIsSyncing(false)
        }
    }

    if (!sheetId) {
        return null
    }

    return (
        <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
                onClick={() => handleSync('sheet-to-db')}
                disabled={isSyncing}
                className={`px-6 py-3 rounded-md text-base font-medium transition-colors min-w-[180px] ${isSyncing
                    ? 'bg-gray-400 cursor-not-allowed'
                    : syncStatus === 'success' && syncStatus !== 'error'
                        ? 'bg-green-600 hover:bg-green-700'
                        : syncStatus === 'error'
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-blue-600 hover:bg-blue-700'
                    } text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
            >
                {isSyncing ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                        Syncing...
                    </span>
                ) : syncStatus === 'success' ? (
                    '✓ Synced Sheet → DB'
                ) : syncStatus === 'error' ? (
                    '✗ Sync Failed'
                ) : (
                    'Sync Sheet → MySQL'
                )}
            </button>

            {/* <button
                onClick={() => handleSync('db-to-sheet')}
                disabled={isSyncing}
                className={`px-6 py-3 rounded-md text-base font-medium transition-colors min-w-[180px] ${isSyncing
                        ? 'bg-gray-400 cursor-not-allowed'
                        : syncStatus === 'success' && syncStatus !== 'error'
                            ? 'bg-green-600 hover:bg-green-700'
                            : syncStatus === 'error'
                                ? 'bg-red-600 hover:bg-red-700'
                                : 'bg-purple-600 hover:bg-purple-700'
                    } text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2`}
            >
                {isSyncing ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                        Syncing...
                    </span>
                ) : syncStatus === 'success' ? (
                    '✓ Synced MySQL → Sheet'
                ) : syncStatus === 'error' ? (
                    '✗ Sync Failed'
                ) : (
                    'Sync MySQL → Sheet'
                )}
            </button> */}
        </div>
    )
}

