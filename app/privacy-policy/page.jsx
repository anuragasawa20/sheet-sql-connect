export default function PrivacyPolicy() {
    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto bg-white shadow-md rounded-lg p-8">
                <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>

                <p className="text-gray-600 mb-4">Last updated: {new Date().toLocaleDateString()}</p>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">1. Information We Collect</h2>
                    <p className="text-gray-700 mb-2">
                        Our application integrates with Google Sheets and Google Drive to synchronize data.
                        We collect and store:
                    </p>
                    <ul className="list-disc list-inside text-gray-700 ml-4 mb-4">
                        <li>Google account email address (for authentication)</li>
                        <li>OAuth access tokens (stored securely in your database)</li>
                        <li>Data from Google Sheets that you choose to sync</li>
                    </ul>
                </section>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">2. How We Use Your Information</h2>
                    <p className="text-gray-700 mb-2">
                        We use the information we collect to:
                    </p>
                    <ul className="list-disc list-inside text-gray-700 ml-4 mb-4">
                        <li>Authenticate you with Google services</li>
                        <li>Synchronize data between Google Sheets and your database</li>
                        <li>Provide the core functionality of the application</li>
                    </ul>
                </section>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">3. Data Storage</h2>
                    <p className="text-gray-700 mb-4">
                        Your data is stored in your own PostgreSQL database. We do not store your data
                        on our servers. OAuth tokens are stored securely in your database and are only
                        used to access Google Sheets on your behalf.
                    </p>
                </section>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">4. Google API Usage</h2>
                    <p className="text-gray-700 mb-4">
                        Our use of information received from Google APIs adheres to the{' '}
                        <a
                            href="https://developers.google.com/terms/api-services-user-data-policy"
                            className="text-blue-600 hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Google API Services User Data Policy
                        </a>, including the Limited Use requirements.
                    </p>
                </section>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">5. Your Rights</h2>
                    <p className="text-gray-700 mb-4">
                        You have the right to:
                    </p>
                    <ul className="list-disc list-inside text-gray-700 ml-4 mb-4">
                        <li>Revoke Google OAuth access at any time through your Google account settings</li>
                        <li>Delete your data from the database</li>
                        <li>Disconnect your Google account from the application</li>
                    </ul>
                </section>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">6. Contact Us</h2>
                    <p className="text-gray-700">
                        If you have questions about this Privacy Policy, please contact us at:{' '}
                        <a href="mailto:maheshwarianiket@example.com" className="text-blue-600 hover:underline">
                            maheshwarianiket@gmail.com
                        </a>
                    </p>
                </section>
            </div>
        </div>
    )
}

