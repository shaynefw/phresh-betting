import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phresh Mastery — Betting System",
  description: "Premium sports betting performance command center.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen relative">
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
