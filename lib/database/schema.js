/**
 * DATABASE SCHEMA MODULE
 * 
 * Handles table schema management, column sanitization,
 * and sheet-to-table mapping.
 */

import { query } from './connection.js'

/**
 * Sanitize table name (remove special characters, ensure valid PostgreSQL identifier)
 */
export function sanitizeTableName(sheetId) {
    // Remove special characters, keep only alphanumeric and underscores
    // Prefix with 'sheet_' to ensure valid identifier
    return `sheet_${sheetId.replace(/[^a-zA-Z0-9_]/g, '_')}`
}

/**
 * Sanitize column name for PostgreSQL
 */
export function sanitizeColumnName(columnName) {
    // Remove special characters, replace spaces with underscores
    // Limit length to 63 characters (PostgreSQL identifier limit)
    let sanitized = columnName
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .toLowerCase()

    // Ensure it doesn't start with a number
    if (/^[0-9]/.test(sanitized)) {
        sanitized = `col_${sanitized}`
    }

    // Limit to 63 characters (PostgreSQL identifier limit)
    return sanitized.substring(0, 63) || 'unnamed_column'
}

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
 * Ensure sheet-to-table mapping table exists
 * Simple mapping: sheet_id -> table_name, columns
 */
async function ensureSheetTableMapping() {
    try {
        await ensureUpdatedAtFunction()

        await query(`
      CREATE TABLE IF NOT EXISTS "sheet_table_mapping" (
        id SERIAL PRIMARY KEY,
        sheet_id VARCHAR(255) UNIQUE NOT NULL,
        table_name VARCHAR(255) NOT NULL,
        columns JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

        // Create index
        await query(`
      CREATE INDEX IF NOT EXISTS idx_sheet_table_mapping_sheet_id ON "sheet_table_mapping" (sheet_id)
    `)
        await query(`
      CREATE INDEX IF NOT EXISTS idx_sheet_table_mapping_table_name ON "sheet_table_mapping" (table_name)
    `)

        // Create trigger for updated_at
        await query(`
      DROP TRIGGER IF EXISTS update_sheet_table_mapping_updated_at ON "sheet_table_mapping";
      CREATE TRIGGER update_sheet_table_mapping_updated_at
      BEFORE UPDATE ON "sheet_table_mapping"
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `)
    } catch (error) {
        console.error('Error creating sheet-table mapping table:', error)
        throw error
    }
}

/**
 * Store sheet-to-table mapping with columns
 */
async function storeSheetTableMapping(sheetId, tableName, columns = []) {
    try {
        await query(`
      INSERT INTO "sheet_table_mapping" (sheet_id, table_name, columns)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (sheet_id) DO UPDATE
        SET table_name = $2,
            columns = $3::jsonb,
            updated_at = CURRENT_TIMESTAMP
    `, [sheetId, tableName, JSON.stringify(columns)])
    } catch (error) {
        console.error('Error storing sheet-table mapping:', error)
        throw error
    }
}

/**
 * Create or update table schema based on sheet columns
 * This dynamically adapts to schema changes
 */
export async function ensureTableSchema(sheetId, columns) {
    const tableName = sanitizeTableName(sheetId)

    // Sanitize column names
    const sanitizedColumns = columns.map(col => ({
        original: col,
        sanitized: sanitizeColumnName(col)
    }))

    try {
        // Check if table exists
        const tables = await query(
            `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_name = $1`,
            [tableName]
        )

        if (tables.length === 0) {
            // Create new table with snapshot columns for tracking changes
            const columnDefinitions = [
                'id SERIAL PRIMARY KEY',
                'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
                'updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
                // Snapshot columns for production-grade sync
                'row_hash VARCHAR(64) NOT NULL', // SHA-256 hash of row content (hex = 64 chars)
                'revision INTEGER DEFAULT 1', // Monotonic revision number
                'source VARCHAR(50) DEFAULT \'sheet\'', // Source of data (sheet/db/manual)
                'deleted_at TIMESTAMP NULL', // Soft delete marker (NULL = active, timestamp = deleted)
                ...sanitizedColumns.map(col => `"${col.sanitized}" TEXT`)
            ]

            const createTableSQL = `
        CREATE TABLE "${tableName}" (
          ${columnDefinitions.join(',\n          ')}
        )
      `

            await query(createTableSQL)

            // Ensure sheet-to-table mapping exists with columns
            await ensureSheetTableMapping()
            await storeSheetTableMapping(sheetId, tableName, columns)

            // Create trigger function for updated_at (PostgreSQL doesn't support ON UPDATE)
            await ensureUpdatedAtFunction()

            // Create trigger for updated_at
            await query(`
        CREATE TRIGGER update_${tableName}_updated_at
        BEFORE UPDATE ON "${tableName}"
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
      `)

        } else {
            // Table exists - add snapshot columns if missing (for existing tables)
            // Check if snapshot columns exist
            const snapshotColumns = ['row_hash', 'revision', 'source', 'deleted_at']
            const existingColumns = await query(
                `SELECT column_name FROM information_schema.columns 
         WHERE table_schema = 'public' AND table_name = $1`,
                [tableName]
            )
            const existingColumnNames = new Set(existingColumns.map(col => col.column_name))

            // Add missing snapshot columns
            for (const colName of snapshotColumns) {
                if (!existingColumnNames.has(colName)) {
                    try {
                        if (colName === 'row_hash') {
                            await query(`ALTER TABLE "${tableName}" ADD COLUMN "${colName}" VARCHAR(64)`)
                            // Set default hash for existing rows (we'll update on next sync)
                            await query(`UPDATE "${tableName}" SET "${colName}" = '' WHERE "${colName}" IS NULL`)
                            await query(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET NOT NULL`)
                        } else if (colName === 'revision') {
                            await query(`ALTER TABLE "${tableName}" ADD COLUMN "${colName}" INTEGER DEFAULT 1`)
                        } else if (colName === 'source') {
                            await query(`ALTER TABLE "${tableName}" ADD COLUMN "${colName}" VARCHAR(50) DEFAULT 'sheet'`)
                        } else if (colName === 'deleted_at') {
                            await query(`ALTER TABLE "${tableName}" ADD COLUMN "${colName}" TIMESTAMP NULL`)
                        }
                        console.log(`✅ Added snapshot column ${colName} to ${tableName}`)
                    } catch (error) {
                        console.warn(`⚠️ Could not add snapshot column ${colName}:`, error.message)
                    }
                }
            }

            // Check for new data columns (excluding system and snapshot columns)
            const dataColumns = await query(
                `SELECT column_name FROM information_schema.columns 
         WHERE table_schema = 'public' AND table_name = $1 
         AND column_name NOT IN ('id', 'created_at', 'updated_at', 'row_hash', 'revision', 'source', 'deleted_at')`,
                [tableName]
            )

            const existingDataColumnNames = dataColumns.map(col => col.column_name)
            const newColumns = sanitizedColumns.filter(
                col => !existingDataColumnNames.includes(col.sanitized)
            )

            // Add new columns - ensure all columns from sheet exist in database
            for (const col of newColumns) {
                try {
                    await query(
                        `ALTER TABLE "${tableName}" ADD COLUMN "${col.sanitized}" TEXT`
                    )
                } catch (error) {
                    // Column might already exist or there's a conflict
                    console.warn(`⚠️ Could not add column ${col.sanitized}:`, error.message)
                    throw new Error(`Failed to add column ${col.sanitized} (original: ${col.original}). This may cause data inconsistency.`)
                }
            }

            // Check for removed columns (columns in DB but not in sheet)
            // We keep them in DB but they'll be NULL for new rows
            // Note: removedColumns is intentionally not used - we keep old columns for data preservation
            const removedColumns = Array.from(existingColumnNames).filter(
                dbCol => !sanitizedColumns.some(sanitized => sanitized.sanitized === dbCol)
            )
            // removedColumns is intentionally not used - we keep old columns for data preservation

            // Ensure sheet-to-table mapping exists with columns
            await ensureSheetTableMapping()
            await storeSheetTableMapping(sheetId, tableName, columns)
        }

        return tableName
    } catch (error) {
        console.error(`❌ Error ensuring table schema for ${tableName}:`, error)
        throw error
    }
}

/**
 * Get columns for a sheet ID
 */
export async function getSheetColumns(sheetId) {
    try {
        const results = await query(
            `SELECT columns FROM "sheet_table_mapping" WHERE sheet_id = $1`,
            [sheetId]
        )

        if (results.length === 0) {
            return null
        }

        return results[0].columns
    } catch (error) {
        console.error('Error getting sheet columns:', error)
        return null
    }
}

/**
 * Get table name for a sheet ID
 */
export async function getTableName(sheetId) {
    try {
        const results = await query(
            `SELECT table_name FROM "sheet_table_mapping" WHERE sheet_id = $1`,
            [sheetId]
        )

        if (results.length === 0) {
            return null
        }

        return results[0].table_name
    } catch (error) {
        console.error('Error getting table name:', error)
        return null
    }
}

/**
 * Get sheet ID for a table name
 */
export async function getSheetId(tableName) {
    try {
        const results = await query(
            `SELECT sheet_id FROM "sheet_table_mapping" WHERE table_name = $1`,
            [tableName]
        )

        if (results.length === 0) {
            return null
        }

        return results[0].sheet_id
    } catch (error) {
        console.error('Error getting sheet ID:', error)
        return null
    }
}

