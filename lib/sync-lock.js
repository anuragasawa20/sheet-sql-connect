/**
 * SYNC LOCK MODULE
 * 
 * Prevents multiple syncs from running concurrently for the same sheet.
 * This ensures that when a sync is in progress, subsequent sync requests
 * are queued or rejected until the current sync completes.
 */

// In-memory lock store: sheetId -> sync promise
const syncLocks = new Map()

/**
 * Check if a sync is currently in progress for a sheet
 * 
 * @param {string} sheetId - Google Sheet ID
 * @returns {boolean} True if sync is in progress
 */
export function isSyncInProgress(sheetId) {
    return syncLocks.has(sheetId)
}

/**
 * Acquire a sync lock for a sheet
 * Returns a function to release the lock
 * 
 * @param {string} sheetId - Google Sheet ID
 * @returns {Promise<Function>} Release function
 * @throws {Error} If sync is already in progress
 */
export async function acquireSyncLock(sheetId) {
    if (syncLocks.has(sheetId)) {
        // Sync already in progress - reject immediately
        throw new Error(`Sync already in progress for sheet ${sheetId}`)
    }

    // Create a promise that will be resolved when lock is released
    let releaseLock
    const lockPromise = new Promise((resolve) => {
        releaseLock = resolve
    })

    // Store the lock
    syncLocks.set(sheetId, lockPromise)

    // Return release function
    return () => {
        syncLocks.delete(sheetId)
        releaseLock()
    }
}

/**
 * Wait for a sync to complete (if in progress)
 * 
 * @param {string} sheetId - Google Sheet ID
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns {Promise<void>} Resolves when sync completes or timeout
 */
export async function waitForSync(sheetId, timeoutMs = 30000) {
    const lockPromise = syncLocks.get(sheetId)
    if (!lockPromise) {
        return // No sync in progress
    }

    // Wait for lock to be released with timeout
    return Promise.race([
        lockPromise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Sync wait timeout')), timeoutMs)
        )
    ]).catch(() => {
        // Timeout or error - ignore (lock might be stale)
        syncLocks.delete(sheetId)
    })
}

/**
 * Execute a sync with locking
 * Prevents concurrent syncs for the same sheet
 * 
 * @param {string} sheetId - Google Sheet ID
 * @param {Function} syncFunction - Async function to execute
 * @returns {Promise<any>} Result of sync function
 */
export async function withSyncLock(sheetId, syncFunction) {
    let releaseLock

    try {
        // Acquire lock
        releaseLock = await acquireSyncLock(sheetId)

        // Execute sync function
        const result = await syncFunction()

        return result
    } catch (error) {
        if (error.message.includes('already in progress')) {
            // Sync already in progress - wait and retry once
            console.log(`⏳ Sync already in progress for ${sheetId}, waiting...`)
            await waitForSync(sheetId, 5000) // Wait up to 5 seconds
            console.log(`✅ Previous sync completed for ${sheetId}`)
            // Don't retry - let the caller handle it
            throw error
        }
        throw error
    } finally {
        // Always release lock
        if (releaseLock) {
            releaseLock()
        }
    }
}


