/**
 * DATABASE MODULE - BARREL EXPORT
 * 
 * This file re-exports all database functions from organized modules.
 * This maintains backwards compatibility while organizing code into logical modules.
 * 
 * Module Structure:
 * - connection.js: Pool management, query execution, connection testing
 * - schema.js: Schema management, table/column sanitization, mapping
 * - registry.js: Sheet registry functions (multi-tenant tracking)
 * - sync.js: Snapshot-based sync functions (getSnapshot, applyDiff, storeSnapshot)
 * - operations.js: Data CRUD operations (fetchTableData, updateCell, insertRow, etc.)
 */

// Connection module
export {
    query,
    getConnection,
    testConnection,
    getPoolStatus,
    resetPool
} from './database/connection.js'

// Schema module
export {
    sanitizeTableName,
    sanitizeColumnName,
    ensureTableSchema,
    getSheetColumns,
    getTableName,
    getSheetId
} from './database/schema.js'

// Registry module
export {
    getSheetStatus,
    registerSheet,
    isSheetActive
} from './database/registry.js'

// Sync module
export {
    getSnapshot,
    applyDiff,
    storeSnapshot
} from './database/sync.js'

// Operations module
export {
    fetchTableData,
    getRowPosition,
    updateCell,
    insertRow,
    upsertData
} from './database/operations.js'
