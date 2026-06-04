import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShieldFlow — AI-powered GRC that's simple and affordable",
  description:
    "AI-first SOC 2, ISO 27001, GDPR & HIPAA automation for 11–200 person teams. 40–60% cheaper than Vanta and Drata. Onboard in days, not weeks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
