export default function TermsOfService() {
    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto bg-white shadow-md rounded-lg p-8">
                <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>

                <p className="text-gray-600 mb-4">Last updated: {new Date().toLocaleDateString()}</p>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">1. Acceptance of Terms</h2>
                    <p className="text-gray-700 mb-4">
                        By accessing and using this application, you accept and agree to be bound by the
                        terms and provision of this agreement.
                    </p>
                </section>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">2. Description of Service</h2>
                    <p className="text-gray-700 mb-4">
                        This application provides a service to synchronize data between Google Sheets and
                        a PostgreSQL database. The service allows you to:
                    </p>
                    <ul className="list-disc list-inside text-gray-700 ml-4 mb-4">
                        <li>Connect Google Sheets to your database</li>
                        <li>Synchronize data bidirectionally</li>
                        <li>Edit data in the application interface</li>
                    </ul>
                </section>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">3. User Responsibilities</h2>
                    <p className="text-gray-700 mb-4">
                        You are responsible for:
                    </p>
                    <ul className="list-disc list-inside text-gray-700 ml-4 mb-4">
                        <li>Maintaining the security of your Google account credentials</li>
                        <li>Ensuring you have proper permissions to access Google Sheets you connect</li>
                        <li>Backing up your data regularly</li>
                        <li>Complying with Google's Terms of Service</li>
                    </ul>
                </section>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">4. Google API Services</h2>
                    <p className="text-gray-700 mb-4">
                        This application uses Google APIs. By using this service, you agree to comply
                        with the{' '}
                        <a
                            href="https://developers.google.com/terms"
                            className="text-blue-600 hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Google API Services User Data Policy
                        </a>.
                    </p>
                </section>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">5. Limitation of Liability</h2>
                    <p className="text-gray-700 mb-4">
                        The service is provided "as is" without warranties of any kind. We are not
                        responsible for any data loss, corruption, or unauthorized access to your
                        Google Sheets or database.
                    </p>
                </section>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">6. Changes to Terms</h2>
                    <p className="text-gray-700 mb-4">
                        We reserve the right to modify these terms at any time. Your continued use of
                        the service after changes constitutes acceptance of the new terms.
                    </p>
                </section>

                <section className="mb-6">
                    <h2 className="text-2xl font-semibold mb-3">7. Contact Information</h2>
                    <p className="text-gray-700">
                        For questions about these Terms of Service, please contact:{' '}
                        <a href="mailto:maheshwarianiket@gmail.com" className="text-blue-600 hover:underline">
                            maheshwarianiket@gmail.com
                        </a>
                    </p>
                </section>
            </div>
        </div>
    )
}

