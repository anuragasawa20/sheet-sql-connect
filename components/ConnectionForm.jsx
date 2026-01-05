'use client'

import { useState } from 'react'
import { validateSheetInput, extractSheetId } from '@/lib/utils'

export default function ConnectionForm({ onConnect, isConnecting }) {
    const [sheetUrl, setSheetUrl] = useState('')
    const [error, setError] = useState('')

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')

        if (!validateSheetInput(sheetUrl)) {
            setError('Please enter a valid Google Sheet URL or Sheet ID')
            return
        }

        const sheetId = extractSheetId(sheetUrl)

        try {
            await onConnect(sheetId || sheetUrl)
            setSheetUrl('') // Clear form on success
        } catch (err) {
            setError(err.message || 'Failed to connect to Google Sheet')
        }
    }

    return (
        <div className="w-full max-w-2xl mx-auto bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
                Connect Google Sheet
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label
                        htmlFor="sheetUrl"
                        className="block text-sm font-medium text-gray-700 mb-2"
                    >
                        Google Sheet URL or Sheet ID
                    </label>
                    <input
                        type="text"
                        id="sheetUrl"
                        value={sheetUrl}
                        onChange={(e) => {
                            setSheetUrl(e.target.value)
                            setError('')
                        }}
                        placeholder="https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit"
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-black"
                        disabled={isConnecting}
                    />
                    {error && (
                        <p className="mt-2 text-sm text-red-600">{error}</p>
                    )}
                </div>

                <button
                    type="submit"
                    disabled={isConnecting}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                    {isConnecting ? 'Connecting...' : 'Connect Sheet'}
                </button>
            </form>
        </div>
    )
}

