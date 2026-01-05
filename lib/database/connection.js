import pkg from 'pg'
const { Pool } = pkg

/**
 * DATABASE CONNECTION MODULE
 * 
 * Handles PostgreSQL connection pool management, query execution,
 * and connection testing.
 */

/**
 * Create PostgreSQL connection pool
 * Uses environment variables for configuration
 */
let pool = null

/**
 * Reset the connection pool (useful for testing or reconfiguration)
 */
export function resetPool() {
    if (pool) {
        pool.end().catch(err => console.error('Error closing pool:', err))
        pool = null
    }
}

function getPool() {
    if (!pool) {
        const config = {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432'),
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'superjoin_db',
            max: 20, // Maximum number of clients in the pool
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000, // Increased to 10 seconds for cloud databases
        }

        // Support connection string format (common in cloud providers like Neon, Supabase, etc.)
        // Check for DATABASE_URL, POSTGRESQL_URL, or POSTGRES_URL (all common variations)
        const connectionStringEnv = process.env.DATABASE_URL || process.env.POSTGRESQL_URL || process.env.POSTGRES_URL

        if (connectionStringEnv) {
            // Remove quotes if present (sometimes .env files include quotes)
            let connectionString = connectionStringEnv.trim().replace(/^["']|["']$/g, '')

            // Check if it's a Neon database (ALWAYS requires SSL)
            const isNeon = connectionString.includes('neon.tech') ||
                connectionString.includes('aws.neon.tech')

            // For Neon, ensure sslmode=require is in the connection string
            if (isNeon) {
                // Remove any existing sslmode parameter (including disable) and add require
                connectionString = connectionString.replace(/[?&]sslmode=[^&]*/g, '')
                // Also remove channel_binding if present (we'll add it back)
                connectionString = connectionString.replace(/[?&]channel_binding=[^&]*/g, '')
                const separator = connectionString.includes('?') ? '&' : '?'
                connectionString = `${connectionString}${separator}sslmode=require`
            }

            // Determine if SSL is required
            const requiresSSL = isNeon ||
                connectionString.includes('sslmode=require') ||
                connectionString.includes('sslmode=prefer') ||
                process.env.DB_SSL === 'true'

            // Create pool with explicit SSL configuration
            // Increased timeout for cloud databases (Neon can take longer to establish connection)
            const poolConfig = {
                connectionString: connectionString,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: isNeon ? 20000 : 10000, // 20s for Neon, 10s for others
            }

            // For Neon, ALWAYS set SSL explicitly (required by Neon)
            if (isNeon) {
                poolConfig.ssl = { rejectUnauthorized: false }
            } else if (requiresSSL) {
                poolConfig.ssl = { rejectUnauthorized: false }
            } else {
                poolConfig.ssl = false
            }

            pool = new Pool(poolConfig)
        } else {
            // Individual credentials - check if it's Neon or SSL is required
            const isNeon =
                config.host.includes('neon.tech') ||
                config.host.includes('aws.neon.tech')

            if (isNeon || process.env.DB_SSL === 'true') {
                config.ssl = { rejectUnauthorized: false }
                config.connectionTimeoutMillis = 15000 // 15 seconds for Neon/SSL connections
            }

            pool = new Pool(config)
        }
    }
    return pool
}

/**
 * Execute a query with error handling
 */
export async function query(sql, params = []) {
    try {
        const client = getPool()
        const result = await client.query(sql, params)
        return result.rows
    } catch (error) {
        console.error('Database query error:', error)
        throw error
    }
}

/**
 * Get connection for transactions
 */
export async function getConnection() {
    const client = await getPool().connect()
    return {
        query: async (sql, params) => {
            const result = await client.query(sql, params)
            return [result.rows]
        },
        beginTransaction: async () => {
            await client.query('BEGIN')
        },
        commit: async () => {
            await client.query('COMMIT')
        },
        rollback: async () => {
            await client.query('ROLLBACK')
        },
        release: () => {
            client.release()
        }
    }
}

/**
 * Test database connection with better error handling
 */
export async function testConnection() {
    try {
        // Check if connection string is available
        const connectionStringEnv = process.env.DATABASE_URL || process.env.POSTGRESQL_URL || process.env.POSTGRES_URL
        if (!connectionStringEnv) {
            console.error('❌ No connection string found in environment variables')
            return false
        }

        // Use a timeout wrapper to prevent hanging
        const queryPromise = query('SELECT 1')
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection test timeout after 25 seconds')), 25000)
        )

        await Promise.race([queryPromise, timeoutPromise])
        return true
    } catch (error) {
        const errorMessage = error.message || error.toString()
        console.error('Database connection test failed:', errorMessage)

        // Provide helpful error messages
        if (errorMessage.includes('timeout') || errorMessage.includes('Connection terminated')) {
            console.error('💡 Most likely cause: Neon database is SUSPENDED')
            console.error('   → Go to https://console.neon.tech and resume your database')
        } else if (errorMessage.includes('SSL')) {
            console.error('💡 SSL connection issue - check SSL configuration')
        } else if (errorMessage.includes('password') || errorMessage.includes('authentication')) {
            console.error('💡 Authentication failed - check your database credentials')
        }

        return false
    }
}

/**
 * Get connection pool status
 */
export async function getPoolStatus() {
    try {
        const pool = getPool()
        if (!pool) {
            return null
        }

        // Get pool statistics
        const totalCount = pool.totalCount || 0
        const idleCount = pool.idleCount || 0
        const waitingCount = pool.waitingCount || 0

        return {
            total: totalCount,
            idle: idleCount,
            active: totalCount - idleCount,
            waiting: waitingCount,
            isActive: totalCount > 0
        }
    } catch (error) {
        console.error('Error getting pool status:', error)
        return null
    }
}

