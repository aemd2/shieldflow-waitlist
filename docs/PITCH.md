# ShieldFlow — The Pitch

**Date:** 2026-09-02 · What to say, who to say it to, and what not to claim.

Built on the competitive research in `MARKET_ANGLES.md` and the product state after
the measure-layer work. Every number here is verified against the live database or
a competitor's own documentation — nothing aspirational.

---

## 1. The one-liner

> SOC 2, ISO 27001 and NIS2 ask for 328 things. They're mostly the same things.
> ShieldFlow maps them to 71 — so you do the work once and prove it everywhere.
> €7,000 a year, flat, and the price never moves.

## 2. The thirty-second version

> Compliance tools all work the same way: pick a framework, get a list, work the
> list. Add a second framework and you get a second list — and about 80% of it is
> the work you already did, asked differently.
>
> We put a layer in between. 328 requirements across eight frameworks map onto 71
> measures. You enforce MFA once; it satisfies SOC 2 CC6.1, ISO 27001 A.8.5, NIS2
> Article 21, PCI Requirement 8, HIPAA and GDPR at the same time, and the evidence
> attaches once.
>
> We also cover NIS2, DORA and the Cyber Resilience Act, which Vanta and Drata
> don't. And it's one flat price with no headcount bands and no renewal increase.

## 3. The three moments a buyer is actually reachable

Nobody switches a working compliance tool to save money. Do not try. There are
exactly three windows:

| Moment | Why they're available | How to find them |
|---|---|---|
| **First-timer** | An enterprise prospect just demanded SOC 2. No incumbent to displace. | Founder communities, YC/accelerator networks, "we just got asked for SOC 2" posts |
| **Renewal cliff** | Year-two quote lands 40–100% higher. The most common complaint in the entire market. | Public Trust Center pages and SOC 2 badges leak the report date — renewal is ~12 months later. Build a list of companies 10–13 months in. |
| **Forced event** | A regulation with a deadline their tool doesn't cover. | NIS2 (Oct 2026), DORA, CRA (reporting live since 11 Sept 2026) |

**Qualifying question:** *"Which frameworks are you being asked for, and by whom?"*
Two or more → the 328/71 maths sells itself. One → you're competing on price; pass.

## 4. The EU angle — the strongest opening

Vanta and Drata have **no native NIS2, DORA or CRA**. European teams are documented
running Vanta for SOC 2 *and parallel spreadsheets* for everything else.

**Sell the supply chain, not direct scope.** NIS2 largely exempts companies under 50
people — but that's not the market. Every SaaS vendor selling to a bank, hospital,
insurer or public authority is now assessed by them, because those customers are
*legally required* to assess their suppliers.

> Direct scope is a legal obligation. Indirect scope is a commercial one: your
> customer expects answers, and if you can't give them you lose the contract.

That is the identical trigger you already sell into for SOC 2 — an enterprise
customer demanding proof before signing — with a much larger addressable base and
no certification body involved.

**Cold outreach:**

> Your regulated customers are now required to assess their suppliers under NIS2.
> That questionnaire lands on you whether or not you're in scope. Vanta doesn't
> cover NIS2 — we do, alongside SOC 2 and ISO 27001, in one price, with the
> overlapping work done once.

## 5. How to present it — the demo

Fifteen minutes. The order matters: land the mechanism before the features.

1. **Open on their pain, not your product** (2 min)
   "Which frameworks are you being asked for?" Let them say two. Then: "So you're
   about to do the same work twice." Stop talking.

2. **Show `/measures`, not the dashboard** (4 min) ← *the whole demo lives here*
   Expand one measure — "Require multi-factor authentication." Point at the chips:
   SOC 2 CC6.1, ISO A.8.5, NIS2 Art.21(2)(j), PCI Req 8, HIPAA 164.312(d), GDPR
   Art. 32. **Mark it complete. Show every one of those controls move.**
   That single click is the product. Everything else is table stakes.

3. **Then the framework list** (2 min)
   Eight frameworks, all included, no per-framework pricing. Point out NIS2, DORA
   and CRA specifically — "your current tool doesn't have these."

4. **The 14-Day Sprint** (2 min)
   A finishable path, not a 300-item checklist. Say **Type I** out loud (see §7).

5. **Automated evidence** (3 min)
   Connect something live if you can. Hourly checks, drift alerts. Frame as
   "table stakes, but it works" — not as the differentiator.

   **The one worth demoing on a blank workspace:** the access-review cadence
   check needs nothing connected. Show it sitting at *inconclusive* — "we won't
   mark a control green because you've done nothing" — complete a review, and
   watch CC6.1, CC6.2 and CC6.3 move together off one action. That single moment
   makes the measure layer concrete and shows the honesty policy at the same
   time. See §6.7 for what not to overclaim about it.

6. **Close on price** (2 min)
   Flat. No headcount bands. No renewal increase. Month to month. Then stop.

## 6. Your advantages, ranked by defensibility

**Tier 1 — structural. Competitors can't easily copy.**
1. **NIS2, DORA, CRA natively.** The only verified feature gap in the incumbents.
2. **Flat price, no headcount bands, no renewal rise, month-to-month.** Vanta can't
   match this without breaking its own revenue engine. Renewal shock is the single
   most common complaint in the market.
3. **EU-hosted.** CLOUD Act exposure is a live objection for European buyers.

**Tier 2 — real, but matchable.**
4. All eight frameworks in one price vs. per-framework pricing
5. No agent on employee laptops — documented internal revolt at Vanta
6. The Sprint is finishable; "difficulty in set up" is a top Vanta complaint
7. **An overdue access review fails a control, not just a reminder.** Vanta,
   Drata, Secureframe and Oneleet nudge the assignee and leave the dashboard
   green if nobody acts. **Sprinto does test it** — so this is "we match the best
   of them, and most of them don't do it", never "nobody does this". Say the
   quiet part out loud, because it's the reason it matters: *six months in,
   companies discover the quarterly review is overdue because nobody defined who
   runs it.*

**Tier 3 — true, but never lead with these.**
Cross-framework mapping, continuous monitoring, AI policy generation, automated
evidence. **Vanta and Drata have all four, mostly deeper.** Claim them as table
stakes if asked; never as reasons to switch. A technical evaluator will catch it.

## 7. What NOT to claim

- **Do not say "Type II."** The Sprint gets you **Type I** — controls suitably
  designed at a point in time. Type II requires an observation window of 3–12
  months and no software can compress a calendar. ShieldFlow also does not yet
  *retain* check history (the hourly sync still overwrites it), so we cannot
  currently produce Type II evidence at all. Say Type I. It's true, it's still
  valuable, and the honesty is a differentiator in a market that just watched a
  $300M competitor collapse over faked reports.
- **Do not claim cross-framework mapping is unique.** Vanta and Drata both have it.
  Ours is well-executed and central to the product — that's a different claim.
- **Do not out-count integrations.** Seven versus 400+. Don't raise it.
- **Do not say the access-review cadence check is unique.** Sprinto has it (§6.7).
  "Most compliance tools remind you; we test it" is true. "Nobody else does this"
  is not, and a Sprinto evaluator will know in one sentence.
- **Do not imply the leaver check works without an identity provider.** It needs
  Okta or Google Workspace connected. On Microsoft 365 it does not run at all
  (§9). The access-review cadence check *does* work with nothing connected —
  that one is safe to demo on a blank workspace.
- **Do not promise a refund on anything you don't control.** The guarantee is
  "Type I ready in 90 days or the year is free" plus a price that never moves.

## 8. Objection handling

**"We already use Vanta."**
> Then don't switch mid-cycle — I wouldn't either. Two things worth knowing for
> renewal: what does your quote look like in year two, and what's your plan for
> NIS2? Vanta doesn't cover it.

**"You're a one-person company."**
> True. That's why the price is flat and the contract is monthly — you're not
> locked in if I disappoint you. And it's why I answer the phone.

**"Only seven integrations?"**
> Seven that cover the SMB stack and are tested end to end. Breadth matters at 500
> employees; at your size, depth on AWS, GitHub and your IdP is what an auditor
> samples.

**"How do I know my auditor will accept this?"**
> The honest answer: ask them. Every control maps to a recognised requirement with
> the evidence auditors expect listed alongside it, and it all exports. If they
> have questions I'll get on the call. *(This is the weakest spot — see §9.)*

**"How do I know your AI won't leak our data?"**
> Three answers, and they're checkable. First, we don't send it: the model gets
> control codes, counts and policy titles — never evidence files, policy contents,
> personnel records, vendor names or credentials. Second, the one place you could
> hand us personal data is the chat box, and we strip emails, phone numbers, IBANs
> and card numbers server-side before anything leaves us. Third, our inference
> provider is Groq, in the US, with **Zero Data Retention enabled** — inputs and
> outputs aren't stored at all. It's named in our privacy policy with exactly what
> we send.
>
> What I won't claim: if you type "our CFO Maria approved this" in prose, no filter
> catches that. If your obligations require nothing leaves the EU, we can disable
> AI for your workspace and the rest of the product is unaffected.

**"What if you retire a framework / go out of business?"**
> Everything exports, and cancelling is a month's notice. You keep your evidence.

## 9. Known soft spots — prepare, don't hide

- **No customers, no logos, no auditor relationships.** The real one. Vanta's actual
  moat is that auditors already know Vanta.
- **No Type II evidence retention** (§7).
- **Seven integrations.**
- **No Microsoft 365 / Entra ID.** The identity checks (leavers who still have
  access, accounts with nobody behind them) read Okta or Google Workspace. A
  Microsoft shop gets the access-review cadence check and nothing else from that
  set. Given how much of the EU mid-market runs Microsoft, this is the most
  commercially expensive gap on the list after the auditor relationships — and
  the cheapest to close, because the logic is provider-agnostic already; it needs
  a Graph API reader, not a redesign.

**The highest-leverage fix isn't a feature — it's two or three named partner
auditors** who'll accept ShieldFlow output at a quoted fee. That converts the
biggest unknown in the buyer's mind into part of the offer, it's the one thing
free open-source can never match, and auditors refer clients.

## 10. Loose ends before pitching

- Landing page prices in **$7,000** while the PRD prices in **€**. Pick one.
- The 50 trial links have **zero redemptions**. The links work (verified) — the
  problem is upstream of the product.
- **No trial expiry email exists.** `RESEND_API_KEY` is unset, so a tester who
  stops logging in never learns the trial ended.
