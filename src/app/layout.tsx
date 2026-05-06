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
          colorText: "#ffffff",
          colorTextSecondary: "#cdd9f0",
          colorTextOnPrimaryBackground: "#000000",
          colorInputText: "#ffffff",
        },
        elements: {
          headerTitle: { color: "#ffffff" },
          headerSubtitle: { color: "#cdd9f0" },
          formFieldLabel: { color: "#cdd9f0" },
          dividerText: { color: "#cdd9f0" },
          footerActionText: { color: "#cdd9f0" },
          formButtonPrimary: {
            backgroundColor: "#22a8ff",
            color: "#000000",
            "&:hover": { backgroundColor: "#3fb8ff" },
          },
          userPreviewMainIdentifier: { color: "#ffffff" },
          userPreviewSecondaryIdentifier: { color: "#cdd9f0" },
          userButtonPopoverActionButton: { color: "#ffffff" },
          userButtonPopoverActionButtonText: { color: "#ffffff" },
          userButtonPopoverFooter: { color: "#cdd9f0" },
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
