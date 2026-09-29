# ShieldFlow — The Perfect User

**Ideal customer profile, drawn from the shipped product.** Every claim traces to
something in the codebase or to the competitor research in `MARKET_ANGLES.md`.
Not grounded in any real customer — there isn't one yet, and this profile should
be rewritten the day there is.

*Last updated 2026-09-29. The live version is also published as an Artifact.*

---

## The engineer who inherited compliance

Same person in Austin and Amsterdam. No security team, no compliance hire, a job
title about building things — and a questionnaire from a customer sitting in
their inbox.

### The core insight: the best customer sells across the Atlantic

Not American. Not European. **Both at once.** A company with US buyers and EU
buyers gets hit from two directions in the same quarter: SOC 2 from the American
enterprise, a NIS2 or GDPR supplier questionnaire from the European one. That is
two frameworks, and two frameworks is the only condition where 328 requirements
collapsing into 71 measures means anything to them. One framework and you are in
a price fight against a tool that is free.

---

## Sam Okafor

**Head of Platform — and, by default, the person who owns security.**

> "A prospect in Chicago wants our SOC 2 report. A customer in Munich sent a
> forty-question supplier form with NIS2 all over it. I have maybe four hours a
> week for this and I write Terraform for a living."

| Company | Headcount | Based | Asked for | Incumbent tool | Deadline |
|---|---|---|---|---|---|
| B2B SaaS, Series A | 38 | US — sells EU-wide | SOC 2 + NIS2 | None | ~10 weeks |

- **Their stack:** AWS, GitHub, Google Workspace, Cloudflare. All four already
  ship as integrations, and Google Workspace is the one that matters most — it
  turns on the leaver and untracked-account checks.
- **How they buy:** alone, late, with a company card. They won't book a sales
  call to see the product — but they will click through two minutes of it on
  their own, which is exactly what `/demo` is for. There is no onboarding manager
  in the product and they do not want one.
- **What winning looks like to them:** answering Munich without a week of
  screenshots, and having something defensible for Chicago. Not a certificate.
  An answer.

---

## Same role, two markets — what differs is the trigger, not the person

| | United States — SOC 2 first | Europe — NIS2 first |
|---|---|---|
| **They say** | "Our biggest prospect won't sign without SOC 2." | "A bank customer sent us a supplier assessment." |
| **Who** | Head of Platform, VP Engineering, Staff DevOps, CTO at Series A. Arrives through an enterprise sales blocker, almost never through a regulator. | Same titles, same stack, same lack of a security hire. Arrives through the supply chain: their customer is legally required to assess them. |
| **Your opening** | Ask who else is asking. If a European customer is anywhere in their pipeline, NIS2 is coming and nobody has told them yet. That second framework is the whole sale. | NIS2, DORA and CRA are the one verified gap in Vanta and Drata. Everything else you do, they do too, usually deeper. This is the sentence they cannot answer. |

**The qualifying question, either side of the ocean:** *"Which frameworks are
you being asked for, and by whom?"* Two or more and the maths sells itself. One,
and you should decline the fight.

---

## Company size: one to two hundred, but it is three different products

| Size | Stage | What to do |
|---|---|---|
| **1–10** | Seed | **Let them serve themselves. Do not sell to them.** The free tier fits: one framework, three integrations. But the roster checks have almost nothing to reconcile at this size, and many have no identity provider at all. A pipeline for later, not revenue now. The one thing that works on day one is the access-review cadence check — it needs no integration. |
| **11–50** | Core | **Everything built lands here.** Real roster, real identity provider, real customer pressure, still no compliance hire. 9 of 12 access-control measures automate. This is Sam. Spend your time here. |
| **51–200** | Edge | **Sell it, but name the horizon out loud.** It works today. Within a year they will ask for HRIS sync, SCIM provisioning and device monitoring, and none of the three exist. Say so at the start; a customer who knew is a renewal, a customer who found out is a refund. |
| **200+** | Not ours | **Send them to Vanta or Drata and mean it.** Dedicated compliance staff, an HRIS, hundreds of integrations expected, a named CSM. You would lose the deal slowly instead of quickly. |

---

## Qualification: six tests, scored the way the product's checks score

Pass, fail, or inconclusive. Same rule as the product: if you cannot actually
tell, it is not a pass.

| Result | Test | Why |
|---|---|---|
| ✅ Pass | Are they being asked for two or more frameworks? | The whole product. 328 requirements collapse into 71 measures, so the second framework is mostly free. The only test that is non-negotiable on both continents. |
| ✅ Pass | Do they have customers on both sides of the Atlantic? | The strongest signal there is. It guarantees the second framework arrives whether or not they know it yet, and it's the one shape neither a US-only nor an EU-only competitor is positioned for. |
| ✅ Pass | Do they run Okta, Google Workspace or Microsoft 365? | A hard requirement, and easy to forget to ask. Without one of the three, access-control automation drops from 9 of 12 measures to 3. |
| ⚠️ Inconclusive | Are they US-only, with one framework? | The weakest ground, and worth admitting. Against Vanta and Drata you're left with flat pricing, no laptop agent and being straight with people. All real, none structural. Take the meeting; don't build the strategy on it. |
| ❌ Fail | Do they need a completed Type II report? | Walk away, and say why. Type II needs a 3–12 month observation window, and separately the sync still overwrites check history, so that evidence cannot be produced today. Selling into this is the Delve failure mode exactly. |
| ❌ Fail | Does a customer already require laptop monitoring? | Disk encryption, screen lock, antivirus. There is no agent and no plan for one. Send them to Vanta or Oneleet. The DevOps engineer who asked about this accepted the trade-off immediately because it was volunteered rather than discovered — repeat that. |

---

## Timing: three windows, and nothing in between

Nobody switches a working compliance tool to save money. Do not try.

| Window | Why they are available | Where |
|---|---|---|
| **First-timer** | An enterprise prospect just demanded SOC 2. No incumbent to displace, no switching cost. | US-heavy |
| **Renewal cliff** | Year-two quote lands 40–100% higher — the most common complaint in this market. Trust Center pages leak the report date: build a list of companies 10–13 months in. | Both |
| **Forced event** | A regulation with a date their current tool does not cover. | EU-heavy |

---

## The path: show the product before asking for anything

The first 50 trial links asked people to create an account before they had seen
a single screen. None were redeemed. Reverse the order.

1. **Ask the qualifying question.** "Which frameworks are you being asked for,
   and by whom?" Two or more and keep going. One, and say so and step back.
2. **Send `shieldflow.cloud/demo`.** Two minutes, a sample company, no signup.
   It stars someone in Sam's exact position, so it reads as their problem rather
   than a product tour. Tick one measure and 13 requirements across 8 frameworks
   light up — that click is the pitch. The recorded clips (`VIDEO_PLAN.md`) do
   the same job where a link won't be clicked.
3. **Volunteer what it doesn't do.** No laptop agent, Type I not Type II, daily
   checks, leaver checks need an identity provider. The demo ends on that list on
   purpose.
4. **Then the account.** By now they know what they're signing up for. Sign-up
   confirmations go through a real sending service since 26 September. **Sign up
   once with an address that isn't yours before sending this path to anyone** —
   it's the one link in the chain not yet tested.

---

## Who to turn away, and where to send them

Turning someone away is the cheapest trust you will ever buy.

- **Anyone over 200 people with an HRIS.** They need SCIM, device monitoring and
  a named CSM. Vanta or Drata.
- **The team that needs SOC 2 and nothing else, forever.** Comp AI is free and
  open-source. You cannot win on price and should not try.
- **Anyone whose auditor is already booked.** There are no named partner
  auditors. That is the real gap, and it is not a feature.
- **The buyer who wants it done for them.** Oneleet bundles a penetration test
  and a vCISO. ShieldFlow ships software and answers the phone.
- **Anyone who needs the report finished this quarter.** ShieldFlow sells
  readiness, not a completed audit.

---

## Fit check: what Sam gets in the first hour

| What they connect | What it proves, automatically |
|---|---|
| Google Workspace | 2-step verification coverage; leavers who still have access; accounts belonging to nobody on the roster |
| Microsoft 365 | The same two roster checks, for the half of the market that is not on Google |
| AWS | Root account MFA; IAM password policy. Two read permissions, no writes |
| GitHub | Branch protection on default branches; repositories that are public |
| Cloudflare | TLS posture across every zone |
| Nothing at all | Whether an access review actually happened in the last 90 days — needs no integration, and most competitors only send a reminder about it |
| The next morning | An email from `noreply@shieldflow.cloud` if any check changed overnight (tested against production, 27 September) |

### Fixed since the first version of this profile

- The landing page no longer claims an S3 check or a "Slack ping in seconds"; it
  says what runs, and that it runs daily.
- Drift alerts reach the inbox, not just the in-app bell.
- Contact addresses point at shieldflow.cloud and forward.
- **Evidence is uploaded once** — attached to a measure, it counts for every
  requirement it covers in every framework (27 September). Before, Sam would
  have uploaded the same document once per requirement.
- **Questionnaire drafts and Co-Pilot use the work actually done** — documents,
  check results, finished measures — and always send certification, audit and
  pen-test questions to a human.
- **The public Trust Center shows the same numbers as the dashboard**, and the
  report handed to prospects includes failing checks.
- **Generated policies fit a small company** — real roles, real vendors, current
  NIST password guidance — instead of an imaginary enterprise.

### Still open, and Sam would hit each one

- **The site prices in dollars, the PRD in euros.** For a buyer who straddles
  both markets, pick one and show the other in brackets.
- **Team invites send no email.** When Sam invites a colleague, the colleague
  hears nothing. Sam has to send the link by hand.
- **No trial-expiry email exists.** A trial just ends. Nothing tells Sam it's
  about to.
- **Every high-risk vendor is its own alert**, even after its review is done —
  noise on the first dashboard Sam sees.

---

*Grounded in the shipped code: 8 frameworks, 328 requirements, 71 measures,
8 security integrations, 9 of 12 access-control measures automated.*
