import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { extractSheetId, validateSheetInput } from '@/lib/utils'
import { fetchSheetData } from '@/lib/google-sheets'
import { subscribeToDriveChanges } from '@/lib/google-drive'
import {
    ensureTableSchema,
    testConnection,
    registerSheet,
    getSheetStatus,
    getSnapshot,
    storeSnapshot,
    applyDiff,
    query
} from '@/lib/database'
import { computeDiff, computeRowHash } from '@/lib/diff-engine'

/**
 * Get user email from cookies
 */
function getUserEmail() {
    const cookieStore = cookies()
    const emailCookie = cookieStore.get('google_user_email')
    return emailCookie ? emailCookie.value : null
}

/**
 * POST /api/connect
 * Connect to a Google Sheet and automatically fetch/store data
 * Body: { sheetUrl: string }
 * Response: { success: boolean, sheetId: string, rowsSynced: number, message: string }
 */
export async function POST(request) {
    try {
        const body = await request.json()
        const { sheetUrl } = body

        if (!sheetUrl) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Sheet URL or ID is required'
                },
                { status: 400 }
            )
        }

        // Validate input
        if (!validateSheetInput(sheetUrl)) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Invalid Google Sheet URL or ID format'
                },
                { status: 400 }
            )
        }

        // Extract sheet ID
        const sheetId = extractSheetId(sheetUrl)

        if (!sheetId) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Could not extract Sheet ID from URL'
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

        console.log(`🔗 Connecting to Google Sheet (Sheet ID: ${sheetId})`)

        // Step 1: Fetch data from Google Sheets
        const apiKey = process.env.GOOGLE_API_KEY || null
        const result = await fetchSheetData(sheetId, 'Sheet1', apiKey)

        const sheetData = result.data || []
        const columns = result.columns || []

        if (columns.length === 0) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'No columns found in the Google Sheet. Please ensure the sheet has headers in the first row.'
                },
                { status: 400 }
            )
        }

        console.log(`📊 Fetched ${sheetData.length} rows with ${columns.length} columns from Google Sheet`)

        // Step 2: Get user email and register sheet in registry
        const userEmail = getUserEmail()
        console.log(`🔍 User email check: ${userEmail ? `Found (${userEmail})` : 'Not found (not logged in)'}`)

        if (userEmail) {
            // WHY: Register sheet in registry to track connection status
            // This enables multi-tenant isolation and status tracking
            await registerSheet(userEmail, sheetId, 'ACTIVE')
            console.log(`✅ Registered sheet in registry (user: ${userEmail}, status: ACTIVE)`)

            // Step 2.1: Subscribe to Google Drive push notifications (optional)
            // WHY: Enable real-time sync when Google Sheet changes
            // Only subscribe if ENABLE_DRIVE_WEBHOOKS is enabled
            const enableWebhooks = process.env.ENABLE_DRIVE_WEBHOOKS === 'true'
            console.log(`🔍 Drive webhooks enabled: ${enableWebhooks} (ENABLE_DRIVE_WEBHOOKS=${process.env.ENABLE_DRIVE_WEBHOOKS})`)

            if (enableWebhooks) {
                try {
                    const webhookUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://your-domain.com'}/api/sync/drive-webhook`
                    console.log(`🔄 Attempting to subscribe to Drive changes for ${sheetId}`)
                    console.log(`   Webhook URL: ${webhookUrl}`)

                    const subscriptionResult = await subscribeToDriveChanges(sheetId, webhookUrl, null, 7 * 24 * 60 * 60 * 1000, userEmail)
                    console.log(`✅ Subscribed to Drive push notifications for ${sheetId}`)
                    console.log(`   Channel ID: ${subscriptionResult.channelId}`)
                    console.log(`   Resource ID: ${subscriptionResult.resourceId}`)
                    console.log(`   Expires: ${subscriptionResult.expirationDate}`)
                } catch (error) {
                    // WHY: Don't fail the connection if subscription fails
                    // Subscription is optional - user can still use manual sync
                    console.error(`❌ Failed to subscribe to Drive notifications for ${sheetId}:`, error)
                    console.error(`   Error message: ${error.message}`)
                    console.error(`   Error stack: ${error.stack}`)
                    // Continue with connection even if subscription fails
                }
            } else {
                console.log(`ℹ️ Drive webhooks disabled - set ENABLE_DRIVE_WEBHOOKS=true to enable automatic sync`)
            }
        } else {
            console.log(`ℹ️ No user email found - Drive webhooks require user authentication`)
        }

        // Step 3: Ensure table schema exists and is up-to-date
        const tableName = await ensureTableSchema(sheetId, columns)
        console.log(`✅ Table schema ensured: ${tableName}`)

        // Step 4: Get current snapshot from database (source of truth)
        const dbSnapshot = await getSnapshot(tableName, columns)
        console.log(`📸 Current database snapshot: ${dbSnapshot.length} rows`)

        // Step 5: Compute diff between sheet state and DB snapshot
        // WHY: Use snapshot-based sync instead of delete-all-then-insert
        // This preserves existing data and only applies changes
        const diff = computeDiff(sheetData, dbSnapshot, columns)
        console.log(`🔍 Diff computed: ${diff.inserts.length} inserts, ${diff.deletes.length} deletes`)

        // Step 6: Apply diff idempotently (or store initial snapshot if no existing rows)
        let syncResult
        if (dbSnapshot.length === 0) {
            // First sync: store initial snapshot
            console.log(`📦 Storing initial snapshot (${sheetData.length} rows)`)
            syncResult = await storeSnapshot(tableName, columns, sheetData, computeRowHash)
            syncResult.updated = 0
            syncResult.deleted = 0
        } else {
            // Subsequent sync: apply diff
            console.log(`🔄 Applying diff (${diff.inserts.length} inserts, ${diff.deletes.length} deletes)`)
            // Get current max revision
            const maxRevisionResult = await query(
                `SELECT COALESCE(MAX(revision), 0) as max_revision FROM "${tableName}"`,
                []
            )
            const currentRevision = (maxRevisionResult[0]?.max_revision || 0) + 1
            syncResult = await applyDiff(tableName, columns, diff, currentRevision)
        }

        const rowsSynced = syncResult.inserted + (syncResult.updated || 0) + (syncResult.deleted || 0)
        const skippedRows = syncResult.skipped || 0

        let message = `Successfully connected and synced ${rowsSynced} rows (${syncResult.inserted} inserted, ${syncResult.deleted || 0} deleted)`
        if (skippedRows > 0) {
            message += ` (${skippedRows} rows skipped due to errors)`
        }

        return NextResponse.json({
            success: true,
            sheetId: sheetId,
            rowsSynced: rowsSynced,
            changes: {
                inserted: syncResult.inserted,
                updated: syncResult.updated || 0,
                deleted: syncResult.deleted || 0,
                skipped: skippedRows
            },
            message: message,
        })
    } catch (error) {
        console.error('Connection error:', error)

        // Provide helpful error messages
        let errorMessage = error.message || 'Failed to connect to Google Sheet'
        if (error.message?.includes('not publicly accessible')) {
            errorMessage = 'Sheet is not publicly accessible. Please set sharing to "Anyone with the link can view"'
        } else if (error.message?.includes('not found')) {
            errorMessage = 'Google Sheet not found. Please check the Sheet ID.'
        }

        return NextResponse.json(
            {
                success: false,
                message: errorMessage
            },
            { status: 500 }
        )
    }
}

