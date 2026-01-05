'use client'

import { useState, useEffect, useImperativeHandle, forwardRef } from 'react'
import { useSSE } from '@/hooks/useSSE'

const DataTable = forwardRef(function DataTable({ isConnected, sheetId, onCellUpdate }, ref) {
    const [data, setData] = useState([])
    const [columns, setColumns] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [editingCell, setEditingCell] = useState(null)
    const [editValue, setEditValue] = useState('')
    const [refreshTrigger, setRefreshTrigger] = useState(0)
    const [showAddModal, setShowAddModal] = useState(false)
    const [newRowData, setNewRowData] = useState({})
    const [isAdding, setIsAdding] = useState(false)

    useEffect(() => {
        if (isConnected && sheetId) {
            fetchData()
        } else {
            setData([])
            setColumns([])
        }
    }, [isConnected, sheetId, refreshTrigger])

    // Connect to SSE for real-time sync notifications
    // WHY: Automatically refresh UI when Google Sheet syncs to database
    useSSE(sheetId, (event) => {
        console.log('📡 SSE: Sync completed, refreshing data...', event)
        // Trigger refresh when sync completes
        setRefreshTrigger(prev => prev + 1)
    })

    // Expose refresh method to parent
    useImperativeHandle(ref, () => ({
        refresh: () => {
            setRefreshTrigger(prev => prev + 1)
        }
    }))

    const fetchData = async () => {
        if (!sheetId) {
            setError('Sheet ID is required')
            return
        }

        setLoading(true)
        setError('')

        try {
            const response = await fetch(`/api/data?sheetId=${encodeURIComponent(sheetId)}`)
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.error || 'Failed to fetch data')
            }

            const result = await response.json()

            if (result.error) {
                throw new Error(result.error)
            }

            setData(result.data || [])
            setColumns(result.columns || [])
        } catch (err) {
            setError(err.message || 'Failed to load data from Google Sheets')
            setData([])
            setColumns([])
        } finally {
            setLoading(false)
        }
    }

    const handleCellClick = (rowIndex, column) => {
        const cellKey = `${rowIndex}-${column}`
        setEditingCell(cellKey)
        setEditValue(data[rowIndex]?.[column] || '')
    }

    const handleCellSave = async (rowIndex, column) => {
        const newValue = editValue
        const cellKey = `${rowIndex}-${column}`

        // Optimistically update UI
        const updatedData = [...data]
        updatedData[rowIndex] = { ...updatedData[rowIndex], [column]: newValue }
        setData(updatedData)
        setEditingCell(null)

        // Call API to update
        try {
            const response = await fetch('/api/data', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sheetId: sheetId,
                    rowId: data[rowIndex].id,
                    column: column,
                    value: newValue,
                }),
            })

            if (!response.ok) {
                throw new Error('Failed to update cell')
            }

            const result = await response.json()
            if (result.success && onCellUpdate) {
                onCellUpdate()
            }
        } catch (err) {
            // Revert on error
            setData(data)
            setError(err.message || 'Failed to update cell')
            alert(`Failed to update: ${err.message}`)
        }
    }

    const handleCellCancel = () => {
        setEditingCell(null)
        setEditValue('')
    }

    const handleKeyDown = (e, rowIndex, column) => {
        if (e.key === 'Enter') {
            handleCellSave(rowIndex, column)
        } else if (e.key === 'Escape') {
            handleCellCancel()
        }
    }

    const handleAddRow = () => {
        // Initialize newRowData with empty values for all columns
        const initialData = {}
        columns.forEach(col => {
            initialData[col] = ''
        })
        setNewRowData(initialData)
        setShowAddModal(true)
    }

    const handleAddRowSubmit = async () => {
        if (!sheetId) {
            setError('Sheet ID is required')
            return
        }

        setIsAdding(true)
        setError('')

        try {
            const response = await fetch('/api/data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sheetId: sheetId,
                    rowData: newRowData,
                }),
            })

            const result = await response.json()

            if (!response.ok) {
                throw new Error(result.message || 'Failed to add row')
            }

            // Close modal and reset form
            setShowAddModal(false)
            setNewRowData({})

            // Refresh data table
            setRefreshTrigger(prev => prev + 1)

            // Show success message
            if (result.warning) {
                alert(`Row added to database. Warning: ${result.warning}`)
            } else {
                console.log('✅ Row added successfully:', result)
            }

            // Trigger cell update callback if provided
            if (onCellUpdate) {
                onCellUpdate()
            }
        } catch (err) {
            setError(err.message || 'Failed to add row')
            alert(`Failed to add row: ${err.message}`)
        } finally {
            setIsAdding(false)
        }
    }

    const handleAddRowCancel = () => {
        setShowAddModal(false)
        setNewRowData({})
        setError('')
    }

    const handleNewRowDataChange = (column, value) => {
        setNewRowData(prev => ({
            ...prev,
            [column]: value
        }))
    }

    // Don't render if not connected
    if (!isConnected) {
        return null
    }

    if (loading) {
        return (
            <div className="w-full max-w-6xl mx-auto bg-white rounded-lg shadow-md p-8">
                <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-3 text-gray-600">Loading data...</span>
                </div>
            </div>
        )
    }

    if (error && data.length === 0) {
        return (
            <div className="w-full max-w-6xl mx-auto bg-white rounded-lg shadow-md p-8">
                <div className="text-center">
                    <p className="text-red-600 mb-4">{error}</p>
                    <button
                        onClick={fetchData}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                        Retry
                    </button>
                </div>
            </div>
        )
    }

    if (columns.length === 0) {
        return (
            <div className="w-full max-w-6xl mx-auto bg-white rounded-lg shadow-md p-8">
                <p className="text-gray-600 text-center">No columns found in the data.</p>
            </div>
        )
    }

    return (
        <div className="w-full max-w-6xl mx-auto bg-white rounded-lg shadow-md p-6 overflow-x-auto">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-gray-800">Synced Data</h2>
                <div className="flex gap-2">
                    <button
                        onClick={handleAddRow}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    >
                        + Add Row
                    </button>
                    <button
                        onClick={fetchData}
                        className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-sm text-red-600">{error}</p>
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            {columns.map((column) => (
                                <th
                                    key={column}
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                    {column}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.map((row, rowIndex) => (
                            <tr key={row.id || rowIndex} className="hover:bg-gray-50">
                                {columns.map((column) => {
                                    const cellKey = `${rowIndex}-${column}`
                                    const isEditing = editingCell === cellKey

                                    return (
                                        <td
                                            key={column}
                                            className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                                            onClick={() => !isEditing && handleCellClick(rowIndex, column)}
                                        >
                                            {isEditing ? (
                                                <input
                                                    type="text"
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    onBlur={() => handleCellSave(rowIndex, column)}
                                                    onKeyDown={(e) => handleKeyDown(e, rowIndex, column)}
                                                    className="w-full px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    autoFocus
                                                />
                                            ) : (
                                                <span className="cursor-pointer hover:bg-blue-50 px-2 py-1 rounded">
                                                    {row[column] ?? ''}
                                                </span>
                                            )}
                                        </td>
                                    )
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {data.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                    No data available. Data will appear here once synced from Google Sheets.
                </div>
            )}

            {/* Add Row Modal */}
            {showAddModal && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
                    onClick={handleAddRowCancel}
                >
                    <div
                        className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-xl font-bold text-gray-800 mb-4">Add New Row</h3>

                        {error && (
                            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                                <p className="text-sm text-red-600">{error}</p>
                            </div>
                        )}

                        <div className="space-y-4">
                            {columns.map((column) => (
                                <div key={column}>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {column}
                                    </label>
                                    <input
                                        type="text"
                                        value={newRowData[column] || ''}
                                        onChange={(e) => handleNewRowDataChange(column, e.target.value)}
                                        className="w-full text-black px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder={`Enter ${column}`}
                                    />
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <button
                                onClick={handleAddRowCancel}
                                disabled={isAdding}
                                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddRowSubmit}
                                disabled={isAdding}
                                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                {isAdding ? 'Adding...' : 'Add Row'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
})

export default DataTable

