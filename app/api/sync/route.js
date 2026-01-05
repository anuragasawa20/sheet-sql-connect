import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { fetchSheetData } from '@/lib/google-sheets'
import { broadcastSync } from '@/lib/sse-broadcaster'
import {
    ensureTableSchema,
    testConnection,
    getSheetStatus,
    getSnapshot,
    storeSnapshot,
    applyDiff,
    query
} from '@/lib/database'
import { computeDiff, computeRowHash } from '@/lib/diff-engine'

/**
 * POST /api/sync
 * Manual sync operation between Google Sheet and PostgreSQL (one-way)
 * 
 * Body: { 
 *   direction: 'sheet-to-db' | 'db-to-sheet', 
 *   sheetId: string 
 * }
 * 
 * Response: { 
 *   success: boolean, 
 *   rowsSynced: number, 
 *   changes: Change[],
 *   message: string 
 * }
 * 
 * SYNC FLOW (PRODUCTION-GRADE SNAPSHOT-BASED):
 * 
 * 1. SHEET → DB (sheet-to-db):
 *    - Check sheet registry: if not ACTIVE, ignore (defensive check)
 *    - Fetch data from Google Sheets API (current sheet state)
 *    - Get current snapshot from database (source of truth)
 *    - Compute diff (INSERT/UPDATE/DELETE) using diff engine
 *    - Apply diff idempotently to database
 *    - Database snapshot now reflects current sheet state
 * 
 * 2. DB → SHEET (db-to-sheet):
 *    - NOT IMPLEMENTED (out of scope)
 */

/**
 * Get user email from cookies
 */
function getUserEmail() {
    const cookieStore = cookies()
    const emailCookie = cookieStore.get('google_user_email')
    return emailCookie ? emailCookie.value : null
}
import { withSyncLock } from '@/lib/sync-lock'

export async function POST(request) {
    try {
        const body = await request.json()
        const { direction, sheetId } = body

        // Validate direction
        if (!direction || !['sheet-to-db', 'db-to-sheet'].includes(direction)) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Direction must be "sheet-to-db" or "db-to-sheet"'
                },
                { status: 400 }
            )
        }

        // Validate sheetId
        if (!sheetId) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Sheet ID is required for sync operation'
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

        // ============================================
        // GOOGLE SHEET → DATABASE SYNC (SNAPSHOT-BASED)
        // ============================================
        if (direction === 'sheet-to-db') {
            console.log(`🔄 Starting snapshot-based sync: Google Sheet → Database (Sheet ID: ${sheetId})`)

            try {
                // Step 0: Get user email and check sheet registry
                const userEmail = getUserEmail()

                // WHY: Check registry first - if sheet is not ACTIVE, ignore (defensive check)
                // This prevents processing sheets that shouldn't be synced
                const status = userEmail ? await getSheetStatus(userEmail, sheetId) : null
                if (userEmail && status && status !== 'ACTIVE') {
                    console.log(`⚠️ Sheet ${sheetId} is not ACTIVE (status: ${status}), skipping sync`)
                    return NextResponse.json(
                        {
                            success: false,
                            message: `Sheet is not active (status: ${status}). Please reconnect the sheet.`
                        },
                        { status: 400 }
                    )
                }

                // Step 1: Fetch current state from Google Sheets
                const apiKey = process.env.GOOGLE_API_KEY || null
                const result = await fetchSheetData(sheetId, 'Sheet1', apiKey)

                const sheetData = result.data || []
                const columns = result.columns || []

                if (columns.length === 0) {
                    return NextResponse.json(
                        {
                            success: false,
                            message: 'No columns found in the Google Sheet'
                        },
                        { status: 400 }
                    )
                }

                console.log(`📊 Fetched ${sheetData.length} rows with ${columns.length} columns from Google Sheet`)

                // Step 2: Ensure table schema exists and is up-to-date
                const tableName = await ensureTableSchema(sheetId, columns)
                console.log(`✅ Table schema ensured: ${tableName}`)

                // Step 3: Get current snapshot from database (source of truth)
                const dbSnapshot = await getSnapshot(tableName, columns)
                console.log(`📸 Current database snapshot: ${dbSnapshot.length} rows`)

                // Step 4: Compute diff and apply (with sync lock to prevent concurrent syncs)
                // WHY: Use sync lock to prevent multiple syncs from running concurrently
                const syncResult = await withSyncLock(sheetId, async () => {
                    const diff = computeDiff(sheetData, dbSnapshot, columns)
                    console.log(`🔍 Diff computed: ${diff.inserts.length} inserts, ${diff.updates?.length || 0} updates, ${diff.deletes.length} deletes`)

                    // Step 5: Apply diff idempotently
                    // WHY: If no existing rows, store initial snapshot. Otherwise, apply diff.
                    let result
                    if (dbSnapshot.length === 0) {
                        // First sync: store initial snapshot
                        console.log(`📦 Storing initial snapshot (${sheetData.length} rows)`)
                        result = await storeSnapshot(tableName, columns, sheetData, computeRowHash)
                        result.updated = 0
                        result.deleted = 0
                    } else {
                        // Subsequent sync: apply diff
                        console.log(`🔄 Applying diff (${diff.inserts.length} inserts, ${diff.updates?.length || 0} updates, ${diff.deletes.length} deletes)`)
                        // Get current max revision
                        const maxRevisionResult = await query(
                            `SELECT COALESCE(MAX(revision), 0) as max_revision FROM "${tableName}"`,
                            []
                        )
                        const currentRevision = (maxRevisionResult[0]?.max_revision || 0) + 1
                        result = await applyDiff(tableName, columns, diff, currentRevision)
                    }
                    return result
                })

                const rowsSynced = syncResult.inserted + (syncResult.updated || 0) + (syncResult.deleted || 0)
                const skippedRows = syncResult.skipped || 0

                // Broadcast SSE event to all connected clients
                // WHY: Notify frontend clients that sync completed so they can refresh UI
                broadcastSync(sheetId, {
                    type: 'sync-completed',
                    sheetId: sheetId,
                    timestamp: new Date().toISOString(),
                    changes: {
                        inserted: syncResult.inserted,
                        updated: syncResult.updated || 0,
                        deleted: syncResult.deleted || 0,
                        rowsSynced: rowsSynced
                    }
                })

                let message = `Successfully synced ${rowsSynced} rows (${syncResult.inserted} inserted, ${syncResult.updated || 0} updated, ${syncResult.deleted || 0} deleted)`
                if (skippedRows > 0) {
                    message += ` (${skippedRows} rows skipped due to errors)`
                }

                return NextResponse.json({
                    success: true,
                    rowsSynced: rowsSynced,
                    direction: 'sheet-to-db',
                    changes: {
                        inserted: syncResult.inserted,
                        updated: syncResult.updated || 0,
                        deleted: syncResult.deleted || 0,
                        skipped: skippedRows
                    },
                    message: message
                })
            } catch (error) {
                console.error('❌ Sync error:', error)
                return NextResponse.json(
                    {
                        success: false,
                        rowsSynced: 0,
                        message: error.message || 'Failed to sync data from Google Sheet to Database'
                    },
                    { status: 500 }
                )
            }
        }

        // ============================================
        // MYSQL → GOOGLE SHEET SYNC
        // ============================================
        if (direction === 'db-to-sheet') {
            console.log(`🔄 Starting sync: MySQL → Google Sheet (Sheet ID: ${sheetId})`)

            // TODO: Implement MySQL → Google Sheet sync
            // This would require:
            // 1. Fetch data from MySQL
            // 2. Fetch current data from Google Sheets
            // 3. Compare and detect changes
            // 4. Apply changes to Google Sheets using batch update API

            return NextResponse.json(
                {
                    success: false,
                    rowsSynced: 0,
                    message: 'DB → Sheet sync is not yet implemented'
                },
                { status: 501 }
            )
        }

    } catch (error) {
        console.error('❌ Sync error:', error)
        return NextResponse.json(
            {
                success: false,
                rowsSynced: 0,
                message: error.message || 'Failed to sync data'
            },
            { status: 500 }
        )
    }
}
