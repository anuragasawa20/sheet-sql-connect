import { NextResponse } from 'next/server'
import { OAuth2Client } from 'google-auth-library'

/**
 * GET /api/auth/google
 * Initiates Google OAuth2 flow
 * Redirects user to Google consent screen
 */
export async function GET(request) {
    try {
        const clientId = process.env.GOOGLE_CLIENT_ID
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET
        const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${request.nextUrl.origin}/api/auth/google/callback`

        if (!clientId || !clientSecret) {
            return NextResponse.json(
                {
                    error: 'Google OAuth2 not configured',
                    message: 'Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables'
                },
                { status: 500 }
            )
        }

        const oauth2Client = new OAuth2Client(
            clientId,
            clientSecret,
            redirectUri
        )

        // Generate authorization URL
        const scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.readonly',
            'openid',
            'https://www.googleapis.com/auth/userinfo.email'
        ]

        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline', // Required to get refresh token
            scope: scopes,
            prompt: 'consent', // Force consent screen to get refresh token
            include_granted_scopes: true
        })

        // Redirect to Google
        return NextResponse.redirect(authUrl)
    } catch (error) {
        console.error('OAuth initiation error:', error)
        return NextResponse.json(
            {
                error: 'Failed to initiate OAuth flow',
                message: error.message
            },
            { status: 500 }
        )
    }
}

