import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html>
      <body>
        <div style={{ maxWidth: 900, margin: "40px auto", padding: 20 }}>
          <header style={{ marginBottom: 30 }}>
            <h1 style={{ margin: 0 }}>SME GPT</h1>
            <p style={{ margin: 0, color: "#6b7280" }}>
              Invoice Intelligence MVP
            </p>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
