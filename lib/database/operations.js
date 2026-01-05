/**
 * DATABASE OPERATIONS MODULE
 * 
 * Handles data CRUD operations (fetch, update, insert, delete).
 * These are the main data manipulation functions.
 */

import { query, getConnection } from './connection.js'
import { sanitizeColumnName } from './schema.js'
import { computeRowHash } from '../diff-engine.js'

/**
 * Fetch all data from table
 * Gets actual column names from database and maps them back to original column names
 */
export async function fetchTableData(tableName, columns) {
    try {
        // Get actual column names from the database table
        const dbColumns = await query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = $1 
             AND column_name NOT IN ('id', 'created_at', 'updated_at', 'row_hash', 'revision', 'source', 'deleted_at')
             ORDER BY ordinal_position`,
            [tableName]
        )

        const dbColumnNames = dbColumns.map(col => col.column_name)

        // Build SELECT query with actual database column names
        // Exclude soft-deleted rows (deleted_at IS NULL means active)
        const selectSQL = `SELECT id, ${dbColumnNames.map(col => `"${col}"`).join(', ')} FROM "${tableName}" WHERE deleted_at IS NULL ORDER BY id`

        const rows = await query(selectSQL)

        // Map database column names back to original column names
        // We need to reverse the sanitization to find the original column name
        const data = rows.map(row => {
            const rowObj = { id: row.id }

            // For each original column, find its sanitized version in the database
            columns.forEach(originalCol => {
                const sanitizedCol = sanitizeColumnName(originalCol)
                // Find matching database column
                const dbCol = dbColumnNames.find(dbCol => dbCol === sanitizedCol)
                if (dbCol) {
                    rowObj[originalCol] = row[dbCol] || ''
                } else {
                    rowObj[originalCol] = ''
                }
            })

            return rowObj
        })

        return data
    } catch (error) {
        console.error('Error fetching table data:', error)
        throw error
    }
}

/**
 * Get the position (0-based index) of a row in the ordered list by ID
 * This is used to map database row ID to Google Sheets row position
 * @param {string} tableName - The table name
 * @param {number} rowId - The row ID to find
 * @returns {Promise<number|null>} - The 0-based position, or null if not found
 */
export async function getRowPosition(tableName, rowId) {
    try {
        const results = await query(
            `SELECT COUNT(*) as position FROM "${tableName}" WHERE id < $1 AND deleted_at IS NULL`,
            [rowId]
        )

        if (results.length === 0) {
            return null
        }

        return parseInt(results[0].position, 10)
    } catch (error) {
        console.error('Error getting row position:', error)
        throw error
    }
}

/**
 * Update a specific cell value
 */
export async function updateCell(tableName, rowId, column, value) {
    try {
        // Sanitize the column name to match database column
        const sanitizedColumn = sanitizeColumnName(column)

        await query(
            `UPDATE "${tableName}" SET "${sanitizedColumn}" = $1 WHERE id = $2`,
            [value, rowId]
        )

        return true
    } catch (error) {
        console.error('Error updating cell:', error)
        throw error
    }
}

/**
 * Insert a single row into the table
 * @param {string} tableName - The table name
 * @param {string[]} columns - Array of original column names
 * @param {object} rowData - Object with column names as keys and values
 * @returns {Promise<{id: number, success: boolean}>} - The inserted row ID
 */
export async function insertRow(tableName, columns, rowData) {
    try {
        // Build column mapping: original -> sanitized
        const columnMap = new Map()
        const sanitizedColumns = []
        const seenSanitized = new Set()

        for (const originalCol of columns) {
            const sanitized = sanitizeColumnName(originalCol)

            // Check for column name collisions after sanitization
            if (seenSanitized.has(sanitized)) {
                let counter = 1
                let uniqueSanitized = `${sanitized}_${counter}`
                while (seenSanitized.has(uniqueSanitized)) {
                    counter++
                    uniqueSanitized = `${sanitized}_${counter}`
                }
                columnMap.set(originalCol, uniqueSanitized)
                sanitizedColumns.push(uniqueSanitized)
                seenSanitized.add(uniqueSanitized)
            } else {
                columnMap.set(originalCol, sanitized)
                sanitizedColumns.push(sanitized)
                seenSanitized.add(sanitized)
            }
        }

        // Verify all sanitized columns exist in database
        const dbColumns = await query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = $1 
             AND column_name NOT IN ('id', 'created_at', 'updated_at', 'row_hash', 'revision', 'source', 'deleted_at')`,
            [tableName]
        )
        const dbColumnNames = new Set(dbColumns.map(col => col.column_name))

        // Check for missing columns in database
        const missingColumns = sanitizedColumns.filter(col => !dbColumnNames.has(col))
        if (missingColumns.length > 0) {
            throw new Error(`Database columns missing: ${missingColumns.join(', ')}. Please sync schema first.`)
        }

        // Compute row hash for the new row
        const hash = computeRowHash(rowData, columns)

        // Build values array - ensure every column has a value (even if null/empty)
        const dataValues = columns.map(originalCol => {
            const value = rowData[originalCol]
            // Preserve empty strings as empty strings, not null
            if (value === undefined || value === null) {
                return null
            }
            // Convert to string to ensure consistency (all TEXT columns)
            return String(value)
        })

        // Build INSERT query with snapshot columns (row_hash, revision, source)
        const columnNames = ['row_hash', 'revision', 'source']
            .concat(sanitizedColumns.map(col => `"${col}"`))
            .join(', ')
        const placeholders = ['$1', '$2', '$3']
            .concat(sanitizedColumns.map((_, index) => `$${index + 4}`))
            .join(', ')
        const insertSQL = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders}) RETURNING id`

        // Insert with hash, revision=1, source='manual' (since this is a manual insert)
        const result = await query(insertSQL, [hash, 1, 'manual', ...dataValues])

        if (result.length === 0) {
            throw new Error('Failed to insert row - no ID returned')
        }

        return {
            id: result[0].id,
            success: true
        }
    } catch (error) {
        console.error('Error inserting row:', error)
        throw error
    }
}

/**
 * Insert or update data in table
 * DEPRECATED: Use storeSnapshot/applyDiff instead for production-grade sync
 * Kept for backwards compatibility but will delete all and reinsert
 * 
 * Deletes all existing data and inserts new data
 * Ensures complete data consistency: all columns from sheet match database columns
 */
export async function upsertData(tableName, columns, data) {
    const connection = await getConnection()

    try {
        await connection.beginTransaction()

        // Build column mapping: original -> sanitized (ensure one-to-one mapping)
        const columnMap = new Map()
        const sanitizedColumns = []
        const seenSanitized = new Set()

        for (const originalCol of columns) {
            const sanitized = sanitizeColumnName(originalCol)

            // Check for column name collisions after sanitization
            if (seenSanitized.has(sanitized)) {
                // Add a suffix to make it unique
                let counter = 1
                let uniqueSanitized = `${sanitized}_${counter}`
                while (seenSanitized.has(uniqueSanitized)) {
                    counter++
                    uniqueSanitized = `${sanitized}_${counter}`
                }
                columnMap.set(originalCol, uniqueSanitized)
                sanitizedColumns.push(uniqueSanitized)
                seenSanitized.add(uniqueSanitized)
            } else {
                columnMap.set(originalCol, sanitized)
                sanitizedColumns.push(sanitized)
                seenSanitized.add(sanitized)
            }
        }

        // Verify all sanitized columns exist in database
        const dbColumns = await query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = $1 
             AND column_name NOT IN ('id', 'created_at', 'updated_at', 'row_hash', 'revision', 'source', 'deleted_at')`,
            [tableName]
        )
        const dbColumnNames = new Set(dbColumns.map(col => col.column_name))

        // Check for missing columns in database
        const missingColumns = sanitizedColumns.filter(col => !dbColumnNames.has(col))
        if (missingColumns.length > 0) {
            throw new Error(`Database columns missing: ${missingColumns.join(', ')}. Please sync schema first.`)
        }

        // Step 1: Delete all existing data
        await connection.query(`DELETE FROM "${tableName}"`, [])

        if (data.length === 0) {
            await connection.commit()
            return { inserted: 0, updated: 0 }
        }

        // Step 2: Insert new data - ensure all columns are included for each row
        const columnNames = sanitizedColumns.map(col => `"${col}"`).join(', ')
        const placeholders = sanitizedColumns.map((_, index) => `$${index + 1}`).join(', ')
        const insertSQL = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`

        let inserted = 0
        let skippedRows = 0

        for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
            const row = data[rowIndex]

            // Build values array - ensure every column has a value (even if null/empty)
            const values = columns.map(originalCol => {
                // Get value from row using original column name
                const value = row[originalCol]

                // Preserve empty strings as empty strings, not null
                // Only use null for truly missing/undefined values
                if (value === undefined || value === null) {
                    return null
                }

                // Convert to string to ensure consistency (all TEXT columns)
                return String(value)
            })

            try {
                await connection.query(insertSQL, values)
                inserted++
            } catch (error) {
                console.error(`❌ Error inserting row ${rowIndex + 1}:`, error.message)
                skippedRows++
                // Continue with next row instead of failing entire sync
            }
        }

        await connection.commit()

        return { inserted, updated: 0, skipped: skippedRows }
    } catch (error) {
        await connection.rollback()
        console.error('Error upserting data:', error)
        throw error
    } finally {
        connection.release()
    }
}

