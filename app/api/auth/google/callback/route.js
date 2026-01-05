import { NextResponse } from 'next/server'
import { OAuth2Client } from 'google-auth-library'
import { google } from 'googleapis'
import { query } from '@/lib/database'

/**
 * GET /api/auth/google/callback
 * Handles Google OAuth2 callback
 * Exchanges authorization code for tokens and stores them
 */
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url)
        const code = searchParams.get('code')
        const error = searchParams.get('error')

        if (error) {
            return NextResponse.redirect(
                `${request.nextUrl.origin}/?error=${encodeURIComponent(error)}`
            )
        }

        if (!code) {
            return NextResponse.redirect(
                `${request.nextUrl.origin}/?error=${encodeURIComponent('No authorization code received')}`
            )
        }

        const clientId = process.env.GOOGLE_CLIENT_ID
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET
        const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/google/callback`

        if (!clientId || !clientSecret) {
            return NextResponse.redirect(
                `${request.nextUrl.origin}/?error=${encodeURIComponent('OAuth2 not configured')}`
            )
        }

        const oauth2Client = new OAuth2Client(
            clientId,
            clientSecret,
            redirectUri
        )

        // Exchange code for tokens
        const { tokens } = await oauth2Client.getToken(code)

        if (!tokens.refresh_token) {
            console.warn('⚠️ No refresh token received. User may need to revoke access and re-authenticate.')
        }

        // Get user info
        let userEmail = null
        try {
            oauth2Client.setCredentials(tokens)
            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
            const userInfo = await oauth2.userinfo.get()
            if (userInfo.data && userInfo.data.email) {
                userEmail = userInfo.data.email
            }
        } catch (userInfoError) {
            console.warn('⚠️ Could not fetch user info:', userInfoError.message)
            // If userinfo fails, we can still store tokens but without email
            // The user will need to re-authenticate or we can use token-based identification
            console.log('Tokens received but user info unavailable. Storing tokens without email.')
        }

        // If we couldn't get email, generate a unique identifier from refresh token
        if (!userEmail && tokens.refresh_token) {
            // Use first 8 chars of refresh token as identifier (not ideal but works)
            userEmail = `user_${tokens.refresh_token.substring(0, 8)}@temp.local`
            console.log('Using temporary identifier:', userEmail)
        }

        if (!userEmail) {
            throw new Error('Could not identify user. Please try authenticating again.')
        }

        // Store tokens in database (or use session/cookies)
        // For simplicity, we'll store in a user_tokens table
        // In production, you might want to use sessions or encrypt tokens
        try {
            // Create table if it doesn't exist
            await query(`
                CREATE TABLE IF NOT EXISTS user_google_tokens (
                    id SERIAL PRIMARY KEY,
                    user_email VARCHAR(255) UNIQUE NOT NULL,
                    access_token TEXT,
                    refresh_token TEXT NOT NULL,
                    token_type VARCHAR(50),
                    expiry_date TIMESTAMP,
                    scope TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `)

            // Upsert tokens
            await query(`
                INSERT INTO user_google_tokens 
                (user_email, access_token, refresh_token, token_type, expiry_date, scope)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (user_email) DO UPDATE
                SET access_token = $2,
                    refresh_token = $3,
                    token_type = $4,
                    expiry_date = $5,
                    scope = $6,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                userEmail,
                tokens.access_token || null,
                tokens.refresh_token || null,
                tokens.token_type || 'Bearer',
                tokens.expiry_date ? new Date(tokens.expiry_date) : null,
                tokens.scope || null
            ])

            console.log(`✅ Stored tokens for user: ${userEmail}`)
        } catch (dbError) {
            console.error('Error storing tokens:', dbError)
            // Continue anyway - tokens are in memory
        }

        // Store tokens in cookie for immediate use (optional, for session-based auth)
        const response = NextResponse.redirect(`${request.nextUrl.origin}/?auth=success`)

        // Set secure cookie with tokens (in production, use httpOnly and secure flags)
        if (tokens.access_token) {
            response.cookies.set('google_access_token', tokens.access_token, {
                maxAge: 60 * 60, // 1 hour
                sameSite: 'lax',
                path: '/'
            })
        }

        if (tokens.refresh_token) {
            response.cookies.set('google_refresh_token', tokens.refresh_token, {
                maxAge: 60 * 60 * 24 * 30, // 30 days
                sameSite: 'lax',
                path: '/',
                httpOnly: true // More secure
            })
        }

        response.cookies.set('google_user_email', userEmail, {
            maxAge: 60 * 60 * 24 * 30, // 30 days
            sameSite: 'lax',
            path: '/'
        })

        return response
    } catch (error) {
        console.error('OAuth callback error:', error)
        return NextResponse.redirect(
            `${request.nextUrl.origin}/?error=${encodeURIComponent(error.message || 'Authentication failed')}`
        )
    }
}

