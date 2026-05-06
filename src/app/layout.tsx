import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
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
    <ClerkProvider
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: "#22a8ff",
          colorBackground: "#0a0f1a",
          colorInputBackground: "#0d1422",
          colorText: "#e6efff",
        },
      }}
    >
      <html lang="en" className="dark">
        <body className="min-h-screen relative">
          <div className="relative z-10">{children}</div>
        </body>
      </html>
    </ClerkProvider>
  );
}
