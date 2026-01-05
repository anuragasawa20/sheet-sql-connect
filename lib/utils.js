/**
 * Extract Google Sheet ID from URL
 * Handles various Google Sheet URL formats:
 * - Full URL: https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
 * - Sharing link: https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit?usp=sharing
 * - Direct Sheet ID: {SHEET_ID}
 * @param {string} url - Google Sheet URL or Sheet ID
 * @returns {string|null} - Sheet ID or null if invalid
 */
export function extractSheetId(url) {
    if (!url) return null;

    // Handle direct sheet ID (no http/https, short string)
    if (url.length < 50 && !url.includes('http')) {
        return url;
    }

    // Extract from URL pattern - works with /edit, /edit?usp=sharing, or any other suffix
    // Pattern: /spreadsheets/d/{SHEET_ID}/...
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

/**
 * Validate Google Sheet URL or ID
 * @param {string} input - Google Sheet URL or ID
 * @returns {boolean} - True if valid
 */
export function validateSheetInput(input) {
    if (!input || input.trim().length === 0) {
        return false;
    }

    const sheetId = extractSheetId(input);
    return sheetId !== null && sheetId.length > 0;
}

/**
 * Format error message for display
 * @param {Error|string} error - Error object or message
 * @returns {string} - Formatted error message
 */
export function formatError(error) {
    if (typeof error === 'string') {
        return error;
    }
    return error?.message || 'An unexpected error occurred';
}

