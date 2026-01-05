import { NextResponse } from 'next/server'

/**
 * POST /api/auth/google/logout
 * Logs out user by clearing Google auth cookies
 */
export async function POST(request) {
    const response = NextResponse.json({ success: true, message: 'Logged out successfully' })
    
    // Clear cookies
    response.cookies.delete('google_access_token')
    response.cookies.delete('google_refresh_token')
    response.cookies.delete('google_user_email')
    
    return response
}


