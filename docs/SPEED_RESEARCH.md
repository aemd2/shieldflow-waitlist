# How competitors solve "make it faster"

**Date:** 2026-09-02 · Triggered by a prospect saying the product is good but takes
too long. Researched against every major competitor plus the open-source field.

---

## 0. The metric they compete on is human hours, not calendar days

Nobody sells "14 days" as the number that matters. The number that matters is **how
many hours a person has to sit at a keyboard**:

| Platform | Claim |
|---|---|
| **Delve** | Audit-ready in 2–4 weeks with **10–15 hours of input** |
| **Comp AI** | Type I in **24 hours**, Type II in 14 days |
| **Drata** | **75–80% of Trust Services Criteria automated** via read-only APIs; the residual 20% is *"40 to 80 hours per audit that a dashboard does not touch"* |
| **Vanta** | Audit completion times cut **50%**; a case study reaching Type II readiness in **3 weeks with minimal engineering lift** |
| **Sprinto** | 8–12 weeks to Type I — but with **a certified onboarding manager assigned to you** |

"10–15 hours of input" is the benchmark to beat. Ours is currently far worse, and
§3 explains why.

---

## 1. The four strategies, and what each actually is

### Strategy A — Automate the evidence so the control is never touched
**Drata, Vanta, Secureframe.**

Drata automates **75–80%** of SOC 2 through read-only API integrations with AWS,
GCP, Azure, Okta, GitHub and HRIS. The user never opens those controls at all;
they're satisfied before anyone looks. What it explicitly *cannot* do — application
evidence, workflow documentation, human attestations — it **flags and waits** rather
than pretending.

This is the real mechanism behind every "fast" claim. Everything else is packaging.

### Strategy B — Put an AI agent on the residual work
**Vanta, Sprinto.**

Vanta shipped the base AI Agent June 2025, the Agentic Trust Platform November 2025,
and a dedicated **Agent for Risk** on 2 June 2026 that recommends controls and owners
and notifies stakeholders, human-in-the-loop. It also generates **remediation
snippets** so a developer fixes a failing test without researching it.

Sprinto runs AI agents for evidence collection continuously, plus automated
onboarding, training, access checks and device validation "without manual follow-up".

### Strategy C — Put a *person* on it
**Sprinto, Secureframe.**

Sprinto assigns a **certified onboarding manager** who walks you through every
requirement, reviews your setup and flags what needs fixing. Secureframe's onboarding
team *"often manages much of the initial setup"* — explicitly white-glove.

This is the least scalable strategy and the most effective, and it is the one a solo
founder can actually execute today. Worth noting it is not a fallback: two funded
competitors chose it deliberately.

### Strategy D — Declarative onboarding
**CISO Assistant** (from the open-source review in `MARKET_ANGLES.md`).

11 shipped presets (`preset-us-soc2`, `preset-nis2-readiness`, `preset-dora-financial`
…). Applying one scaffolds a whole workspace — risk assessment, audit, objectives,
recurring tasks, named vendor placeholders — then renders a **9-step journey** with
per-step status that deep-links into the object you need to work on.

All of it is YAML. A new vertical costs a file, not a sprint. Probo, by contrast, drops
a new org into an empty app, and that absence is its most obvious weakness.

---

## 2. What nobody does

- **Nobody makes the user tick hundreds of controls one at a time.** That is the
  thing we currently do.
- **Nobody meters integrations** (see `PITCH.md` §limits) — because integrations are
  precisely the mechanism that removes work.
- **Nobody claims Type II can be compressed.** The fast claims are all Type I or
  "readiness".

---

## 3. Where ShieldFlow actually stands

Our automated coverage against Drata's 75–80%:

- **11 checks across 7 providers**, mapping to roughly 15–20 of 328 controls ≈ **5%**.
- The 14-Day Sprint still walks **controls**, and Phase 2 requires touching 80% of
  them. For the common SOC 2 + ISO 27001 pairing that is **101 manual clicks**, up
  from ~24 before the framework expansion.

So the prospect's complaint is precisely correct, and the framework work made it
worse. The measure layer was built to fix exactly this and then was never wired into
the sprint.

**The leverage we have that the incumbents don't need:** each measure fans out to ~8
controls (328 requirements / 71 measures). A check that completes a *measure* advances
eight controls at once. Drata needs 1,000+ tests because its tests hit controls
directly; ours hit a layer above.

---

## 4. What to do, in order of hours-saved per hour-spent

**1. Point the sprint at measures instead of controls.** ~101 clicks → ~64, each one
visibly moving 5–8 controls. Everything needed already exists — `assertWithinLimit`,
the crosswalk, and advance-only write-through. This is wiring, not building. (~1 day)

**2. Let automated checks complete measures.** Today a check proves root MFA is on and
the `mfa` measure still sits unticked waiting for a human. Wire checks → measures and
connecting your stack completes measures by itself, which fans out to controls. This
is the difference between "it gave me a list" and "it did the work". (~1 day)

**3. Deepen checks per connected provider (gap-plan G3).** Now worth far more than
before: every new check moves ~8 controls rather than 1. Ten more AWS/GitHub/Okta
signals plausibly takes automated coverage from ~5% toward 25–30%. Not Drata's 80%,
but the curve is much steeper for us.

**4. Make the sprint declarative** (CISO Assistant's model). Turns "add a NIS2 journey"
into a YAML file. Pays for itself the third time a framework is added.

**5. Be the onboarding manager.** Sprinto and Secureframe both pay humans to do this
because it works. At single-digit customer counts it is free, it is the fastest route
to the outcome the prospect is asking for, and it tells you exactly which steps to
automate next.

---

## 5. The tension to be aware of

Strategy A only pays off when the customer connects their **whole** stack — that is
what makes measures auto-complete. The 3-integration cap on Free that shipped in
`2fda248` caps the exact moment the product feels fast.

Not necessarily wrong — it is a real upgrade lever — but the two decisions pull in
opposite directions and that should be a conscious trade, not an accident.

---

## Sources

- [Drata — Controls and Evidence](https://drata.com/products/compliance/controls-and-evidence) · [What Drata automates for SOC 2, and what it does not](https://screenata.com/resources/blog/what-drata-automates-for-soc-2-and-what-it-does-not)
- [Vanta — Features](https://www.vanta.com/features) · [Vanta Review 2026: AI Agent](https://soc2auditors.org/insights/vanta-review/)
- [Sprinto — SOC 2 platform](https://sprinto.com/frameworks/soc-2/) · [Sprinto Review 2026](https://soc2auditors.org/insights/sprinto-review/)
- [Secureframe vs Vanta vs Drata](https://sprinto.com/blog/secureframe-vs-vanta-vs-drata/) · [Technical comparison](https://technologymatch.com/blog/vanta-vs-drata-vs-secureframe-vs-sprinto-the-technical-comparison-for-it-leaders)
- Open-source field: see `MARKET_ANGLES.md` (CISO Assistant presets/journeys, Probo's absent onboarding)
