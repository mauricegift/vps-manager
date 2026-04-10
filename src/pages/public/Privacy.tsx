export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-[var(--muted)] text-sm mb-10">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

      <div className="space-y-8 text-sm leading-relaxed text-[var(--muted)]">
        {[
          {
            title: "1. Overview",
            body: "VPS Manager is a self-hosted application. All data you enter — including credentials, server details and file contents — is stored on your own server and never sent to third parties by the VPS Manager software itself."
          },
          {
            title: "2. Data We Collect",
            body: "VPS Manager stores user accounts (username, email, hashed password) and VPS connection details in a PostgreSQL database on your server. Passwords are hashed with bcrypt and are never stored in plain text. SSH credentials for remote servers are stored encrypted in your local database only."
          },
          {
            title: "3. Authentication Tokens",
            body: "We use JSON Web Tokens (JWT) for authentication. Access tokens expire after 24 hours. Refresh tokens expire after 7 days and are stored in your browser's localStorage and in the server database. Logging out immediately invalidates your refresh token."
          },
          {
            title: "4. Cookies & Local Storage",
            body: "VPS Manager uses browser localStorage to store your JWT access and refresh tokens, your active theme preference, and the currently selected remote server. No third-party cookies or tracking scripts are used."
          },
          {
            title: "5. Data Sharing",
            body: "VPS Manager does not share your data with any third party. All communication stays between your browser and your self-hosted server. Optional features (e.g. Let's Encrypt SSL) may contact external services at your explicit request."
          },
          {
            title: "6. Security",
            body: "We implement standard security best practices including password hashing, JWT signing, CORS restrictions and HTTPS support via Let's Encrypt. You are responsible for securing your server and keeping the software up to date."
          },
          {
            title: "7. Your Rights",
            body: "Since VPS Manager is self-hosted, you have full control over your data. You can delete your account and all associated data directly from your server's database at any time."
          },
          {
            title: "8. Contact",
            body: "If you have questions about this Privacy Policy, contact us via me.giftedtech.co.ke."
          },
        ].map(({ title, body }) => (
          <section key={title}>
            <h2 className="text-base font-semibold text-[var(--main)] mb-2">{title}</h2>
            <p>{body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
