import { NextResponse } from 'next/server'
import { fetchSheetData } from '@/lib/google-sheets'
import { withSyncLock } from '@/lib/sync-lock'
import { broadcastSync } from '@/lib/sse-broadcaster'
import {
    ensureTableSchema,
    getSnapshot,
    storeSnapshot,
    applyDiff,
    query
} from '@/lib/database'
import { computeDiff, computeRowHash } from '@/lib/diff-engine'

/**
 * POST /api/sync/drive-webhook
 * Webhook endpoint for Google Drive push notifications
 * 
 * This endpoint receives notifications from Google Drive API when
 * a file (including Google Sheets) changes.
 * 
 * FLOW:
 * 1. Google Drive sends webhook with file change notification
 * 2. Extract file_id (Google Sheet ID) from notification
 * 3. Check registry: if file_id exists and is ACTIVE
 * 4. If yes: fetch sheet data, compute diff, apply changes
 * 5. If no: ignore (sheet not connected)
 * 
 */
export async function POST(request) {
    try {
        // WHY: Handle empty or invalid JSON gracefully
        // Google Drive sometimes sends empty requests or GET requests for verification

        // Log request headers for debugging
        const headers = Object.fromEntries(request.headers.entries())
        console.log('📥 Drive webhook request headers:', {
            'content-type': headers['content-type'],
            'user-agent': headers['user-agent'],
            'x-goog-channel-id': headers['x-goog-channel-id'],
            'x-goog-channel-token': headers['x-goog-channel-token'],
            'x-goog-resource-id': headers['x-goog-resource-id'],
            'x-goog-resource-state': headers['x-goog-resource-state'],
            'x-goog-resource-uri': headers['x-goog-resource-uri'],
            'x-goog-changed': headers['x-goog-changed']
        })

        let body = {}
        let rawText = ''
        try {
            rawText = await request.text()
            console.log('📄 Raw request body:', rawText.substring(0, 500)) // Log first 500 chars

            if (rawText && rawText.trim()) {
                body = JSON.parse(rawText)
            }
        } catch (jsonError) {
            // Empty or invalid JSON - this can happen with GET requests or verification
            console.log('⚠️ Drive webhook received empty or invalid JSON:', jsonError.message)
            console.log('📄 Raw text received:', rawText)

            // Google Drive sends webhook data in HEADERS, not body!
            // Check headers for webhook information
            if (headers['x-goog-resource-uri']) {
                console.log('✅ Found webhook data in headers (X-Goog-Resource-Uri)')
                // Extract file ID from header
                const resourceUri = headers['x-goog-resource-uri']
                const match = resourceUri.match(/\/files\/([^/?]+)/)
                if (match) {
                    const fileId = match[1]
                    console.log(`📄 Extracted file ID from header: ${fileId}`)
                    // Continue with normal processing using fileId
                    // (will be handled below)
                }
            }

            // Return 200 anyway (idempotent - Google expects quick response)
            return NextResponse.json({
                success: true,
                message: 'Webhook received (empty or invalid JSON - likely verification)'
            })
        }

        // Google Drive webhook sends different formats:
        // 1. Initial subscription confirmation: { kind: "api#channel", ... }
        // 2. Change notification: { kind: "api#change", ... }
        // 3. Sync token format: { change: { fileId: "...", ... } }
        // 4. HEADERS: Google Drive also sends webhook data in X-Goog-* headers!

        console.log('🔔 Google Drive webhook received (body):', {
            kind: body.kind,
            resourceUri: body.resourceUri,
            resourceState: body.resourceState,
            changed: body.changed,
            fullBody: Object.keys(body).length > 0 ? body : 'empty'
        })

        // Check if data is in headers instead of body
        // WHY: Google Drive sends webhook notifications in HTTP headers (X-Goog-*), not JSON body!
        if (headers['x-goog-resource-uri'] && (!body.resourceUri || !body.kind)) {
            console.log('📋 Webhook data found in headers, using headers instead of body')
            const resourceUri = headers['x-goog-resource-uri']
            const match = resourceUri.match(/\/files\/([^/?]+)/)
            if (match) {
                const fileId = match[1]
                console.log(`📄 Extracted file ID from header: ${fileId}`)
                // Continue with normal processing below
            }
        }

        // Handle subscription confirmation (initial setup)
        if (body.kind === 'api#channel' && body.resourceState === 'sync') {
            console.log('✅ Drive webhook subscription confirmed')
            return NextResponse.json({
                success: true,
                message: 'Subscription confirmed'
            })
        }

        // Extract file ID from resource URI
        // Format: "https://www.googleapis.com/drive/v3/files/{fileId}"
        // IMPORTANT: Google Drive sends webhook data in HTTP headers (X-Goog-*), not JSON body!
        let fileId = null

        // Priority 1: Check headers (X-Goog-Resource-Uri) - this is where Google Drive sends it!
        if (headers['x-goog-resource-uri']) {
            const match = headers['x-goog-resource-uri'].match(/\/files\/([^/?]+)/)
            if (match) {
                fileId = match[1]
                console.log(`✅ Extracted file ID from X-Goog-Resource-Uri header: ${fileId}`)
            }
        }

        // Priority 2: Check body.resourceUri (fallback)
        if (!fileId && body.resourceUri) {
            const match = body.resourceUri.match(/\/files\/([^/?]+)/)
            if (match) {
                fileId = match[1]
                console.log(`✅ Extracted file ID from body.resourceUri: ${fileId}`)
            }
        }

        // Priority 3: Check for fileId directly in body
        if (!fileId && body.fileId) {
            fileId = body.fileId
            console.log(`✅ Extracted file ID from body.fileId: ${fileId}`)
        }

        // Priority 4: Check for change object
        if (!fileId && body.change && body.change.fileId) {
            fileId = body.change.fileId
            console.log(`✅ Extracted file ID from body.change.fileId: ${fileId}`)
        }

        if (!fileId) {
            console.warn('⚠️ Could not extract file ID from Drive webhook')
            console.warn('   Body keys:', Object.keys(body))
            console.warn('   Headers with x-goog:', Object.keys(headers).filter(k => k.toLowerCase().startsWith('x-goog')))
            // Return 200 anyway (idempotent - Google will retry if needed)
            return NextResponse.json({
                success: false,
                message: 'File ID not found in webhook payload',
                debug: {
                    bodyKeys: Object.keys(body),
                    hasResourceUri: !!body.resourceUri,
                    hasHeaderResourceUri: !!headers['x-goog-resource-uri'],
                    headerResourceUri: headers['x-goog-resource-uri']
                }
            }, { status: 200 }) // 200 = webhook received, even if we can't process it
        }

        console.log(`📄 Drive change detected for file: ${fileId}`)

        // WHY: Check registry first - if sheet is not ACTIVE, ignore (defensive check)
        // This prevents processing sheets that shouldn't be synced
        // NOTE: We can't get user_id from Drive webhook, so we check all users
        // This is acceptable because we're only syncing if sheet exists in registry

        // Check if any user has this sheet registered as ACTIVE
        // Since Drive webhooks don't include user context, we check all users
        const registryCheck = await query(
            `SELECT user_id, status FROM "sheets" WHERE google_file_id = $1 AND status = 'ACTIVE' LIMIT 1`,
            [fileId]
        )

        if (registryCheck.length === 0) {
            console.log(`⚠️ File ${fileId} not found in registry or not ACTIVE, ignoring webhook`)
            // Return 200 - webhook received but ignored (idempotent)
            return NextResponse.json({
                success: true,
                message: 'File not in registry or not active, ignored'
            })
        }

        const { user_id: userId } = registryCheck[0]
        console.log(`✅ File ${fileId} found in registry (user: ${userId}), proceeding with sync`)

        // Step 1: Fetch current state from Google Sheets
        // WHY: Drive webhook only notifies us that file changed, not what changed
        // We need to fetch the full sheet state to compute diff
        const apiKey = process.env.GOOGLE_API_KEY || null
        const result = await fetchSheetData(fileId, 'Sheet1', apiKey)

        const sheetData = result.data || []
        const columns = result.columns || []

        if (columns.length === 0) {
            console.warn(`⚠️ No columns found in sheet ${fileId}`)
            return NextResponse.json({
                success: false,
                message: 'No columns found in sheet'
            }, { status: 200 }) // 200 = webhook processed (even if no columns)
        }

        console.log(`📊 Fetched ${sheetData.length} rows with ${columns.length} columns from Google Sheet`)

        // Step 2: Ensure table schema exists
        const tableName = await ensureTableSchema(fileId, columns)
        console.log(`✅ Table schema ensured: ${tableName}`)

        // Step 3: Get current snapshot from database
        const dbSnapshot = await getSnapshot(tableName, columns)
        console.log(`📸 Current database snapshot: ${dbSnapshot.length} rows`)

        // Step 4: Compute diff between sheet state and DB snapshot (with sync lock)
        // WHY: Use sync lock to prevent concurrent syncs
        const syncResult = await withSyncLock(fileId, async () => {
            const diff = computeDiff(sheetData, dbSnapshot, columns)
            console.log(`🔍 Diff computed: ${diff.inserts.length} inserts, ${diff.updates?.length || 0} updates, ${diff.deletes.length} deletes`)

            // Step 5: Apply diff idempotently
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
        console.log(`✅ Sync completed: ${rowsSynced} rows synced (${syncResult.inserted} inserted, ${syncResult.updated || 0} updated, ${syncResult.deleted || 0} deleted)`)

        // Broadcast SSE event to all connected clients
        // WHY: Notify frontend clients that sync completed so they can refresh UI
        broadcastSync(fileId, {
            type: 'sync-completed',
            sheetId: fileId,
            timestamp: new Date().toISOString(),
            changes: {
                inserted: syncResult.inserted,
                updated: syncResult.updated || 0,
                deleted: syncResult.deleted || 0,
                rowsSynced: rowsSynced
            }
        })

        // Return 200 immediately (webhook should respond quickly)
        // WHY: Google expects quick response (< 30 seconds)
        // Actual processing can continue in background if needed
        return NextResponse.json({
            success: true,
            message: 'Drive webhook processed and sync completed',
            synced: {
                fileId,
                rowsSynced,
                changes: {
                    inserted: syncResult.inserted,
                    updated: syncResult.updated || 0,
                    deleted: syncResult.deleted || 0
                }
            }
        })
    } catch (error) {
        console.error('❌ Drive webhook error:', error)

        // Return 200 even on error (idempotent - prevents retries)
        // WHY: If we return 5xx, Google will retry, but errors might be persistent
        // Better to log error and return 200, then handle manually if needed
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to process Drive webhook',
            error: error.message
        }, { status: 200 }) // 200 = webhook received (even if processing failed)
    }
}

/**
 * GET /api/sync/drive-webhook
 * Handle webhook verification (Google sometimes sends GET requests)
 */
export async function GET() {
    // Google Drive webhooks use POST, but some APIs use GET for verification
    return NextResponse.json({
        success: true,
        message: 'Drive webhook endpoint is active'
    })
}

