import type { Metadata } from "next";
import { DemoTour } from "@/components/marketing/DemoTour";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://shieldflow.cloud"),
  title: "See how ShieldFlow works · ShieldFlow",
  description:
    "A two-minute walk through ShieldFlow on a sample company: do the work once and get credit across SOC 2, ISO 27001, NIS2 and five more — no signup needed.",
  openGraph: {
    title: "See how ShieldFlow works in two minutes",
    description:
      "Tick one measure, watch 13 requirements across 8 frameworks light up. No signup, no AWS keys.",
    type: "website",
  },
};

/**
 * Public, static, and deliberately free of any server call — so it can be pasted
 * into a LinkedIn message and opened by someone who has never heard of us, served
 * from a CDN edge near them. The trial links sent so far asked people to sign up
 * before they had seen anything; this shows the product first.
 */
export default function DemoPage() {
  return <DemoTour />;
}
