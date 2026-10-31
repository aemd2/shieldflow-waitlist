import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public/PublicPage";
import { AWS_CHECKS } from "@/lib/aws/catalog";
import { DENIED_DATA_ACTIONS, EXTRA_READ_ACTIONS, TEMPLATE_VERSION } from "@/lib/aws/role";
import type { CheckArea } from "@/lib/aws/types";

export const metadata: Metadata = {
  title: "AWS checks — what ShieldFlow reads, and what it never reads",
  description:
    "Every read-only AWS check ShieldFlow runs, the exact API calls behind it, and the calls its role is explicitly denied.",
};

const AREA_TITLE: Record<CheckArea, string> = {
  identity: "Identity & access",
  exposure: "Internet exposure",
  logging: "Audit logging",
  detection: "Threat detection",
  encryption: "Encryption at rest",
  patching: "Patching & support",
  vulnerabilities: "Vulnerabilities",
  backups: "Backups",
  residency: "Data residency (only if you've committed to a region)",
  changes: "Manual changes (never gates anything)",
  hygiene: "Good to know (never gates anything)",
};

/**
 * Public and static: generated from the same definitions the scanner runs, so it
 * can't drift from the product. Meant to be sent to a CTO before anyone connects
 * an account.
 */
export default function AwsChecksPage() {
  const areas = [...new Set(AWS_CHECKS.map((c) => c.area))];
  return (
    <PublicPage
      eyebrow={<><Link href="/checks" className="hover:underline">What we check</Link> · AWS</>}
      title="What we check in AWS — and what we never read"
      lede={
        <>
          ShieldFlow connects through a read-only role in your account: AWS&rsquo;s own <code>SecurityAudit</code> policy,
          a short list of newer read calls, and an explicit <strong>deny</strong> on every call that would read your data.
          In IAM a deny always wins, so even if AWS widens SecurityAudit one day, we still can&rsquo;t read an object, a
          row, a secret or a log line. No keys change hands; each scan is a 15-minute session you can see in your own
          CloudTrail as <code>ShieldFlow-…</code>.
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Role template v{TEMPLATE_VERSION}: <Link className="underline" href="/api/aws/role-template">CloudFormation YAML</Link>.
      </p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">How results work</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Only regions you actually use are scanned — no nagging about GuardDuty in a region you&rsquo;ve never touched.</li>
          <li>Every failure names the exact resource and gives the fix in Terraform, the AWS CLI and the console.</li>
          <li>If we can&rsquo;t read something — a missing permission, a region we ran out of time for — the check says &ldquo;can&rsquo;t tell&rdquo; and why. It never passes by default.</li>
          <li>Dev and staging accounts can be connected out of scope: shown, never alerted. Single resources can be marked out of scope with a reason, which is kept as audit evidence.</li>
        </ul>
      </section>

      {areas.map((area) => (
        <section key={area} className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">{AREA_TITLE[area]}</h2>
          <ul className="space-y-3">
            {AWS_CHECKS.filter((c) => c.area === area).map((c) => (
              <li key={c.key} className="rounded-lg border border-border p-4">
                <div className="font-medium">{c.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{c.why}</p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">{c.apiCalls.join(" · ")}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Read calls added on top of SecurityAudit</h2>
        <p className="font-mono text-xs text-muted-foreground">{EXTRA_READ_ACTIONS.join(" · ")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Explicitly denied — we never read your data</h2>
        <p className="font-mono text-xs text-muted-foreground">{DENIED_DATA_ACTIONS.join(" · ")}</p>
        <p className="text-sm text-muted-foreground">
          Lambda environment variables come back in the function list AWS returns; ShieldFlow drops them on arrival and never stores them.
        </p>
      </section>

      <p className="text-sm text-muted-foreground">
        <Link className="underline" href="/demo">See the product</Link> · <Link className="underline" href="/signup">Start free</Link>
      </p>
    </PublicPage>
  );
}
