import crypto from 'crypto'

/**
 * DIFF ENGINE
 * 
 * This module implements pure diff computation between Google Sheet state
 * and database snapshot. It has no side effects - only computes differences.
 * 
 * Core Principles:
 * - Database snapshot is the source of truth
 * - All correctness comes from snapshot + diffing logic
 * - Diff logic must be a pure function (no side effects)
 * - Stable row identifiers ensure correct matching
 */

/**
 * Compute a stable hash for a row based on its content
 * This creates a stable identifier that persists across syncs
 * 
 * Strategy: Hash the normalized row content (sorted by column name)
 * This ensures that two rows with the same content have the same hash,
 * even if column order differs
 * 
 * @param {object} row - Row data object
 * @param {string[]} columns - Column names (ordered)
 * @returns {string} SHA-256 hash of the row content
 */
export function computeRowHash(row, columns) {
    // Create a normalized representation of the row
    // Sort by column name to ensure consistent hashing regardless of property order
    const normalized = {}

    for (const col of columns) {
        const value = row[col]
        // Normalize: convert null/undefined to empty string, stringify everything
        normalized[col] = value === null || value === undefined ? '' : String(value)
    }

    // Create a stable string representation by sorting keys
    const sortedKeys = Object.keys(normalized).sort()
    const normalizedString = sortedKeys.map(key => `${key}:${normalized[key]}`).join('|')

    // Compute SHA-256 hash
    return crypto.createHash('sha256').update(normalizedString, 'utf8').digest('hex')
}

/**
 * Create a stable row identifier from row content
 * This identifier is used to match rows between sheet and DB
 * 
 * Strategy: Use the hash of the first few columns (typically an ID column)
 * OR use the row hash itself if no unique identifier exists
 * 
 * @param {object} row - Row data object
 * @param {string[]} columns - Column names
 * @param {number} rowIndex - Row index in the sheet (0-based, excluding header)
 * @returns {string} Stable row identifier
 */
export function computeRowId(row, columns, rowIndex) {
    // Try to find a natural ID column (common patterns)
    const idPatterns = ['id', 'uuid', '_id', 'row_id', 'key', 'primary_key']
    for (const pattern of idPatterns) {
        const idCol = columns.find(col =>
            col.toLowerCase().includes(pattern.toLowerCase())
        )
        if (idCol && row[idCol]) {
            return String(row[idCol])
        }
    }

    // If no natural ID, use a composite key: hash of first non-empty columns
    // OR fall back to row hash (which represents the entire row content)
    // For stability, we'll use the row hash as the identifier
    // NOTE: rowIndex is used for position-based matching in computeDiff
    return computeRowHash(row, columns)
}

/**
 * Compute diff between sheet state and database snapshot
 * 
 * Pure function - no side effects, only computes differences
 * 
 * @param {object[]} sheetRows - Rows from Google Sheet (current state)
 * @param {object[]} dbRows - Rows from database (snapshot)
 * @param {string[]} columns - Column names
 * @returns {object} Diff result with inserts, updates, deletes
 */
export function computeDiff(sheetRows, dbRows, columns) {
    // Match rows by position and use hash to detect content changes
    // This approach treats content changes as updates rather than delete+insert

    // Build maps for efficient lookup
    // Map: row_index -> row data (for matching by position)
    // Map: row_hash -> row data (for detecting content changes)
    const sheetRowsByIndex = new Map() // index -> { row, hash, rowId }
    const dbRowsByIndex = new Map() // index -> { row, hash, rowId, dbId }

    // Process sheet rows (indexed by position)
    sheetRows.forEach((row, index) => {
        const hash = computeRowHash(row, columns)
        const rowId = computeRowId(row, columns, index)
        sheetRowsByIndex.set(index, { row, hash, rowId, index })
    })

    // Process DB rows (indexed by position, assuming rows are ordered by ID)
    dbRows.forEach((dbRow, index) => {
        const hash = dbRow.row_hash || computeRowHash(dbRow, columns)
        const rowId = dbRow.row_id || computeRowId(dbRow, columns, dbRow.id || 0)
        dbRowsByIndex.set(index, { row: dbRow, hash, rowId, dbId: dbRow.id, index })
    })

    // Compute differences
    const inserts = []
    const updates = []
    const deletes = []

    // Find INSERTs and UPDATES: compare sheet rows with DB rows by position
    const maxSheetIndex = sheetRows.length
    const maxDbIndex = dbRows.length
    const maxIndex = Math.max(maxSheetIndex, maxDbIndex)

    for (let index = 0; index < maxIndex; index++) {
        const sheetRowData = sheetRowsByIndex.get(index)
        const dbRowData = dbRowsByIndex.get(index)

        if (sheetRowData && !dbRowData) {
            // Row exists in sheet but not in DB (at this position) = INSERT
            inserts.push({
                row: sheetRowData.row,
                hash: sheetRowData.hash,
                rowId: sheetRowData.rowId,
                index
            })
        } else if (!sheetRowData && dbRowData) {
            // Row exists in DB but not in sheet (at this position) = DELETE
            deletes.push({
                row: dbRowData.row,
                hash: dbRowData.hash,
                rowId: dbRowData.rowId,
                dbId: dbRowData.dbId,
                index
            })
        } else if (sheetRowData && dbRowData) {
            // Row exists in both - check if content changed
            if (sheetRowData.hash !== dbRowData.hash) {
                // Content changed at same position = UPDATE
                updates.push({
                    row: sheetRowData.row,
                    hash: sheetRowData.hash,
                    rowId: sheetRowData.rowId,
                    dbRow: dbRowData.row,
                    dbHash: dbRowData.hash,
                    dbId: dbRowData.dbId,
                    index
                })
            }
            // If hash matches, row is unchanged - skip
        }
    }

    return {
        inserts,
        updates,
        deletes,
        unchanged: sheetRows.length - inserts.length - updates.length
    }
}

/**
 * Normalize row data for consistent processing
 * Ensures all values are strings, nulls are empty strings, etc.
 * 
 * @param {object} row - Raw row data
 * @param {string[]} columns - Column names
 * @returns {object} Normalized row data
 */
export function normalizeRow(row, columns) {
    const normalized = {}

    for (const col of columns) {
        const value = row[col]
        if (value === null || value === undefined) {
            normalized[col] = ''
        } else {
            normalized[col] = String(value)
        }
    }

    return normalized
}

