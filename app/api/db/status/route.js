import { NextResponse } from 'next/server'
import { testConnection, getPoolStatus } from '@/lib/database'

/**
 * GET /api/db/status
 * Check database connection status and pool information
 * Response: { connected: boolean, pool: { active, idle, total }, message: string }
 */
export async function GET() {
    try {
        // Test basic connection
        const isConnected = await testConnection()

        // Get pool status if available
        let poolStatus = null
        try {
            poolStatus = await getPoolStatus()
        } catch (error) {
            console.warn('Could not get pool status:', error.message)
        }

        if (isConnected) {
            return NextResponse.json({
                connected: true,
                pool: poolStatus,
                message: 'Database connection is active',
                timestamp: new Date().toISOString()
            })
        } else {
            return NextResponse.json({
                connected: false,
                pool: poolStatus,
                message: 'Database connection failed',
                timestamp: new Date().toISOString()
            }, { status: 503 })
        }
    } catch (error) {
        console.error('Database status check error:', error)
        return NextResponse.json({
            connected: false,
            pool: null,
            message: error.message || 'Failed to check database status',
            timestamp: new Date().toISOString()
        }, { status: 500 })
    }
}