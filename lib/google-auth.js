import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import { query } from './database'

/**
 * Get user's Google tokens from database
 * @param {string} userEmail - User's email address
 * @returns {Promise<{access_token: string, refresh_token: string}|null>}
 */
export async function getUserTokens(userEmail) {
    try {
        const results = await query(
            `SELECT access_token, refresh_token, expiry_date FROM user_google_tokens WHERE user_email = $1`,
            [userEmail]
        )

        if (results.length === 0) {
            return null
        }

        const tokenData = results[0]

        // Check if access token is expired
        if (tokenData.expiry_date && new Date(tokenData.expiry_date) < new Date()) {
            // Access token expired, need to refresh
            if (tokenData.refresh_token) {
                return await refreshAccessToken(tokenData.refresh_token, userEmail)
            }
            return null
        }

        return {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token
        }
    } catch (error) {
        console.error('Error getting user tokens:', error)
        return null
    }
}

/**
 * Refresh access token using refresh token
 * @param {string} refreshToken - Refresh token
 * @param {string} userEmail - User's email
 * @returns {Promise<{access_token: string, refresh_token: string}|null>}
 */
async function refreshAccessToken(refreshToken, userEmail) {
    try {
        const clientId = process.env.GOOGLE_CLIENT_ID
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET

        if (!clientId || !clientSecret) {
            console.error('OAuth2 credentials not configured for token refresh')
            return null
        }

        const oauth2Client = new OAuth2Client(clientId, clientSecret)
        oauth2Client.setCredentials({ refresh_token: refreshToken })

        const { credentials } = await oauth2Client.refreshAccessToken()

        // Update tokens in database
        await query(`
            UPDATE user_google_tokens 
            SET access_token = $1,
                expiry_date = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_email = $3
        `, [
            credentials.access_token,
            credentials.expiry_date ? new Date(credentials.expiry_date) : null,
            userEmail
        ])

        return {
            access_token: credentials.access_token,
            refresh_token: refreshToken
        }
    } catch (error) {
        console.error('Error refreshing access token:', error)
        return null
    }
}

/**
 * Get authenticated Google Sheets client
 * Supports multiple authentication methods in priority order:
 * 1. User OAuth2 tokens (from cookies/database) - for multi-user
 * 2. Service Account (best for server-side write operations)
 * 3. Global OAuth2 (for single user)
 * 4. API Key (only works for read operations)
 * 
 * @param {string} userEmail - Optional user email to get user-specific tokens
 * @returns {Promise<google.sheets_v4.Sheets>} Authenticated Google Sheets client
 * @throws {Error} If no valid authentication is configured
 */
export async function getGoogleSheetsClient(userEmail = null) {
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

                    return google.sheets({ version: 'v4', auth: oauth2Client })
                }
            } catch (error) {
                console.error('Error using user tokens:', error)
                // Fall through to other methods
            }
        }
    }

    // Priority 2: Service Account (for write operations)
    // Priority 1: Service Account (for write operations)
    const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    if (serviceAccountKey) {
        try {
            // Service account key can be JSON string or path to JSON file
            let credentials
            try {
                // Try parsing as JSON string first
                credentials = JSON.parse(serviceAccountKey)
            } catch {
                // If not JSON, treat as file path
                const fs = require('fs')
                const path = require('path')
                const keyPath = path.resolve(serviceAccountKey)
                credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
            }

            const auth = new google.auth.GoogleAuth({
                credentials: credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            })

            const authClient = await auth.getClient()
            return google.sheets({ version: 'v4', auth: authClient })
        } catch (error) {
            console.error('Error initializing Service Account:', error.message)
            throw new Error('Invalid Service Account configuration. Please check GOOGLE_SERVICE_ACCOUNT_KEY.')
        }
    }

    // Priority 2: OAuth2 Client (if available)
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN

    if (clientId && clientSecret && refreshToken) {
        try {
            const oauth2Client = new OAuth2Client(clientId, clientSecret)
            oauth2Client.setCredentials({ refresh_token: refreshToken })

            return google.sheets({ version: 'v4', auth: oauth2Client })
        } catch (error) {
            console.error('Error initializing OAuth2:', error.message)
            throw new Error('Invalid OAuth2 configuration. Please check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.')
        }
    }

    // Fallback: API Key (will fail for write operations but we'll handle the error)
    const apiKey = process.env.GOOGLE_API_KEY
    if (apiKey) {
        const auth = google.auth.fromAPIKey(apiKey)
        return google.sheets({ version: 'v4', auth })
    }

    throw new Error(
        'No Google authentication configured. ' +
        'Please set one of:\n' +
        '- GOOGLE_SERVICE_ACCOUNT_KEY (recommended for writes)\n' +
        '- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (OAuth2)\n' +
        '- GOOGLE_API_KEY (read-only)'
    )
}

/**
 * Check if authentication is configured
 * @param {string} userEmail - Optional user email to check user-specific auth
 * @returns {Promise<boolean>} True if any authentication method is available
 */
export async function hasGoogleAuth(userEmail = null) {
    // Check user-specific auth first
    if (userEmail) {
        const userTokens = await getUserTokens(userEmail)
        if (userTokens) {
            return true
        }
    }

    // Check global auth methods
    return !!(
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
        (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) ||
        process.env.GOOGLE_API_KEY
    )
}

/**
 * Get authentication method being used
 * @returns {string|null} 'service_account', 'oauth2', 'api_key', or null
 */
export function getAuthMethod() {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        return 'service_account'
    }
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
        return 'oauth2'
    }
    if (process.env.GOOGLE_API_KEY) {
        return 'api_key'
    }
    return null
}

/**
 * Check if write operations are supported
 * API keys only support read operations
 * @param {string} userEmail - Optional user email to check user-specific auth
 * @returns {Promise<boolean>} True if write operations are supported
 */
export async function supportsWriteOperations(userEmail = null) {
    // Check user-specific auth first
    if (userEmail) {
        const userTokens = await getUserTokens(userEmail)
        if (userTokens && userTokens.refresh_token) {
            return true
        }
    }

    // Check global auth methods
    const method = getAuthMethod()
    return method === 'service_account' || method === 'oauth2'
}

