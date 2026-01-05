/**
 * DATABASE REGISTRY MODULE
 * 
 * Handles sheet registry management for multi-tenant tracking.
 * Registry stores user_id, google_file_id, and status.
 */

import { query } from './connection.js'

/**
 * Ensure updated_at trigger function exists
 */
async function ensureUpdatedAtFunction() {
    await query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    `)
}

/**
 * Ensure sheet registry table exists
 * Multi-tenant registry: user_id -> google_file_id -> status
 * This is the source of truth for which sheets are connected
 */
async function ensureSheetRegistry() {
    try {
        await ensureUpdatedAtFunction()

        await query(`
      CREATE TABLE IF NOT EXISTS "sheets" (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        google_file_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, google_file_id)
      )
    `)

        // Create indexes for efficient lookups
        await query(`
      CREATE INDEX IF NOT EXISTS idx_sheets_user_id ON "sheets" (user_id)
    `)
        await query(`
      CREATE INDEX IF NOT EXISTS idx_sheets_google_file_id ON "sheets" (google_file_id)
    `)
        await query(`
      CREATE INDEX IF NOT EXISTS idx_sheets_status ON "sheets" (status)
    `)

        // Create trigger for updated_at
        await query(`
      DROP TRIGGER IF EXISTS update_sheets_updated_at ON "sheets";
      CREATE TRIGGER update_sheets_updated_at
      BEFORE UPDATE ON "sheets"
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `)
    } catch (error) {
        console.error('Error creating sheet registry table:', error)
        throw error
    }
}

/**
 * Get sheet status from registry
 * @param {string} userId - User email/ID
 * @param {string} googleFileId - Google Sheet ID
 * @returns {Promise<string|null>} Status (ACTIVE/DISCONNECTED/DELETED) or null if not found
 */
export async function getSheetStatus(userId, googleFileId) {
    try {
        await ensureSheetRegistry()
        const results = await query(
            `SELECT status FROM "sheets" WHERE user_id = $1 AND google_file_id = $2`,
            [userId, googleFileId]
        )
        return results.length > 0 ? results[0].status : null
    } catch (error) {
        console.error('Error getting sheet status:', error)
        return null
    }
}

/**
 * Register or update sheet in registry
 * @param {string} userId - User email/ID
 * @param {string} googleFileId - Google Sheet ID
 * @param {string} status - Status (ACTIVE/DISCONNECTED/DELETED)
 * @returns {Promise<boolean>} Success
 */
export async function registerSheet(userId, googleFileId, status = 'ACTIVE') {
    try {
        await ensureSheetRegistry()
        await query(`
            INSERT INTO "sheets" (user_id, google_file_id, status)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, google_file_id) DO UPDATE
            SET status = $3,
                updated_at = CURRENT_TIMESTAMP
        `, [userId, googleFileId, status])
        return true
    } catch (error) {
        console.error('Error registering sheet:', error)
        throw error
    }
}

/**
 * Check if sheet is active in registry
 * @param {string} userId - User email/ID
 * @param {string} googleFileId - Google Sheet ID
 * @returns {Promise<boolean>} True if sheet is ACTIVE
 */
export async function isSheetActive(userId, googleFileId) {
    const status = await getSheetStatus(userId, googleFileId)
    return status === 'ACTIVE'
}

