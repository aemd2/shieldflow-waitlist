# ShieldFlow — Type II Plan (closing the observation-window gap)

**Date:** 2026-08-28 · **Status:** Analysis + proposed sequencing. Nothing built yet.

Companion to `PREMIUM_GAP_2.md` (competitive gaps) and `PREMIUM_GAP_PLAN.md` (feature
build-out). This one names a **structural** gap neither of those caught, because both
measured *features* and this is about **time**.

---

## 1. The diagnosis, precisely

The instinct — "the 14-Day Sprint gets you Type I, not Type II" — is correct, but the
mismatch is deeper than the sprint's framing. It's in the schema.

**What the two report types actually require:**

| | SOC 2 Type I | SOC 2 Type II |
|---|---|---|
| Question | Are controls *suitably designed* — right now? | Did controls *operate effectively* **throughout a period**? |
| Evidence | A snapshot | A time series + an exception list |
| Timeline | Point-in-time. 14 days is genuinely plausible. | 3-month minimum window, commonly 6–12. **Cannot be compressed by any tool.** |
| Auditor behaviour | Inspects design | **Samples**: "show me the state on March 14", "show me all four quarterly reviews" |

The 14-Day Sprint is a legitimately good Type I product. The problem is that Type II is
not "Type I plus more features" — it's Type I plus **a calendar window of retained
proof**, and ShieldFlow currently retains none of it.

### The smoking gun

`app/supabase/migrations/0018_integration_findings.sql:37` and the cron's admin path
(`app/lib/checks.ts:358` and `:374`) both do the same thing on **every single sync**:

```sql
delete from public.integration_findings where company_id = ... and provider = ...;
-- then insert the fresh set
```

`pg_cron` runs this **hourly** (`docs/CRON_SETUP.md`). So 24 times a day, across every
connected integration, ShieldFlow **deletes the exact data that constitutes Type II
evidence** and replaces it with a fresh snapshot.

After 90 days of "continuous monitoring," the product can answer:

> ✅ "Is root MFA enabled right now?"

and cannot answer:

> ❌ "Was root MFA enabled for all 90 days of the audit window?"

The second question *is* SOC 2 Type II. The machine that would generate the answer is
already built, already running hourly, already tamper-safe — and it throws the output
away.

### The rest of the time dimension

| Surface | Current shape | Type II problem |
|---|---|---|
| `integration_findings` / `control_checks` | Deleted + replaced per sync | No history at all |
| `control_status` | One mutable row per control | complete → broke → complete reads as "complete"; the gap is invisible |
| `computeScore` | Point-in-time % | No "% of window passing" |
| `vendors.reviewed_at` | Single overwritten timestamp | Can't prove *quarterly* review, only *last* review |
| `access_reviews` | No recurrence (known: G14b) | Can't show the series of reviews across the window |
| `/reports` | Live regeneration (known: G21) | Not a fixed point-in-time artifact |

### What is already Type II-shaped (don't break these)

Two pieces are already built correctly and are genuine assets:

- **`audit_events`** — append-only, RLS SELECT-only, actor denormalized so it survives
  offboarding, **deliberately never pruned**. This is a real operating-effectiveness
  trail for human actions. It's just never presented as one.
- **`policy_acknowledgements`** — one immutable row per policy **+ version** + person.
  Version-scoped history, exactly right.

So this is not a rewrite. Roughly 40% of the Type II architecture exists; the automated
half is being actively deleted.

---

## 2. Marketing exposure (fix this first — it's free)

Two claims in `components/marketing/Landing.tsx` are unsafe as written:

1. **Line 255** — comparison table: `["Time to audit-ready", "3 – 6 months", "14 days"]`.
   A buyer reads Vanta's honest Type II timeline against a 14-day ShieldFlow number.
   That's not a like-for-like row.
2. **Lines 359–361** — *"if your auditor rejects a single piece of evidence we collected
   — we refund 100%."* Combined with the above, a customer who bought expecting Type II
   in 14 days has a strong claim. "A single piece of evidence" is an extraordinarily wide
   trigger.

This matters more here than for normal SaaS: the buyer persona **audits vendors for a
living** and will read the guarantee like a contract.

Fixing the wording makes the pitch *stronger*, not weaker — see §4.

---

## 3. The strategic opening (this is how you beat Vanta)

Everyone — Vanta, Drata, Sprinto, Secureframe — competes on **speed to readiness**.
Nobody has made **the observation window** the product.

Think about the incumbent's customer lifecycle:

```
Day 0 ──── Day 30 ─────────────── Month 3–12 ──────────── Audit
   [ onboarding: high engagement ]  [ DEAD AIR ]           [ scramble ]
                                         ↑
                               the customer ignores the tool,
                               then questions the renewal
```

That dead air is the incumbents' churn window and their weakest surface. It is also
**precisely the period ShieldFlow's hourly cron is already instrumenting** — and
currently deleting.

### Reposition as a two-act product

- **Act 1 — The Sprint (Day 0–14).** Type I readiness. Already built, arguably better
  than competitors' generic checklists. Keep it exactly as is; just name it honestly.
- **Act 2 — The Window (Day 15 → audit).** The Type II observation period, rendered as a
  live, countdown-driven surface showing proof *accumulating*. Nobody sells this.

The wedge is not "cheaper Vanta." It is: **the only tool that turns the waiting period
into visible, compounding proof.**

### The demo that wins the room

Once evidence is retained, a genuinely novel feature falls out almost free:

> **Time travel.** "Pick any date in your audit window. Here is the exact state of every
> control on that date."

Auditors **sample** — that is the entire Type II fieldwork method. No SMB-priced tool
lets an auditor click a date. This is a 30-second demo that makes the auditor in the room
say "wait, do that again," and it is a direct consequence of T1 below.

---

## 4. Proposed sequencing

### T1 · Stop deleting the evidence — **do this before anything else**

Convert findings/checks from delete-and-replace to an append-only series.

**Shape.** Don't store 24 rows/day/check. Collapse consecutive identical verdicts into
**runs**:

```
check_runs(company_id, provider, check_key, control_id,
           result, detail, started_at, ended_at NULL = still current)
```

A sync that returns the same verdict extends the open run (`ended_at` stays null); a
changed verdict closes the run and opens a new one. A control passing for 90 days is
**one row**, not 2,160 — cheap on the Supabase free tier (500 MB), and it is *already the
exact sentence an auditor wants*: "passing 2026-01-01 → 2026-03-31, no exceptions."

Current-state reads become "the run where `ended_at is null`" — a small change at the
existing call sites, not a rewrite.

> **Why this is urgent and not merely important:** every day it waits, evidence is
> permanently destroyed. A customer who signs today can never retroactively prove
> January. This is the only item on any roadmap where delay causes irreversible loss.

### T2 · Exceptions register

A run that closes as `fail` **is** an audit exception. Auto-create a record: what broke,
when, when it recovered, duration, and a required remediation note. Falls out of T1 for
nearly free, and it is the single highest-value auditor artifact in the product — Vanta
and Drata make you reconstruct this from notification history.

### T3 · Audit window as a first-class object

`audit_windows(framework_id, report_type I|II, starts_at, ends_at, auditor_contact)`.

Once a window exists, every control gets a denominator:

> **CC6.1** — passing **97.8%** of the window · **2 exceptions** (Mar 3–5, Jul 12)

That sentence is the Type II deliverable, and nothing at this price point renders it.

### T4 · Reframe the sprint (product + marketing, same change)

- Sprint completion: "You're audit-ready 🎉" → **"Type I ready — book your readiness
  assessment."**
- Add **Phase 5: Your Type II window — Day 12 of 90**, a live ring on `/getting-started`
  with an accumulating evidence count. This turns dead air into a reason to log in.
- Comparison table row: `"Time to audit-ready", "3 – 6 months", "14 days"` becomes
  **`"Time to Type I readiness", "3 – 6 months", "14 days"`**, plus a new row the
  incumbents *lose*: **"Evidence retained across the audit window — point-in-time vs.
  full history with exceptions."**
- Narrow the guarantee to something deliverable (e.g. scoped to Type I readiness, with a
  defined remedy) rather than "a single piece of evidence."

### T5 · Cadence history

Turn the remaining single-timestamp fields into series, so "we review vendors quarterly"
becomes provable rather than asserted:

- `vendors.reviewed_at` → a `vendor_reviews` table (one row per review).
- Access reviews: recurrence + scheduled instances (already scoped as **G14b**).

### T6 · Then G21 (immutable audit package) — now much stronger

With T1–T3 in place, the audit package stops being "a zip of files" and becomes **the
window report**: per-control uptime %, the exception list with remediation notes, and a
frozen evidence index. That is the artifact you hand an auditor.

---

## 5. What to explicitly *not* do first

- **G1 (integration breadth).** 4 vs. Vanta's 400 is unwinnable and orthogonal to this
  wedge. Depth of *retained* evidence beats breadth of *sources* for Type II.
- **G2 (cross-framework mapping).** `PREMIUM_GAP_2.md` lists this as the P0 architectural
  must-have, and for *parity* it is. But it is multi-week re-architecture that makes
  ShieldFlow **equal** to Drata's DCF, whereas T1 is roughly a day and makes it
  **different**. Sequence T1–T3 first, then G2.

That reordering is the main disagreement this document has with the existing gap plan,
and the reason is the irreversibility noted in T1: G2 can be built at any time, retained
evidence cannot be built retroactively.

---

## 6. One-line summary

> ShieldFlow already runs the hourly engine that would produce SOC 2 Type II evidence,
> and deletes its output 24 times a day. Stop deleting it, and the product goes from
> "cheaper Vanta" to "the only tool that proves the window" — the exact period every
> incumbent treats as dead air.
