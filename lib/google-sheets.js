import { google } from 'googleapis'
import { getGoogleSheetsClient } from './google-auth'

/**
 * Fetch data from Google Sheets using CSV export (for public sheets, no auth required)
 * @param {string} sheetId - Google Sheet ID
 * @param {string} sheetName - Sheet name (default: first sheet)
 * @returns {Promise<{values: any[][], columns: string[], data: object[]}>}
 */
async function fetchSheetDataViaCSV(sheetId, sheetName = 'Sheet1') {
    try {
        // Try multiple CSV export URL formats
        // Format 1: Without gid (gets first sheet)
        let csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`

        let response = await fetch(csvUrl, {
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        })

        // If that fails, try with gid=0
        if (!response.ok && response.status === 400) {
            csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`
            response = await fetch(csvUrl, {
                redirect: 'follow',
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            })
        }

        // If still fails, try the tqx format
        if (!response.ok && response.status === 400) {
            csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`
            response = await fetch(csvUrl, {
                redirect: 'follow',
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            })
        }

        if (!response.ok) {
            if (response.status === 403) {
                throw new Error('Sheet is not publicly accessible. Please set sharing to "Anyone with the link can view"')
            } else if (response.status === 400) {
                throw new Error('Unable to export sheet as CSV. The sheet may need to be published or the format may not be supported.')
            }
            throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`)
        }

        const csvText = await response.text()

        if (!csvText || csvText.trim().length === 0) {
            return {
                values: [],
                columns: [],
                data: []
            }
        }

        // Parse CSV
        const lines = csvText.split('\n').filter(line => line.trim().length > 0)
        const values = lines.map(line => {
            // Simple CSV parsing (handles quoted fields)
            const result = []
            let current = ''
            let inQuotes = false

            for (let i = 0; i < line.length; i++) {
                const char = line[i]
                if (char === '"') {
                    inQuotes = !inQuotes
                } else if (char === ',' && !inQuotes) {
                    result.push(current.trim())
                    current = ''
                } else {
                    current += char
                }
            }
            result.push(current.trim())
            return result
        })

        if (values.length === 0) {
            return {
                values: [],
                columns: [],
                data: []
            }
        }

        // First row is headers
        const headers = values[0] || []

        // Convert rows to objects
        const data = values.slice(1).map((row, index) => {
            const rowObj = { id: index + 1 }
            headers.forEach((header, colIndex) => {
                rowObj[header] = row[colIndex] || ''
            })
            return rowObj
        })

        return {
            values: values,
            columns: headers.filter(h => h && h.trim() !== ''),
            data: data
        }
    } catch (error) {
        console.error('Error fetching via CSV:', error)
        throw error
    }
}

/**
 * Fetch data from Google Sheets using Google Sheets API
 * @param {string} sheetId - Google Sheet ID
 * @param {string} range - Sheet range (e.g., 'Sheet1!A1:Z100' or 'Sheet1')
 * @param {string} apiKey - Google API key (optional, recommended for public sheets)
 * @returns {Promise<{values: any[][], columns: string[], data: object[]}>} - Sheet data and column headers
 */
export async function fetchSheetData(sheetId, range = 'Sheet1', apiKey = null) {
    // Try API method first if API key is provided
    if (apiKey) {
        try {
            // Initialize Google Sheets API client
            const auth = google.auth.fromAPIKey(apiKey)
            const sheets = google.sheets({ version: 'v4', auth })

            // Fetch data from Google Sheets
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: range,
            })

            const values = response.data.values || []

            if (values.length === 0) {
                return {
                    values: [],
                    columns: [],
                    data: []
                }
            }

            // First row is headers
            const headers = values[0] || []

            // Convert rows to objects
            const data = values.slice(1).map((row, index) => {
                const rowObj = { id: index + 1 }
                headers.forEach((header, colIndex) => {
                    rowObj[header] = row[colIndex] || ''
                })
                return rowObj
            })

            return {
                values: values,
                columns: headers.filter(h => h && h.trim() !== ''),
                data: data
            }
        } catch (error) {
            console.error('API method failed, trying CSV fallback:', error.message)
            // Fall through to CSV method
        }
    }

    // Fallback to CSV export method (works for public sheets without API key)
    try {
        // Extract sheet name from range if provided (e.g., 'Sheet1!A1:Z100' -> 'Sheet1')
        const sheetName = range.includes('!') ? range.split('!')[0] : range
        return await fetchSheetDataViaCSV(sheetId, sheetName)
    } catch (error) {
        console.error('Error fetching Google Sheets data:', error)

        // Provide helpful error messages
        if (error.message?.includes('not publicly accessible')) {
            throw new Error(
                'Sheet is not publicly accessible. Please:\n' +
                '1. Open your Google Sheet\n' +
                '2. Click "Share" button\n' +
                '3. Set "General access" to "Anyone with the link" and "Viewer" permission\n' +
                '4. Click "Done"'
            )
        } else if (error.code === 404 || error.response?.status === 404) {
            throw new Error('Google Sheet not found. Please check the Sheet ID.')
        } else if (error.message) {
            throw new Error(`Failed to fetch sheet data: ${error.message}`)
        } else {
            throw new Error('Failed to fetch data from Google Sheets. Please check the Sheet ID and ensure the sheet is publicly accessible.')
        }
    }
}

/**
 * Get sheet metadata (sheet names, etc.)
 * @param {string} sheetId - Google Sheet ID
 * @param {string} apiKey - Google API key (optional)
 * @returns {Promise<{sheetNames: string[]}>}
 */
export async function getSheetMetadata(sheetId, apiKey = null) {
    try {
        let auth = null
        if (apiKey) {
            auth = google.auth.fromAPIKey(apiKey)
        }

        const sheets = google.sheets({ version: 'v4', auth })

        const response = await sheets.spreadsheets.get({
            spreadsheetId: sheetId,
        })

        const sheetNames = response.data.sheets?.map(sheet => sheet.properties.title) || []

        return {
            sheetNames: sheetNames
        }
    } catch (error) {
        console.error('Error fetching sheet metadata:', error)
        throw new Error('Failed to fetch sheet metadata')
    }
}

/**
 * Append a row to Google Sheets
 * @param {string} sheetId - Google Sheet ID
 * @param {string[]} values - Array of values for the row (must match column order)
 * @param {string} range - Sheet range (default: 'Sheet1')
 * @returns {Promise<{success: boolean, updatedRange: string}>}
 */
export async function appendRowToSheet(sheetId, values, range = 'Sheet1', userEmail = null) {
    try {
        // Get authenticated client (User OAuth2, Service Account, or API Key)
        const sheets = await getGoogleSheetsClient(userEmail)

        // Append the row to the sheet
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: range,
            valueInputOption: 'USER_ENTERED', // This allows formulas and formatting
            insertDataOption: 'INSERT_ROWS', // Insert a new row
            requestBody: {
                values: [values] // Wrap in array as it expects 2D array
            }
        })

        return {
            success: true,
            updatedRange: response.data.updates?.updatedRange || '',
            updatedRows: response.data.updates?.updatedRows || 0
        }
    } catch (error) {
        console.error('Error appending row to Google Sheets:', error)

        // Provide helpful error messages
        if (error.code === 401 || error.message?.includes('API keys are not supported')) {
            throw new Error(
                'Write operations require OAuth2 or Service Account authentication. ' +
                'API keys only work for read operations. ' +
                'Please set up GOOGLE_SERVICE_ACCOUNT_KEY or OAuth2 credentials. ' +
                'See: https://cloud.google.com/docs/authentication'
            )
        } else if (error.code === 403) {
            throw new Error(
                'Permission denied. Please ensure:\n' +
                '1. Your Service Account email has been shared with the Google Sheet\n' +
                '2. The Service Account has "Editor" or "Viewer" permission\n' +
                '3. The sheet is accessible to the authenticated account'
            )
        } else if (error.code === 404) {
            throw new Error('Google Sheet not found. Please check the Sheet ID.')
        } else {
            throw new Error(`Failed to append row to Google Sheets: ${error.message || 'Unknown error'}`)
        }
    }
}

/**
 * Convert column index (0-based) to Google Sheets column letter (A, B, C, ..., Z, AA, AB, etc.)
 * @param {number} index - Column index (0-based)
 * @returns {string} Column letter (A, B, C, etc.)
 */
function indexToColumnLetter(index) {
    let result = ''
    index = index + 1 // Convert to 1-based
    while (index > 0) {
        index--
        result = String.fromCharCode(65 + (index % 26)) + result
        index = Math.floor(index / 26)
    }
    return result
}

/**
 * Update a specific cell in Google Sheets
 * @param {string} sheetId - Google Sheet ID
 * @param {number} rowPosition - Row position (0-based index in ordered list)
 * @param {string} columnName - Column name (original name from sheet)
 * @param {any} value - Value to set
 * @param {string[]} columns - Array of column names (to find column index)
 * @param {string} range - Sheet range (default: 'Sheet1')
 * @param {string} userEmail - User email for OAuth2 (optional)
 * @returns {Promise<{success: boolean, updatedRange: string}>}
 */
export async function updateCellInSheet(sheetId, rowPosition, columnName, value, columns, range = 'Sheet1', userEmail = null) {
    try {
        // Find column index
        const columnIndex = columns.indexOf(columnName)
        if (columnIndex === -1) {
            throw new Error(`Column "${columnName}" not found in sheet columns`)
        }

        // Convert column index to letter (A, B, C, etc.)
        const columnLetter = indexToColumnLetter(columnIndex)

        // Calculate Google Sheets row number
        // rowPosition is 0-based (0 = first data row)
        // Google Sheets: row 1 = headers, row 2 = first data row
        // So: rowPosition 0 -> row 2, rowPosition 1 -> row 3, etc.
        const sheetRowNumber = rowPosition + 2

        // Format range as "Sheet1!A2"
        const cellRange = `${range}!${columnLetter}${sheetRowNumber}`

        // Get authenticated client (User OAuth2, Service Account, or API Key)
        const sheets = await getGoogleSheetsClient(userEmail)

        // Update the cell in the sheet
        const response = await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: cellRange,
            valueInputOption: 'USER_ENTERED', // This allows formulas and formatting
            requestBody: {
                values: [[value]] // Wrap in 2D array as API expects
            }
        })

        return {
            success: true,
            updatedRange: response.data.updatedRange || cellRange,
            updatedCells: response.data.updatedCells || 1
        }
    } catch (error) {
        console.error('Error updating cell in Google Sheets:', error)

        // Provide helpful error messages
        if (error.code === 401 || error.message?.includes('API keys are not supported')) {
            throw new Error(
                'Write operations require OAuth2 or Service Account authentication. ' +
                'API keys only work for read operations. ' +
                'Please set up GOOGLE_SERVICE_ACCOUNT_KEY or OAuth2 credentials. ' +
                'See: https://cloud.google.com/docs/authentication'
            )
        } else if (error.code === 403) {
            throw new Error(
                'Permission denied. Please ensure:\n' +
                '1. Your Service Account email has been shared with the Google Sheet\n' +
                '2. The Service Account has "Editor" or "Viewer" permission\n' +
                '3. The sheet is accessible to the authenticated account'
            )
        } else if (error.code === 404) {
            throw new Error('Google Sheet not found. Please check the Sheet ID.')
        } else {
            throw new Error(`Failed to update cell in Google Sheets: ${error.message || 'Unknown error'}`)
        }
    }
}

