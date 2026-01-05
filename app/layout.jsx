import './globals.css'

export const metadata = {
    title: 'Google Sheet MySQL Sync',
    description: '2-way data sync between Google Sheets and MySQL',
}

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    )
}

