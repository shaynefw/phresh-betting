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
          // v7 names
          colorPrimary: "#22a8ff",
          colorPrimaryForeground: "#000000",
          colorBackground: "#0a0f1a",
          colorForeground: "#ffffff",
          colorMuted: "#1a2540",
          colorMutedForeground: "#d4def0",
          colorInput: "#0d1422",
          colorInputForeground: "#ffffff",
          colorBorder: "#243456",
          colorNeutral: "#ffffff",
          // legacy names (still respected by some components)
          colorText: "#ffffff",
          colorTextSecondary: "#d4def0",
          colorInputBackground: "#0d1422",
          colorInputText: "#ffffff",
          colorTextOnPrimaryBackground: "#000000",
        },
        elements: {
          card: { backgroundColor: "#0a0f1a", borderColor: "#243456" },
          headerTitle: { color: "#ffffff", fontSize: "1.25rem" },
          headerSubtitle: { color: "#d4def0" },
          socialButtonsBlockButton: {
            backgroundColor: "#0d1422",
            borderColor: "#243456",
            color: "#ffffff",
            "&:hover": { backgroundColor: "#111a2e" },
          },
          socialButtonsBlockButtonText: { color: "#ffffff" },
          socialButtonsProviderIcon: { filter: "none" },
          dividerLine: { backgroundColor: "#243456" },
          dividerText: { color: "#d4def0" },
          formFieldLabel: { color: "#ffffff" },
          formFieldHintText: { color: "#d4def0" },
          formFieldInput: {
            backgroundColor: "#0d1422",
            color: "#ffffff",
            borderColor: "#243456",
          },
          otpCodeFieldInput: {
            backgroundColor: "#0d1422",
            color: "#ffffff",
            borderColor: "#243456",
          },
          formButtonPrimary: {
            backgroundColor: "#22a8ff",
            color: "#000000",
            "&:hover": { backgroundColor: "#3fb8ff" },
          },
          footerActionText: { color: "#d4def0" },
          footerActionLink: { color: "#22a8ff" },
          identityPreviewText: { color: "#ffffff" },
          identityPreviewEditButton: { color: "#22a8ff" },
          formResendCodeLink: { color: "#22a8ff" },
          alertText: { color: "#ffffff" },
          // user button popover
          userPreviewMainIdentifier: { color: "#ffffff" },
          userPreviewSecondaryIdentifier: { color: "#d4def0" },
          userButtonPopoverActionButton: { color: "#ffffff" },
          userButtonPopoverActionButtonText: { color: "#ffffff" },
          userButtonPopoverActionButtonIcon: { color: "#ffffff" },
          userButtonPopoverFooter: { color: "#d4def0" },
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
