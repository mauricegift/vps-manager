export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-[var(--muted)] text-sm mb-10">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

      <div className="space-y-8 text-sm leading-relaxed text-[var(--muted)]">
        {[
          {
            title: "1. Acceptance of Terms",
            body: "By accessing or using VPS Manager, you agree to be bound by these Terms of Service. If you do not agree to all of these terms, you may not use the software."
          },
          {
            title: "2. Description of Service",
            body: "VPS Manager is a self-hosted, open-source web control panel for Linux servers. You are responsible for deploying and hosting the software on your own infrastructure. We do not provide hosting for your instance."
          },
          {
            title: "3. User Responsibilities",
            body: "You are solely responsible for all activity that occurs under your account. You must not use VPS Manager to violate any applicable laws or regulations, or to interfere with or disrupt the integrity or performance of any system. You are responsible for maintaining the security of your credentials and your server."
          },
          {
            title: "4. Intellectual Property",
            body: "VPS Manager is released under the MIT License. You are free to use, copy, modify, merge, publish, distribute, sublicense or sell copies of the software in accordance with the license terms."
          },
          {
            title: "5. Disclaimer of Warranties",
            body: 'VPS Manager is provided "as is" and "as available" without warranties of any kind, either express or implied. We do not warrant that the software will be error-free, uninterrupted or free of harmful components.'
          },
          {
            title: "6. Limitation of Liability",
            body: "To the fullest extent permitted by law, Gifted Tech and contributors shall not be liable for any indirect, incidental, special, consequential or punitive damages arising from your use of VPS Manager."
          },
          {
            title: "7. Changes to Terms",
            body: "We reserve the right to update these Terms at any time. Continued use of VPS Manager after changes are posted constitutes acceptance of the revised Terms."
          },
          {
            title: "8. Contact",
            body: "If you have questions about these Terms, please contact us via our website at me.giftedtech.co.ke."
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
