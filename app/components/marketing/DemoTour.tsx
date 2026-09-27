"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CircleHelp, Mail, RotateCcw, X } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

/*
 * A guided walk through the product for people who haven't signed up.
 *
 * Nothing here talks to a server — it's a simulation, so it can sit on a public
 * page with no risk. But it is a faithful one:
 *
 *  - MFA_REQUIREMENTS is the live measure crosswalk for the `mfa` measure, read
 *    from the database. If that crosswalk changes, regenerate this list rather
 *    than editing it by hand.
 *  - The check messages are the exact strings lib/checks.ts and
 *    lib/identity-checks.ts produce, with sample numbers filled in.
 *  - The email is the real template from lib/notify.ts.
 *
 * Only the company, the people and the numbers are made up. That line matters:
 * this product's whole pitch is not claiming things it can't back, so the demo
 * has to be held to the same rule.
 */

const MFA_REQUIREMENTS: { framework: string; code: string; title: string }[] = [
  { framework: "SOC 2", code: "CC6.1", title: "Logical Access" },
  { framework: "SOC 2", code: "CC6.8", title: "Malicious Software" },
  { framework: "ISO 27001", code: "A.5.17", title: "Authentication Information" },
  { framework: "ISO 27001", code: "A.8.5", title: "Secure Authentication" },
  { framework: "NIS2", code: "Art.21.2(j)", title: "Multi-Factor Authentication" },
  { framework: "DORA", code: "Art.9.2", title: "Access and Cryptography" },
  { framework: "Cyber Resilience Act", code: "I.1.4", title: "Protection from Unauthorised Access" },
  { framework: "HIPAA", code: "164.312(d)", title: "Person or Entity Authentication" },
  { framework: "HIPAA", code: "164.308(a)(5)(ii)(D)", title: "Password Management" },
  { framework: "PCI DSS", code: "Req 8", title: "Identify & Authenticate" },
  { framework: "PCI DSS", code: "8.4", title: "MFA for CDE Access" },
  { framework: "PCI DSS", code: "8.5", title: "MFA Configured Against Misuse" },
  { framework: "GDPR", code: "Art. 32", title: "Security of Processing" },
];

const FRAMEWORKS = Array.from(new Set(MFA_REQUIREMENTS.map((r) => r.framework)));

type Verdict = "pass" | "fail" | "inconclusive";

const CHECKS: { name: string; source: string; verdict: Verdict; detail: string }[] = [
  {
    name: "2-Step Verification",
    source: "Google Workspace",
    verdict: "pass",
    detail: "33/34 users have 2-step verification (97%).",
  },
  {
    name: "Leavers who still have access",
    source: "Google Workspace + Personnel",
    verdict: "fail",
    detail:
      "1 person(s) left more than 7 days ago but their account is still open: Priya Nair (left 2026-08-19). Deprovision or suspend them at the identity provider.",
  },
  {
    name: "Access reviewed in the last 90 days",
    source: "ShieldFlow — needs no integration",
    verdict: "inconclusive",
    detail:
      "No access review has been completed yet, so the cadence can't be evidenced. Run one to prove access is reviewed periodically.",
  },
];

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function DemoTour() {
  return (
    <div className="marketing-dark min-h-screen bg-background text-foreground antialiased">
      <DemoNav />
      <main className="mx-auto max-w-4xl px-5 pb-24 sm:px-6">
        <Intro />
        <div className="mt-14 flex flex-col gap-16 sm:gap-20">
          <SceneOnce />
          <SceneChecks />
          <SceneEmail />
        </div>
        <Close />
      </main>
    </div>
  );
}

function DemoNav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark className="h-8 w-8" />
          <span className="text-lg font-black tracking-tight">ShieldFlow</span>
        </Link>
        <Link
          href="/signup"
          className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:brightness-110"
        >
          Start free →
        </Link>
      </div>
    </nav>
  );
}

function Intro() {
  return (
    <header className="pt-14 sm:pt-20">
      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Sample company · no signup
      </div>
      <h1 className="mt-6 max-w-3xl text-balance text-4xl font-black leading-[1.05] tracking-tighter sm:text-6xl">
        See how ShieldFlow works in <span className="text-primary">two minutes</span>.
      </h1>
      <p className="mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
        You&rsquo;re Sam, Head of Platform at <b className="text-foreground">Northwind Analytics</b>,
        38 people. A prospect in Chicago wants SOC 2. A customer in Munich sent a supplier
        questionnaire full of NIS2. Nobody at Northwind does compliance for a living.
      </p>
    </header>
  );
}

function SceneLabel({ n, title, lede }: { n: number; title: string; lede: string }) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      <span className="text-xs font-bold uppercase tracking-widest text-primary">Step {n} of 3</span>
      <h2 className="text-balance text-2xl font-black tracking-tight sm:text-3xl">{title}</h2>
      <p className="max-w-2xl text-pretty text-muted-foreground">{lede}</p>
    </div>
  );
}

/* ---------- Step 1: do the work once ---------- */

function SceneOnce() {
  const [done, setDone] = useState(false);
  const [lit, setLit] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function markDone() {
    setDone(true);
    if (prefersReducedMotion()) {
      setLit(MFA_REQUIREMENTS.length);
      return;
    }
    MFA_REQUIREMENTS.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setLit(i + 1), 120 + i * 70));
    });
  }

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setDone(false);
    setLit(0);
  }

  const litCodes = new Set(MFA_REQUIREMENTS.slice(0, lit).map((r) => `${r.framework}|${r.code}`));
  const allLit = lit === MFA_REQUIREMENTS.length;

  return (
    <section aria-labelledby="scene-once">
      <SceneLabel
        n={1}
        title="Do the work once. Get credit everywhere."
        lede="Eight frameworks ask for 328 things between them, and most of them are the same thing asked differently. ShieldFlow maps them onto 71 measures — the work you actually do."
      />

      <div className="rounded-xl border border-border bg-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Measure · Identity
            </div>
            <h3 id="scene-once" className="mt-1 text-xl font-bold">
              Require multi-factor authentication
            </h3>
          </div>
          <span
            className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-bold ${
              done
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-secondary text-muted-foreground"
            }`}
          >
            {done ? "Done" : "Not started"}
          </span>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Satisfies {MFA_REQUIREMENTS.length} requirements across {FRAMEWORKS.length} frameworks:
        </p>

        <div className="mt-5 flex flex-col divide-y divide-border">
          {FRAMEWORKS.map((fw) => (
            <div key={fw} className="grid gap-2 py-3 sm:grid-cols-[11rem_1fr] sm:items-center">
              <div className="text-sm font-semibold">{fw}</div>
              <div className="flex flex-wrap gap-2">
                {MFA_REQUIREMENTS.filter((r) => r.framework === fw).map((r) => {
                  const on = litCodes.has(`${r.framework}|${r.code}`);
                  return (
                    <span
                      key={r.code}
                      title={r.title}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs tabular-nums transition-colors duration-300 ${
                        on
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-border bg-background text-muted-foreground"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
                      {r.code}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          {!done ? (
            <button
              type="button"
              onClick={markDone}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
              Mark as done
            </button>
          ) : (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Play again
            </button>
          )}
          <p aria-live="polite" className="text-sm">
            {allLit ? (
              <span className="font-bold text-foreground">
                One piece of work. {MFA_REQUIREMENTS.length} requirements. {FRAMEWORKS.length}{" "}
                frameworks.
              </span>
            ) : done ? (
              <span className="text-muted-foreground">Crediting every framework…</span>
            ) : (
              <span className="text-muted-foreground">Try it — it&rsquo;s the whole idea.</span>
            )}
          </p>
        </div>
      </div>

      <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
        A requirement that needs several measures moves to <i>in progress</i> and stays there until
        the rest are done — one measure never marks something complete on its own.
      </p>
    </section>
  );
}

/* ---------- Step 2: checks, including the ones that refuse to pass ---------- */

function VerdictChip({ verdict }: { verdict: Verdict }) {
  const style = {
    pass: "border-primary/40 bg-primary/10 text-primary",
    fail: "border-destructive/40 bg-destructive/10 text-destructive",
    inconclusive: "border-border bg-secondary text-muted-foreground",
  }[verdict];
  const Icon = { pass: Check, fail: X, inconclusive: CircleHelp }[verdict];
  const label = { pass: "Pass", fail: "Fail", inconclusive: "Inconclusive" }[verdict];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${style}`}
    >
      <Icon className="h-3 w-3" strokeWidth={3} aria-hidden />
      {label}
    </span>
  );
}

function SceneChecks() {
  const [phase, setPhase] = useState<"idle" | "reading" | "done">("idle");
  const [shown, setShown] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function connect() {
    setPhase("reading");
    const quick = prefersReducedMotion();
    const start = quick ? 0 : 900;
    CHECKS.forEach((_, i) => {
      timers.current.push(
        window.setTimeout(() => {
          setShown(i + 1);
          if (i === CHECKS.length - 1) setPhase("done");
        }, start + (quick ? 0 : i * 650)),
      );
    });
  }

  function reset() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("idle");
    setShown(0);
  }

  return (
    <section aria-labelledby="scene-checks">
      <SceneLabel
        n={2}
        title="It checks the work for you — and won't pretend."
        lede="Connect your identity provider and the checks run on their own, every day. Read-only: nothing is installed on anyone's laptop."
      />

      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-7">
          <h3 id="scene-checks" className="font-bold">
            Northwind Analytics · Automated checks
          </h3>
          {phase === "idle" ? (
            <button
              type="button"
              onClick={connect}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Connect Google Workspace
              <span className="rounded bg-primary-foreground/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                sample
              </span>
            </button>
          ) : phase === "reading" ? (
            <span className="text-sm text-muted-foreground" aria-live="polite">
              Reading 34 accounts…
            </span>
          ) : (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Play again
            </button>
          )}
        </div>

        <ul className="divide-y divide-border" aria-live="polite">
          {CHECKS.map((c, i) => {
            const visible = i < shown;
            return (
              <li key={c.name} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:gap-4 sm:px-7">
                {/* Stacked on phones: a fixed verdict column left the detail text
                    157px wide, and the detail is the named leaver — the one line
                    this whole step exists to show. */}
                <div className="shrink-0 pt-0.5 sm:w-[7.5rem]">
                  {visible ? (
                    <VerdictChip verdict={c.verdict} />
                  ) : (
                    <span className="inline-flex rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">
                      Not run
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.source}</div>
                  {visible && <p className="mt-2 text-sm text-foreground/90">{c.detail}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Note title="The leaver is named">
          Not &ldquo;1 issue found&rdquo;. A name, a leaving date, and what to do. That&rsquo;s the
          record an auditor samples.
        </Note>
        <Note title="Inconclusive is not a polite fail">
          It means there wasn&rsquo;t enough to go on. ShieldFlow won&rsquo;t turn a control green
          because you&rsquo;ve done nothing yet.
        </Note>
      </div>
    </section>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="text-sm font-bold">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/* ---------- Step 3: the email ---------- */

function SceneEmail() {
  return (
    <section aria-labelledby="scene-email">
      <SceneLabel
        n={3}
        title="You hear about it before anyone else does."
        lede="When a check changes — something that passed starts failing, or a problem gets fixed — this arrives in your inbox. No need to log in and look."
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-1 border-b border-border px-5 py-4 text-sm sm:px-7">
          <div className="flex items-center gap-2 font-semibold" id="scene-email">
            <Mail className="h-4 w-4 text-primary" aria-hidden />
            Automated monitoring update
          </div>
          <div className="text-muted-foreground">
            From <span className="text-foreground">ShieldFlow &lt;noreply@shieldflow.cloud&gt;</span>
            {" · "}to sam@northwind.test
          </div>
        </div>

        {/* The real template from lib/notify.ts: a white email body. */}
        <div className="bg-white px-5 py-8 sm:px-7">
          <div
            className="max-w-[480px]"
            style={{ fontFamily: "system-ui, -apple-system, sans-serif", color: "#111" }}
          >
            <h4 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>
              Automated monitoring update
            </h4>
            <p style={{ color: "#444", margin: "0 0 16px" }}>
              1 automated check(s) changed — 1 now failing. Review your dashboard.
            </p>
            <span
              style={{
                display: "inline-block",
                background: "#0b1f3a",
                color: "#fff",
                padding: "10px 16px",
                borderRadius: 8,
                fontSize: 14,
              }}
            >
              Open ShieldFlow
            </span>
          </div>
        </div>
      </div>

      <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
        Checks re-run once a day. That&rsquo;s the honest cadence — and it still beats finding out at
        the quarterly review.
      </p>
    </section>
  );
}

/* ---------- Close ---------- */

function Close() {
  return (
    <section className="mt-20 rounded-2xl border border-border bg-card px-6 py-10 sm:px-10">
      <h2 className="text-balance text-3xl font-black tracking-tight sm:text-4xl">
        That&rsquo;s the product.
      </h2>
      <p className="mt-4 max-w-2xl text-pretty text-muted-foreground">
        The requirement codes above are the real crosswalk, and the check results are word for word
        what ShieldFlow writes. Only Northwind is made up.
      </p>

      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Link
          href="/signup"
          className="group inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-7 py-4 text-base font-bold text-primary-foreground transition hover:brightness-110"
        >
          Try it on your own company
          <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" strokeWidth={3} />
        </Link>
        <span className="text-sm text-muted-foreground">
          Questions: <span className="text-foreground">sales@shieldflow.cloud</span>
        </span>
      </div>

      <div className="mt-10 border-t border-border pt-6">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          What it doesn&rsquo;t do, so you know up front
        </div>
        <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <li>No agent on laptops, so disk encryption and screen lock are proven by upload.</li>
          <li>Readiness for a SOC 2 Type I, not a finished Type II report.</li>
          <li>Leaver checks need Okta, Google Workspace or Microsoft 365.</li>
          <li>Checks run daily, not in real time.</li>
        </ul>
      </div>
    </section>
  );
}
