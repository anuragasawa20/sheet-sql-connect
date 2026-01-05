'use client'

import { useState, useEffect } from 'react'

export default function AutoSyncIndicator({ isEnabled, lastSync, intervalSeconds = 30 }) {
  const [timeSinceSync, setTimeSinceSync] = useState('')

  useEffect(() => {
    if (!isEnabled || !lastSync) {
      setTimeSinceSync('')
      return
    }

    const updateTime = () => {
      const now = new Date()
      const diff = Math.floor((now - lastSync) / 1000) // seconds

      if (diff < 60) {
        setTimeSinceSync(`${diff}s ago`)
      } else if (diff < 3600) {
        setTimeSinceSync(`${Math.floor(diff / 60)}m ago`)
      } else {
        setTimeSinceSync(`${Math.floor(diff / 3600)}h ago`)
      }
    }

    updateTime()
    const interval = setInterval(updateTime, 1000)

    return () => clearInterval(interval)
  }, [isEnabled, lastSync])

  if (!isEnabled) {
    return null
  }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
        <span>Auto-sync enabled</span>
      </div>
      {lastSync && (
        <span className="text-gray-500">
          (Last sync: {timeSinceSync || 'just now'})
        </span>
      )}
      <span className="text-gray-400">
        • Every {intervalSeconds}s
      </span>
    </div>
  )
}



