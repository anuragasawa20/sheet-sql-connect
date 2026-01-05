import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

/**
 * GET /api/auth/status
 * Check if user is authenticated with Google
 */
export async function GET(request) {
    try {
        const cookieStore = cookies()
        const userEmail = cookieStore.get('google_user_email')?.value || null
        const refreshToken = cookieStore.get('google_refresh_token')?.value || null

        return NextResponse.json({
            authenticated: !!(userEmail && refreshToken),
            userEmail: userEmail
        })
    } catch (error) {
        return NextResponse.json({
            authenticated: false,
            userEmail: null
        })
    }
}


