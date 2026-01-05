'use client'

import { useState, useEffect } from 'react'

export default function GoogleAuth() {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [userEmail, setUserEmail] = useState(null)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        checkAuthStatus()
    }, [])

    const checkAuthStatus = async () => {
        try {
            // Check if user is authenticated by checking for user email cookie
            // In a real app, you'd call an API endpoint to verify
            const response = await fetch('/api/auth/status')
            if (response.ok) {
                const data = await response.json()
                setIsAuthenticated(data.authenticated)
                setUserEmail(data.userEmail)
            }
        } catch (error) {
            console.error('Error checking auth status:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleConnect = () => {
        // Redirect to Google OAuth
        window.location.href = '/api/auth/google'
    }

    const handleDisconnect = async () => {
        try {
            const response = await fetch('/api/auth/google/logout', {
                method: 'POST'
            })
            if (response.ok) {
                setIsAuthenticated(false)
                setUserEmail(null)
                // Optionally reload the page
                window.location.reload()
            }
        } catch (error) {
            console.error('Error disconnecting:', error)
        }
    }

    if (isLoading) {
        return (
            <div className="bg-white rounded-lg shadow-md p-4">
                <div className="animate-pulse flex items-center space-x-4">
                    <div className="h-4 bg-gray-200 rounded w-32"></div>
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white rounded-lg shadow-md p-4">
            {isAuthenticated ? (
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-600">Connected as</p>
                        <p className="text-sm font-medium text-gray-900">{userEmail}</p>
                    </div>
                    <button
                        onClick={handleDisconnect}
                        className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                    >
                        Disconnect
                    </button>
                </div>
            ) : (
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-600">Connect with Google to enable write operations</p>
                        <p className="text-xs text-gray-500 mt-1">Required for adding/editing rows in Google Sheets</p>
                    </div>
                    <button
                        onClick={handleConnect}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-2"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                        </svg>
                        Connect with Google
                    </button>
                </div>
            )}
        </div>
    )
}

