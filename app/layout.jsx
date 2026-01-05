import './globals.css'

// Generate metadata with dynamic values
export async function generateMetadata() {
    const googleSiteVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION

    return {
        title: 'Google Sheet ↔ PostgreSQL Sync',
        description: 'Connect your Google Sheet and sync data bidirectionally with PostgreSQL',
        other: googleSiteVerification
            ? {
                'google-site-verification': googleSiteVerification,
            }
            : {},
    }
}

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    )
}

