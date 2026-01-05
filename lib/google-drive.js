/**
 * GOOGLE DRIVE API MODULE
 * 
 * Handles Google Drive API operations including push notifications
 * for change detection.
 */

import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import { getUserTokens } from './google-auth.js'

/**
 * Get authenticated Google Drive client
 * Uses same authentication as Google Sheets client
 * 
 * @param {string} userEmail - Optional user email to get user-specific tokens
 * @returns {Promise<google.drive_v3.Drive>} Authenticated Google Drive client
 * @throws {Error} If no valid authentication is configured
 */
export async function getGoogleDriveClient(userEmail = null) {
    // Priority 1: User-specific OAuth2 tokens (for multi-user support)
    if (userEmail) {
        const userTokens = await getUserTokens(userEmail)
        if (userTokens && userTokens.refresh_token) {
            try {
                const clientId = process.env.GOOGLE_CLIENT_ID
                const clientSecret = process.env.GOOGLE_CLIENT_SECRET

                if (clientId && clientSecret) {
                    const oauth2Client = new OAuth2Client(clientId, clientSecret)
                    oauth2Client.setCredentials({
                        refresh_token: userTokens.refresh_token,
                        access_token: userTokens.access_token
                    })

                    return google.drive({ version: 'v3', auth: oauth2Client })
                }
            } catch (error) {
                console.error('Error using user tokens for Drive:', error)
                // Fall through to other methods
            }
        }
    }

    // Priority 2: Service Account
    const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    if (serviceAccountKey) {
        try {
            let credentials
            try {
                credentials = JSON.parse(serviceAccountKey)
            } catch {
                const fs = require('fs')
                const path = require('path')
                const keyPath = path.resolve(serviceAccountKey)
                credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
            }

            const auth = new google.auth.GoogleAuth({
                credentials: credentials,
                scopes: [
                    'https://www.googleapis.com/auth/drive.readonly',
                    'https://www.googleapis.com/auth/drive.file'
                ]
            })

            const authClient = await auth.getClient()
            return google.drive({ version: 'v3', auth: authClient })
        } catch (error) {
            console.error('Error initializing Service Account for Drive:', error.message)
            throw new Error('Invalid Service Account configuration for Drive API.')
        }
    }

    // Priority 3: Global OAuth2
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN

    if (clientId && clientSecret && refreshToken) {
        try {
            const oauth2Client = new OAuth2Client(clientId, clientSecret)
            oauth2Client.setCredentials({ refresh_token: refreshToken })

            return google.drive({ version: 'v3', auth: oauth2Client })
        } catch (error) {
            console.error('Error initializing OAuth2 for Drive:', error.message)
            throw new Error('Invalid OAuth2 configuration for Drive API.')
        }
    }

    throw new Error(
        'No Google authentication configured for Drive API. ' +
        'Please set GOOGLE_SERVICE_ACCOUNT_KEY or OAuth2 credentials.'
    )
}

/**
 * Subscribe to Google Drive file change notifications
 * 
 * This creates a push notification subscription for a specific file.
 * When the file changes, Google Drive will send a webhook to the specified URL.
 * 
 * @param {string} fileId - Google Drive file ID (Sheet ID)
 * @param {string} webhookUrl - URL to receive webhook notifications
 * @param {string} channelId - Unique channel ID for this subscription
 * @param {number} expirationMs - Subscription expiration time in milliseconds (default: 7 days, max: 7 days)
 * @param {string} userEmail - Optional user email for authentication
 * @returns {Promise<object>} Watch response with resource ID and expiration
 * 
 * NOTE: Google Drive API allows maximum expiration of 7 days (604,800,000 ms).
 * Subscriptions expire after the specified time. You need to renew subscriptions
 * periodically if you want longer-term subscriptions, or use a service to manage them.
 */
export async function subscribeToDriveChanges(
    fileId,
    webhookUrl,
    channelId = null,
    expirationMs = 7 * 24 * 60 * 60 * 1000, // 7 days (maximum allowed by Google Drive API)
    userEmail = null
) {
    try {
        const drive = await getGoogleDriveClient(userEmail)

        // Generate unique channel ID if not provided
        if (!channelId) {
            channelId = `channel-${fileId}-${Date.now()}-${Math.random().toString(36).substring(7)}`
        }

        // Google Drive API maximum expiration: 7 days (604,800,000 ms)
        const MAX_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

        // Clamp expiration to maximum allowed by Google Drive API
        const clampedExpirationMs = Math.min(expirationMs, MAX_EXPIRATION_MS)

        if (expirationMs > MAX_EXPIRATION_MS) {
            console.warn(`⚠️ Expiration ${expirationMs}ms exceeds maximum ${MAX_EXPIRATION_MS}ms, using maximum`)
        }

        // Calculate expiration timestamp (current time + expiration duration)
        // Google Drive API expects expiration as Unix timestamp in milliseconds
        const expiration = new Date(Date.now() + clampedExpirationMs).getTime()

        // Create watch subscription
        const watchResponse = await drive.files.watch({
            fileId: fileId,
            requestBody: {
                id: channelId,
                type: 'web_hook',
                address: webhookUrl,
                expiration: expiration.toString()
            }
        })

        console.log(`✅ Subscribed to Drive changes for file ${fileId}`)
        console.log(`   Channel ID: ${channelId}`)
        console.log(`   Webhook URL: ${webhookUrl}`)
        console.log(`   Expires: ${new Date(expiration).toISOString()}`)

        return {
            success: true,
            resourceId: watchResponse.data.resourceId,
            channelId: channelId,
            expiration: expiration,
            expirationDate: new Date(expiration).toISOString()
        }
    } catch (error) {
        console.error('Error subscribing to Drive changes:', error)
        throw error
    }
}

/**
 * Stop a Drive change notification subscription
 * 
 * @param {string} resourceId - Resource ID from watch response
 * @param {string} channelId - Channel ID from watch response
 * @param {string} userEmail - Optional user email for authentication
 * @returns {Promise<boolean>} Success
 */
export async function stopDriveSubscription(
    resourceId,
    channelId,
    userEmail = null
) {
    try {
        const drive = await getGoogleDriveClient(userEmail)

        await drive.channels.stop({
            requestBody: {
                id: channelId,
                resourceId: resourceId
            }
        })

        console.log(`✅ Stopped Drive subscription (channel: ${channelId})`)
        return true
    } catch (error) {
        console.error('Error stopping Drive subscription:', error)
        throw error
    }
}

/**
 * Get file metadata from Google Drive
 * 
 * @param {string} fileId - Google Drive file ID
 * @param {string} userEmail - Optional user email for authentication
 * @returns {Promise<object>} File metadata
 */
export async function getFileMetadata(fileId, userEmail = null) {
    try {
        const drive = await getGoogleDriveClient(userEmail)

        const response = await drive.files.get({
            fileId: fileId,
            fields: 'id,name,mimeType,modifiedTime,createdTime'
        })

        return {
            id: response.data.id,
            name: response.data.name,
            mimeType: response.data.mimeType,
            modifiedTime: response.data.modifiedTime,
            createdTime: response.data.createdTime
        }
    } catch (error) {
        console.error('Error getting file metadata:', error)
        throw error
    }
}

