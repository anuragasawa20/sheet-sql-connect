'use client'

import { useState, useRef } from 'react'
import ConnectionForm from '@/components/ConnectionForm'
import ConnectionStatus from '@/components/ConnectionStatus'
import DatabaseStatus from '@/components/DatabaseStatus'
import DataTable from '@/components/DataTable'
import SyncButton from '@/components/SyncButton'
import GoogleAuth from '@/components/GoogleAuth'

export default function Home() {
    const [connectionStatus, setConnectionStatus] = useState('disconnected')
    const [sheetId, setSheetId] = useState(null)
    const [isConnecting, setIsConnecting] = useState(false)
    const [error, setError] = useState('')
    const dataTableRef = useRef(null)

    const handleConnect = async (sheetIdOrUrl) => {
        setIsConnecting(true)
        setConnectionStatus('connecting')
        setError('')

        try {
            const response = await fetch('/api/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sheetUrl: sheetIdOrUrl }),
            })

            const result = await response.json()

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Failed to connect to Google Sheet')
            }

            setSheetId(result.sheetId)
            setConnectionStatus('connected')

            // Automatically refresh data table after successful connection
            // Wait a bit to ensure database write is complete
            setTimeout(() => {
                if (dataTableRef.current?.refresh) {
                    dataTableRef.current.refresh()
                }
            }, 500)
        } catch (err) {
            setConnectionStatus('error')
            setError(err.message || 'Connection failed')
        } finally {
            setIsConnecting(false)
        }
    }

    const handleDisconnect = () => {
        setConnectionStatus('disconnected')
        setSheetId(null)
        setError('')
    }

    const handleCellUpdate = () => {
        // Optionally refresh data after cell update
        // The DataTable component handles its own refresh
    }

    const handleSyncComplete = (result) => {
        // Refresh data table after successful sync
        console.log('Sync completed:', result)

        // Refresh the data table to show updated data
        if (dataTableRef.current?.refresh) {
            dataTableRef.current.refresh()
        }
    }

    const isConnected = connectionStatus === 'connected'

    return (
        <main className="min-h-screen bg-gray-50 py-8 px-4">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">
                        Google Sheet ↔ PostgreSQL Sync
                    </h1>
                    <p className="text-gray-600">
                        Connect your Google Sheet and sync data bidirectionally with PostgreSQL
                    </p>
                </div>

                <DatabaseStatus />

                <GoogleAuth />

                <ConnectionForm
                    onConnect={handleConnect}
                    isConnecting={isConnecting}
                />

                <ConnectionStatus
                    status={connectionStatus}
                    sheetId={sheetId}
                    onDisconnect={handleDisconnect}
                />

                {isConnected && (
                    <div className="w-full max-w-2xl mx-auto">
                        <div className="bg-white rounded-lg shadow-md p-6">
                            <h3 className="text-lg font-semibold text-gray-800 mb-4 text-center">
                                Manual Sync
                            </h3>
                            <div className="flex justify-center">
                                <SyncButton
                                    sheetId={sheetId}
                                    onSyncComplete={handleSyncComplete}
                                />
                            </div>
                            <p className="text-sm text-gray-500 text-center mt-4">
                                Click buttons to sync data in one direction at a time
                            </p>
                        </div>
                    </div>
                )}

                {error && connectionStatus === 'error' && (
                    <div className="w-full max-w-2xl mx-auto bg-red-50 border border-red-200 rounded-lg p-4">
                        <p className="text-red-800">{error}</p>
                    </div>
                )}

                <DataTable
                    ref={dataTableRef}
                    isConnected={isConnected}
                    sheetId={sheetId}
                    onCellUpdate={handleCellUpdate}
                />
            </div>
        </main>
    )
}

