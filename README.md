# Google Sheet ↔ PostgreSQL Sync

A Next.js application for 2-way data synchronization between Google Sheets and PostgreSQL database.

## Features

- Connect Google Sheets via URL or Sheet ID
- Display synced data in an editable table
- Real-time cell editing with automatic sync to MySQL
- Connection status monitoring
- Clean, modern UI built with Tailwind CSS

## Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- PostgreSQL database (cloud or local) - See [Database Setup Guide](./docs/DATABASE_SETUP.md)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
# Create .env.local file with your database credentials
# For Neon: Use your connection string directly
# See docs/DATABASE_SETUP.md or docs/NEON_SETUP.md for detailed instructions
```

3. Configure your database connection in `.env.local`:
```env
# Option 1: Connection String (Recommended for Cloud)
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require

# Option 2: Individual Credentials
DB_HOST=your-database-host.com
DB_PORT=5432
DB_USER=your-database-user
DB_PASSWORD=your-database-password
DB_NAME=superjoin_db
DB_SSL=true

GOOGLE_API_KEY=your-google-api-key (optional)
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
superjoin-assignment/
├── app/
│   ├── layout.jsx          # Root layout
│   ├── page.jsx            # Main page
│   ├── api/                # API routes
│   │   ├── connect/        # Google Sheet connection
│   │   ├── data/           # Data CRUD operations
│   │   └── sync/           # Sync operations
│   └── globals.css         # Global styles
├── components/
│   ├── ConnectionForm.jsx  # Connection form
│   ├── ConnectionStatus.jsx # Status indicator
│   └── DataTable.jsx       # Editable data table
└── lib/
    └── utils.js            # Utility functions
```

## API Endpoints

### POST /api/connect
Connect to a Google Sheet
- Body: `{ sheetUrl: string }`
- Response: `{ success: boolean, sheetId: string, message: string }`

### GET /api/data
Fetch all synced data from PostgreSQL
- Response: `{ data: Row[], columns: string[] }`

### PUT /api/data
Update a cell value in PostgreSQL
- Body: `{ sheetId: string, rowId: number, column: string, value: any }`
- Response: `{ success: boolean }`

### POST /api/sync
Trigger sync operation
- Body: `{ direction: 'sheet-to-db' | 'db-to-sheet' }`
- Response: `{ success: boolean, rowsSynced: number }`

## Current Status

- ✅ Frontend UI components
- ✅ API route structure
- ✅ Google Sheets API integration
- ✅ PostgreSQL database connection
- ✅ Dynamic table schema management
- ✅ Sheet → Database sync (one-way)
- ✅ Data fetching from PostgreSQL
- ✅ Cell editing with PostgreSQL updates
- ⏳ Database → Sheet sync (two-way)
- ⏳ Real-time updates (polling/webhooks)
- ⏳ Conflict resolution

## Features

### Dynamic Schema Management
The application automatically creates and updates MySQL tables based on your Google Sheet structure. When your sheet columns change, the database schema adapts automatically.

### Data Flow
1. **Connect** to a Google Sheet via URL or Sheet ID
2. **Sync** data from Google Sheet to MySQL (creates/updates table structure)
3. **View** data from MySQL in the frontend table
4. **Edit** cells directly in the table (updates MySQL)
5. Future: Sync changes back to Google Sheet

## Database Setup

See [Database Setup Guide](./docs/DATABASE_SETUP.md) for detailed instructions on setting up a cloud MySQL database.

## Development

```bash
# Development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint
```

