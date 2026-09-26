import type { Metadata } from "next";
import { Landing } from "@/components/marketing/Landing";

export const metadata: Metadata = {
  // Falls back to the domain we actually own. NEXT_PUBLIC_SITE_URL isn't set in
  // Vercel, so the old fallback pointed link previews at shieldflow.com — a
  // domain that isn't ours, on the one page that gets pasted into LinkedIn.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://shieldflow.cloud"),
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

/**
 * The public marketing page, and nothing else.
 *
 * It used to check whether you were signed in and redirect you into the product.
 * That one call made the whole page render per-request, so it could never be
 * cached — every visitor waited for a round trip to the database in Ireland
 * before seeing a page that is identical for everyone. From the US that is the
 * slowest thing about the site, and it is the first thing a prospect touches.
 *
 * The signed-in redirect now happens in proxy.ts, which already knows whether a
 * session cookie is present. Behaviour is unchanged; the page is static.
 */
export default function RootPage() {
  return <Landing />;
}
