'use client'

export default function ConnectionStatus({ status, sheetId, onDisconnect }) {
    if (status === 'disconnected') {
        return null
    }

    const statusConfig = {
        connecting: {
            label: 'Connecting...',
            color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
            dot: 'bg-yellow-400'
        },
        connected: {
            label: 'Connected',
            color: 'bg-green-100 text-green-800 border-green-300',
            dot: 'bg-green-400'
        },
        error: {
            label: 'Connection Error',
            color: 'bg-red-100 text-red-800 border-red-300',
            dot: 'bg-red-400'
        }
    }

    const config = statusConfig[status] || statusConfig.connecting

    return (
        <div className={`w-full max-w-2xl mx-auto border rounded-lg p-4 ${config.color}`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${config.dot} animate-pulse`}></div>
                    <div>
                        <p className="font-semibold">{config.label}</p>
                        {sheetId && status === 'connected' && (
                            <p className="text-sm opacity-75 mt-1">
                                Sheet ID: <span className="font-mono">{sheetId}</span>
                            </p>
                        )}
                    </div>
                </div>

                {status === 'connected' && onDisconnect && (
                    <button
                        onClick={onDisconnect}
                        className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                    >
                        Disconnect
                    </button>
                )}
            </div>
        </div>
    )
}

