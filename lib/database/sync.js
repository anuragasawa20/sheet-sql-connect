/**
 * DATABASE SYNC MODULE
 * 
 * Handles snapshot-based synchronization functions.
 * Implements production-grade sync with diff-based updates.
 */

import { query, getConnection } from './connection.js'
import { sanitizeColumnName } from './schema.js'

/**
 * Get current snapshot from database
 * Returns all active rows (deleted_at IS NULL) with their hashes and revisions
 * 
 * @param {string} tableName - Table name
 * @param {string[]} columns - Column names (original names)
 * @returns {Promise<object[]>} Array of snapshot rows
 */
export async function getSnapshot(tableName, columns) {
    try {
        // Get actual column names from database
        const dbColumns = await query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_schema = 'public' AND table_name = $1 
             AND column_name NOT IN ('id', 'created_at', 'updated_at', 'row_hash', 'revision', 'source', 'deleted_at')
             ORDER BY ordinal_position`,
            [tableName]
        )
        const dbColumnNames = dbColumns.map(col => col.column_name)

        // Build SELECT query with actual database column names
        const selectColumns = ['id', 'row_hash', 'revision', 'source', 'deleted_at']
            .concat(dbColumnNames.map(col => `"${col}"`))
            .join(', ')

        const selectSQL = `SELECT ${selectColumns} FROM "${tableName}" WHERE deleted_at IS NULL ORDER BY id`
        const rows = await query(selectSQL)

        // Map database column names back to original column names
        const snapshot = rows.map(row => {
            const rowObj = {
                id: row.id,
                row_hash: row.row_hash,
                revision: row.revision,
                source: row.source,
                deleted_at: row.deleted_at
            }

            // Map database columns back to original column names
            columns.forEach(originalCol => {
                const sanitizedCol = sanitizeColumnName(originalCol)
                const dbCol = dbColumnNames.find(dbCol => dbCol === sanitizedCol)
                if (dbCol) {
                    rowObj[originalCol] = row[dbCol] || ''
                } else {
                    rowObj[originalCol] = ''
                }
            })

            return rowObj
        })

        return snapshot
    } catch (error) {
        console.error('Error getting snapshot:', error)
        throw error
    }
}

/**
 * Apply diff to database snapshot
 * Idempotent operation: INSERT/UPDATE/SOFT DELETE
 * 
 * @param {string} tableName - Table name
 * @param {string[]} columns - Column names (original)
 * @param {object} diff - Diff result from computeDiff (inserts, updates, deletes)
 * @param {number} currentRevision - Current revision number (monotonic)
 * @returns {Promise<object>} Result with counts of inserted, updated, deleted
 */
export async function applyDiff(tableName, columns, diff, currentRevision = 1) {
    const connection = await getConnection()

    try {
        await connection.beginTransaction()

        // Build column mapping: original -> sanitized
        const columnMap = new Map()
        const sanitizedColumns = []
        const seenSanitized = new Set()

        for (const originalCol of columns) {
            const sanitized = sanitizeColumnName(originalCol)

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

        const missingColumns = sanitizedColumns.filter(col => !dbColumnNames.has(col))
        if (missingColumns.length > 0) {
            throw new Error(`Database columns missing: ${missingColumns.join(', ')}. Please sync schema first.`)
        }

        let inserted = 0
        let updated = 0
        let deleted = 0
        let skipped = 0

        // Apply UPDATES first (before inserts/deletes)
        for (const item of diff.updates || []) {
            try {
                const row = item.row
                const hash = item.hash
                const dbId = item.dbId

                if (!dbId) {
                    console.warn(`⚠️ Cannot update row - no DB ID`)
                    skipped++
                    continue
                }

                // Build values array
                const dataValues = columns.map(originalCol => {
                    const value = row[originalCol]
                    return value === null || value === undefined ? null : String(value)
                })

                // Build UPDATE query
                const setClause = ['row_hash = $1', 'revision = $2', 'source = $3']
                    .concat(sanitizedColumns.map((col, index) => `"${col}" = $${index + 4}`))
                    .join(', ')
                const updateSQL = `UPDATE "${tableName}" SET ${setClause} WHERE id = $${sanitizedColumns.length + 4} AND deleted_at IS NULL`

                await connection.query(updateSQL, [hash, currentRevision, 'sheet', ...dataValues, dbId])
                updated++
            } catch (error) {
                console.error(`❌ Error updating row:`, error.message)
                skipped++
            }
        }

        // Apply INSERTs
        for (const item of diff.inserts || []) {
            try {
                const row = item.row
                const hash = item.hash

                // Build values array
                const dataValues = columns.map(originalCol => {
                    const value = row[originalCol]
                    return value === null || value === undefined ? null : String(value)
                })

                // Build INSERT query with snapshot columns
                const columnNames = ['row_hash', 'revision', 'source']
                    .concat(sanitizedColumns.map(col => `"${col}"`))
                    .join(', ')
                const placeholders = ['$1', '$2', '$3']
                    .concat(sanitizedColumns.map((_, index) => `$${index + 4}`))
                    .join(', ')
                const insertSQL = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`

                await connection.query(insertSQL, [hash, currentRevision, 'sheet', ...dataValues])
                inserted++
            } catch (error) {
                console.error(`❌ Error inserting row:`, error.message)
                skipped++
            }
        }

        // Apply DELETEs (soft delete)
        for (const item of diff.deletes || []) {
            try {
                const hash = item.hash
                const dbId = item.dbId

                // Soft delete: set deleted_at timestamp
                // Use dbId if available (more reliable than hash for matching)
                if (dbId) {
                    await connection.query(
                        `UPDATE "${tableName}" SET deleted_at = CURRENT_TIMESTAMP, revision = $1 WHERE id = $2 AND deleted_at IS NULL`,
                        [currentRevision, dbId]
                    )
                } else {
                    // Fallback to hash if dbId not available
                    await connection.query(
                        `UPDATE "${tableName}" SET deleted_at = CURRENT_TIMESTAMP, revision = $1 WHERE row_hash = $2 AND deleted_at IS NULL`,
                        [currentRevision, hash]
                    )
                }
                deleted++
            } catch (error) {
                console.error(`❌ Error deleting row:`, error.message)
                skipped++
            }
        }

        await connection.commit()

        return {
            inserted,
            updated,
            deleted,
            skipped
        }
    } catch (error) {
        await connection.rollback()
        console.error('Error applying diff:', error)
        throw error
    } finally {
        connection.release()
    }
}

/**
 * Store initial snapshot (first sync)
 * Creates snapshot for sheet that has no existing rows
 * 
 * @param {string} tableName - Table name
 * @param {string[]} columns - Column names (original)
 * @param {object[]} data - Row data from sheet
 * @param {Function} computeRowHash - Function to compute row hash
 * @returns {Promise<object>} Result with count of inserted rows
 */
export async function storeSnapshot(tableName, columns, data, computeRowHash) {
    const connection = await getConnection()

    try {
        await connection.beginTransaction()

        // Build column mapping: original -> sanitized
        const columnMap = new Map()
        const sanitizedColumns = []
        const seenSanitized = new Set()

        for (const originalCol of columns) {
            const sanitized = sanitizeColumnName(originalCol)

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

        const missingColumns = sanitizedColumns.filter(col => !dbColumnNames.has(col))
        if (missingColumns.length > 0) {
            throw new Error(`Database columns missing: ${missingColumns.join(', ')}. Please sync schema first.`)
        }

        let inserted = 0
        let skipped = 0

        // Build INSERT query with snapshot columns
        const columnNames = ['row_hash', 'revision', 'source']
            .concat(sanitizedColumns.map(col => `"${col}"`))
            .join(', ')
        const placeholders = ['$1', '$2', '$3']
            .concat(sanitizedColumns.map((_, index) => `$${index + 4}`))
            .join(', ')
        const insertSQL = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`

        // Insert all rows
        for (const row of data) {
            try {
                const hash = computeRowHash(row, columns)

                // Build values array
                const dataValues = columns.map(originalCol => {
                    const value = row[originalCol]
                    return value === null || value === undefined ? null : String(value)
                })

                await connection.query(insertSQL, [hash, 1, 'sheet', ...dataValues])
                inserted++
            } catch (error) {
                console.error(`❌ Error inserting row:`, error.message)
                skipped++
            }
        }

        await connection.commit()

        return {
            inserted,
            skipped
        }
    } catch (error) {
        await connection.rollback()
        console.error('Error storing snapshot:', error)
        throw error
    } finally {
        connection.release()
    }
}

