import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://shieldflow.com"),
  title: "ShieldFlow — AI-native GRC & compliance automation",
  description:
    "Get SOC 2, ISO 27001, HIPAA, GDPR & PCI DSS ready with automated evidence collection, continuous control monitoring, and an AI Co-Pilot — for up to 80% less than Vanta.",
  openGraph: {
    title: "ShieldFlow — AI-native GRC & compliance automation",
    description:
      "Automated evidence, continuous monitoring, and an AI Co-Pilot across SOC 2, ISO 27001, HIPAA, GDPR & PCI DSS — for a fraction of incumbent pricing.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
