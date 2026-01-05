import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
    sanitizeTableName,
    fetchTableData,
    getSheetColumns,
    updateCell,
    insertRow,
    testConnection,
    getRowPosition
} from '@/lib/database'
import { appendRowToSheet, updateCellInSheet } from '@/lib/google-sheets'
import { hasGoogleAuth, supportsWriteOperations } from '@/lib/google-auth'

/**
 * Get user email from cookies
 */
function getUserEmail() {
    const cookieStore = cookies()
    const emailCookie = cookieStore.get('google_user_email')
    return emailCookie ? emailCookie.value : null
}

/**
 * GET /api/data
 * Fetch data from MySQL database
 * Query params: { sheetId: string }
 * Response: { data: Row[], columns: string[] }
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url)
        const sheetId = searchParams.get('sheetId')

        if (!sheetId) {
            return NextResponse.json(
                {
                    data: [],
                    columns: [],
                    error: 'Sheet ID is required'
                },
                { status: 400 }
            )
        }

        // Test database connection
        const isConnected = await testConnection()
        if (!isConnected) {
            return NextResponse.json(
                {
                    data: [],
                    columns: [],
                    error: 'Database connection failed. Please check your database configuration.'
                },
                { status: 500 }
            )
        }

        // Get columns for this sheet
        const columns = await getSheetColumns(sheetId)

        if (!columns || columns.length === 0) {
            // No data synced yet - return empty
            return NextResponse.json({
                data: [],
                columns: [],
                message: 'No data found. Please sync from Google Sheet first.'
            })
        }

        // Fetch data from MySQL
        const tableName = sanitizeTableName(sheetId)
        const data = await fetchTableData(tableName, columns)

        return NextResponse.json({
            data: data || [],
            columns: columns || [],
        })
    } catch (error) {
        console.error('Data fetch error:', error)
        return NextResponse.json(
            {
                data: [],
                columns: [],
                error: error.message || 'Failed to fetch data from MySQL database'
            },
            { status: 500 }
        )
    }
}

/**
 * PUT /api/data
 * Update a specific cell value in both database and Google Sheets
 * Body: { sheetId: string, rowId: number, column: string, value: any }
 * Response: { success: boolean, message: string, sheetRange?: string, warning?: string }
 */
export async function PUT(request) {
    try {
        const body = await request.json()
        const { sheetId, rowId, column, value } = body

        if (!sheetId || rowId === undefined || !column) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'sheetId, rowId, and column are required'
                },
                { status: 400 }
            )
        }

        // Test database connection
        const isConnected = await testConnection()
        if (!isConnected) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Database connection failed. Please check your database configuration.'
                },
                { status: 500 }
            )
        }

        // Get columns for this sheet (needed for Google Sheets update)
        const columns = await getSheetColumns(sheetId)
        if (!columns || columns.length === 0) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'No columns found. Please sync from Google Sheet first.'
                },
                { status: 400 }
            )
        }

        // Step 1: Update the cell in database
        const tableName = sanitizeTableName(sheetId)
        await updateCell(tableName, rowId, column, value)
        console.log(`✅ Updated row ${rowId}, column ${column} in database table ${tableName}`)

        // Step 2: Get row position to map to Google Sheets row number
        // Since database IDs are auto-incrementing and may have gaps,
        // we need to find the row's position in the ordered list
        const rowPosition = await getRowPosition(tableName, rowId)
        if (rowPosition === null) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Row not found in database'
                },
                { status: 404 }
            )
        }

        // Step 3: Update cell in Google Sheets
        // Get user email from cookies (for user-specific OAuth2)
        const userEmail = getUserEmail()

        // Check if authentication is configured and supports write operations
        const hasAuth = await hasGoogleAuth(userEmail)
        if (!hasAuth) {
            // If no authentication, still update DB but warn user
            console.warn('⚠️ No Google authentication found. Cell updated in database but not synced to Google Sheets.')
            return NextResponse.json({
                success: true,
                message: 'Cell updated in database. Google Sheets sync skipped (authentication not configured).',
                warning: userEmail
                    ? 'Please connect with Google to enable write operations.'
                    : 'Google Sheets write operations require authentication. Please connect with Google.'
            })
        }

        const supportsWrite = await supportsWriteOperations(userEmail)
        if (!supportsWrite) {
            // API key is configured but doesn't support writes
            console.warn('⚠️ API key configured but write operations require Service Account or OAuth2.')
            return NextResponse.json({
                success: true,
                message: 'Cell updated in database. Google Sheets sync skipped (API key only supports read operations).',
                warning: 'Write operations require OAuth2 authentication. Please connect with Google.'
            })
        }

        try {
            const sheetResult = await updateCellInSheet(sheetId, rowPosition, column, value, columns, 'Sheet1', userEmail)
            console.log(`✅ Updated cell in Google Sheets: ${sheetResult.updatedRange}`)

            return NextResponse.json({
                success: true,
                message: 'Cell updated successfully in both database and Google Sheets',
                sheetRange: sheetResult.updatedRange
            })
        } catch (sheetError) {
            // If Google Sheets update fails, the cell is already updated in DB
            // Log error but don't fail the request
            console.error('❌ Failed to update cell in Google Sheets:', sheetError.message)
            return NextResponse.json({
                success: true,
                message: 'Cell updated in database, but Google Sheets sync failed',
                warning: sheetError.message,
                sheetSyncFailed: true
            }, { status: 207 }) // 207 Multi-Status - partial success
        }
    } catch (error) {
        console.error('Data update error:', error)
        return NextResponse.json(
            {
                success: false,
                message: error.message || 'Failed to update cell'
            },
            { status: 500 }
        )
    }
}

/**
 * POST /api/data
 * Add a new row to both database and Google Sheets
 * Body: { sheetId: string, rowData: object }
 * Response: { success: boolean, rowId: number, message: string }
 */
export async function POST(request) {
    try {
        const body = await request.json()
        const { sheetId, rowData } = body

        if (!sheetId || !rowData) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'sheetId and rowData are required'
                },
                { status: 400 }
            )
        }

        // Test database connection
        const isConnected = await testConnection()
        if (!isConnected) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Database connection failed. Please check your database configuration.'
                },
                { status: 500 }
            )
        }

        // Get columns for this sheet
        const columns = await getSheetColumns(sheetId)
        if (!columns || columns.length === 0) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'No columns found. Please sync from Google Sheet first.'
                },
                { status: 400 }
            )
        }

        // Validate that rowData contains all required columns
        const missingColumns = columns.filter(col => !(col in rowData))
        if (missingColumns.length > 0) {
            // Allow missing columns (they'll be set to null/empty)
            console.log(`⚠️ Missing columns in rowData: ${missingColumns.join(', ')}. They will be set to empty.`)
        }

        // Step 1: Insert row into database
        const tableName = sanitizeTableName(sheetId)
        const dbResult = await insertRow(tableName, columns, rowData)
        console.log(`✅ Inserted row ${dbResult.id} into database table ${tableName}`)

        // Step 2: Append row to Google Sheets
        // Build values array in the same order as columns
        const values = columns.map(col => rowData[col] || '')

        // Get user email from cookies (for user-specific OAuth2)
        const userEmail = getUserEmail()

        // Check if authentication is configured and supports write operations
        const hasAuth = await hasGoogleAuth(userEmail)
        if (!hasAuth) {
            // If no authentication, still insert into DB but warn user
            console.warn('⚠️ No Google authentication found. Row inserted into database but not synced to Google Sheets.')
            return NextResponse.json({
                success: true,
                rowId: dbResult.id,
                message: 'Row added to database. Google Sheets sync skipped (authentication not configured).',
                warning: userEmail
                    ? 'Please connect with Google to enable write operations.'
                    : 'Google Sheets write operations require authentication. Please connect with Google.'
            })
        }

        const supportsWrite = await supportsWriteOperations(userEmail)
        if (!supportsWrite) {
            // API key is configured but doesn't support writes
            console.warn('⚠️ API key configured but write operations require Service Account or OAuth2.')
            return NextResponse.json({
                success: true,
                rowId: dbResult.id,
                message: 'Row added to database. Google Sheets sync skipped (API key only supports read operations).',
                warning: 'Write operations require OAuth2 authentication. Please connect with Google.'
            })
        }

        try {
            const sheetResult = await appendRowToSheet(sheetId, values, 'Sheet1', userEmail)
            console.log(`✅ Appended row to Google Sheets: ${sheetResult.updatedRange}`)

            return NextResponse.json({
                success: true,
                rowId: dbResult.id,
                message: 'Row added successfully to both database and Google Sheets',
                sheetRange: sheetResult.updatedRange
            })
        } catch (sheetError) {
            // If Google Sheets append fails, the row is already in DB
            // Log error but don't fail the request
            console.error('❌ Failed to append row to Google Sheets:', sheetError.message)
            return NextResponse.json({
                success: true,
                rowId: dbResult.id,
                message: 'Row added to database, but Google Sheets sync failed',
                warning: sheetError.message,
                sheetSyncFailed: true
            }, { status: 207 }) // 207 Multi-Status - partial success
        }
    } catch (error) {
        console.error('Data insert error:', error)
        return NextResponse.json(
            {
                success: false,
                message: error.message || 'Failed to add row'
            },
            { status: 500 }
        )
    }
}

