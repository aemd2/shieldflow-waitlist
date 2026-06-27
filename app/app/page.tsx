import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyForUser } from "@/lib/db/queries";
import { Landing } from "@/components/marketing/Landing";

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

export default async function RootPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // Signed in → straight into the product. This route is the post-login hub:
  // AuthForm and /api/auth/confirm both default their `next` to "/".
  if (user) {
    const company = await getCompanyForUser(supabase, user.id);
    if (!company) redirect("/onboarding");
    redirect("/dashboard");
  }

  // Signed out → the public marketing site is the face.
  return <Landing />;
}
