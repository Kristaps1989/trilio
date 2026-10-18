"use client";

// Last-resort screen when the root layout itself fails, so no i18n provider
// or stylesheet can be assumed: plain Latvian copy with inline brand styles.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="lv">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0F2A2E",
          color: "#F2F5F2",
          fontFamily: "system-ui, sans-serif",
          padding: "24px",
          boxSizing: "border-box",
        }}
      >
        <main style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ margin: 0, color: "#D8F45A", fontWeight: 700, fontSize: 14, letterSpacing: "0.04em" }}>
            TRILIO · KĻŪDA
          </p>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.1 }}>Lapu neizdevās ielādēt</h1>
          <p style={{ margin: 0, color: "#A9BDB9", fontSize: 18, lineHeight: 1.5 }}>
            Tā ir mūsu kļūda, nevis tava. Pamēģini vēlreiz pēc brīža.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: 52,
                padding: "0 24px",
                border: "none",
                borderRadius: 12,
                background: "#D8F45A",
                color: "#0F2A2E",
                fontSize: 17,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Mēģināt vēlreiz
            </button>
            {/* A full page load, not client navigation: the app shell is what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                minHeight: 52,
                padding: "0 22px",
                display: "inline-flex",
                alignItems: "center",
                border: "1.5px solid rgba(242,245,242,0.4)",
                borderRadius: 12,
                color: "#F2F5F2",
                textDecoration: "none",
                fontSize: 17,
                fontWeight: 600,
              }}
            >
              Uz sākumu
            </a>
          </div>
          {error.digest ? (
            <p style={{ margin: 0, color: "#A9BDB9", fontSize: 14 }}>Kļūdas kods: {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
