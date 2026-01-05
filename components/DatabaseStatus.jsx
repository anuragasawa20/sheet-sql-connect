'use client'

import { useState, useEffect } from 'react'

export default function DatabaseStatus() {
    const [status, setStatus] = useState('checking') // 'checking' | 'connected' | 'disconnected'
    const [poolInfo, setPoolInfo] = useState(null)
    const [lastChecked, setLastChecked] = useState(null)

    const checkStatus = async () => {
        try {
            const response = await fetch('/api/db/status')
            const data = await response.json()

            if (data.connected) {
                setStatus('connected')
                setPoolInfo(data.pool)
            } else {
                setStatus('disconnected')
                setPoolInfo(null)
            }
            setLastChecked(new Date())
        } catch (error) {
            console.error('Failed to check database status:', error)
            setStatus('disconnected')
            setPoolInfo(null)
            setLastChecked(new Date())
        }
    }

    useEffect(() => {
        // Check immediately
        checkStatus()

        // Check every 10 seconds
        const interval = setInterval(checkStatus, 10000)

        return () => clearInterval(interval)
    }, [])

    const statusConfig = {
        checking: {
            label: 'Checking Database...',
            color: 'bg-gray-100 text-gray-800 border-gray-300',
            dot: 'bg-gray-400'
        },
        connected: {
            label: 'Database Connected',
            color: 'bg-green-100 text-green-800 border-green-300',
            dot: 'bg-green-500'
        },
        disconnected: {
            label: 'Database Disconnected',
            color: 'bg-red-100 text-red-800 border-red-300',
            dot: 'bg-red-500'
        }
    }

    const config = statusConfig[status]

    return (
        <div className={`w-full max-w-2xl mx-auto border rounded-lg p-4 ${config.color}`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${config.dot} ${status === 'connected' ? 'animate-pulse' : ''}`}></div>
                    <div>
                        <p className="font-semibold">{config.label}</p>
                        {poolInfo && status === 'connected' && (
                            <div className="text-sm opacity-75 mt-1 space-y-1">
                                <p>
                                    Pool: <span className="font-mono">{poolInfo.active || 0} active</span>
                                    {poolInfo.idle !== undefined && (
                                        <span className="ml-2">/ {poolInfo.idle} idle</span>
                                    )}
                                </p>
                            </div>
                        )}
                        {lastChecked && (
                            <p className="text-xs opacity-60 mt-1">
                                Last checked: {new Date(lastChecked).toLocaleTimeString()}
                            </p>
                        )}
                    </div>
                </div>

                <button
                    onClick={checkStatus}
                    disabled={status === 'checking'}
                    className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {status === 'checking' ? 'Checking...' : 'Refresh'}
                </button>
            </div>
        </div>
    )
}


