"use client";

/**
 * Last resort: the root layout itself failed (a broken settings file, no database), so there is
 * no theme, no stylesheet and no translations to rely on. Plain markup, both languages.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0b0b14", color: "#e8e8f0", fontFamily: "system-ui, sans-serif" }}>
        <div role="alert" style={{ maxWidth: 360, padding: 28, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, opacity: 0.7, lineHeight: 1.5 }}>
            The dashboard couldn&apos;t start. The server log has the details.
            <br />
            Le tableau de bord n&apos;a pas pu démarrer. Le journal du serveur contient les détails.
          </p>
          <button type="button" onClick={reset} style={{ marginTop: 12, height: 40, padding: "0 20px", border: 0, borderRadius: 12, background: "#8b5cf6", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
            Try again · Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
