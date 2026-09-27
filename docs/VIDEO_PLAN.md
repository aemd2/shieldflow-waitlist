# ShieldFlow — Video Plan

**Date:** 2026-09-27 · One short clip per feature, recorded from the real app.

Built from how products outside compliance handle "the app is too big for one
video": they don't put the app in the video. Linear's homepage has no video at
all — it splits the product into four jobs and shows one picture each. Notion's
has one clip, 11 seconds, silent, looping. Wistia's retention data puts about
30% of viewers gone by the 30-second mark. So: one moment per clip, not one
clip for the product.

Every competitor in compliance (Vanta, Drata, Secureframe, Sprinto, Comp AI,
Oneleet) hides its demo behind a form or a sales call. Short public clips are
something none of them do.

---

## The rules for every clip

1. **One moment.** If a clip needs two captions to explain, it's two clips.
2. **Result in the first 3 seconds.** Start just before the thing happens, not
   on an empty page.
3. **Silent, with captions.** Most people watch without sound. Two captions per
   clip at most, under 8 words each.
4. **8–20 seconds.** The longest (questionnaire, access review) can run to 20.
5. **Real app, sample company.** Never your own data, never a real customer's.
   Use Northwind Analytics and `.test` email addresses throughout.
6. **Only show what the product does today.** Same rule as `PITCH.md` §7. No
   "real time", no "hourly", no S3, no Type II.

---

## Before recording anything

### 1. A recording workspace with realistic data — required

Both current workspaces are nearly empty: one has only PCI DSS switched on and
no people; the other has only ISO 27001. An empty workspace makes an empty clip.

The recording workspace needs:

| What | Why |
|---|---|
| SOC 2 + ISO 27001 + NIS2 switched on (ideally all 8) | Clip 1 shows one measure moving several frameworks |
| ~12 people in Personnel, one marked offboarded 30+ days ago | Clip 4, the leaver |
| 4–5 vendors, 3–4 risks | Clips 14 |
| One access review in progress, one completed | Clip 7 |
| Two or three policies, one approved | Clip 8 |
| Google Workspace or Okta connected | Clips 3 and 4 need live checks |

This can be seeded into the `mikesmith` test workspace. Nothing on it is real.

### 2. Fix the framework-add gap — blocks clip 2

When a framework is switched on, `add_framework_to_company` creates every one of
its requirements as *not started*. It never checks which measures are already
complete. So a company that finished SOC 2 work and then adds NIS2 sees NIS2 at
0% — while the measures page lists the same NIS2 requirements as satisfied.

That breaks "do the work once" at the exact moment a transatlantic buyer would
test it, and it rules out what would be the strongest clip on this list. Fix
before recording clip 2: after seeding the new framework's requirements, run the
existing measure propagation so completed measures credit them.

### 3. Recording set-up (Windows)

Any screen recorder works — OBS Studio (free) to record, and Clipchamp or any
basic editor to trim and add captions. The settings matter more than the tool:

- Browser full screen (F11), bookmarks bar hidden, one tab only
- Browser zoom 125% so text is readable when the clip is shrunk on a phone
- Record at 1920×1080, 30 fps, no audio
- Each clip as its own file, named by number: `01-work-once.mp4`
- Export MP4 (H.264). Aim for under 2 MB per clip so the homepage loads fast

---

## The list

| # | Feature | The one moment | Length | Tier |
|---|---|---|---|---|
| 1 | Measures | Mark MFA complete → SOC 2, ISO 27001 and NIS2 all move | 12s | 1 |
| 2 | Adding a framework | Switch on NIS2 → most of it is already done | 12s | 1 · **blocked** |
| 3 | Automated checks | Connect Google Workspace → pass, fail, inconclusive appear | 15s | 1 |
| 4 | Leaver check | The check fails and names the person who left | 12s | 1 |
| 5 | Drift alert | The email arrives in the inbox | 8s | 1 |
| 6 | Questionnaires | Paste questions → answers drafted, the unsure ones flagged | 20s | 1 |
| 7 | Access reviews | Keep or revoke each person → complete → signed CSV filed | 20s | 2 |
| 8 | Policies | Generate a policy with AI → approve it | 15s | 2 |
| 9 | Trust Center | The public page a prospect can open | 10s | 2 |
| 10 | 14-Day Sprint | The finishable path, day by day | 12s | 2 |
| 11 | Evidence | Every file dated and linked to what it proves | 10s | 2 |
| 12 | Report | One-page snapshot, saved as a PDF | 10s | 2 |
| 13 | Co-Pilot | Ask what to do this week → answer from your own data | 15s | 3 |
| 14 | Vendors & risks | The two registers | 10s | 3 |
| 15 | Activity log | Every change, who and when | 8s | 3 |

**Tier 1 is the pitch** — about 80 seconds in total, and together it's the whole
story. Record it first. Tier 2 fills the feature sections of the site. Tier 3 is
for completeness.

**Not on the list, on purpose:** billing, notifications, settings, training and
tasks. They're plumbing — true, but nobody buys because of them.

---

## Tier 1 — shot lists

### 1 · Do the work once *(homepage hero)*

- **Start on:** Measures page, "Require multi-factor authentication" expanded,
  status *Not started*, its requirement codes visible across frameworks.
- **0–3s:** Set status to *Complete*.
- **3–8s:** Switch to the dashboard. SOC 2, ISO 27001 and NIS2 progress have all
  moved.
- **8–12s:** Hold on the dashboard.
- **Captions:** "Do the work once." → "Every framework gets the credit."
- **Honesty note:** requirements that need several measures move to *in
  progress*, not complete. Show that as it is — don't cut to a moment where they
  look finished.

### 2 · Add a framework *(the transatlantic clip — blocked)*

- **Start on:** dashboard with SOC 2 well progressed, NIS2 not yet added.
- **0–4s:** Add NIS2 from the dashboard.
- **4–12s:** NIS2 appears already part-complete, from work done for SOC 2.
- **Captions:** "Already did SOC 2?" → "NIS2 is mostly done."
- **Do not record until the gap in "Before recording" §2 is fixed.** Today NIS2
  would appear at 0%, and the clip would show the opposite of its caption.

### 3 · Checks run themselves

- **Start on:** Integrations page, Google Workspace not connected.
- **0–4s:** Connect. Skip the Google sign-in screens in the edit — cut straight to
  connected.
- **4–15s:** Dashboard or a control page shows three results: a pass, a fail, an
  inconclusive.
- **Captions:** "Connect once." → "It checks, and won't fake a pass."

### 4 · The leaver

- **Start on:** Personnel, one person marked offboarded 30+ days ago.
- **0–4s:** Point at them (hover, or a zoom in the edit).
- **4–12s:** The check's detail: *"…left more than 7 days ago but their account is
  still open: [name] (left [date])."*
- **Captions:** "Someone left in August." → "Their account didn't."

### 5 · The alert

- **Start on:** an email inbox, sample address, nothing else visible.
- **0–3s:** "Automated monitoring update" from `noreply@shieldflow.cloud` arrives.
- **3–8s:** Open it.
- **Captions:** "You hear first." → "Not your customer's auditor."
- **Note:** use a throwaway inbox for the recording. Your real inbox has other
  people's names in it.

### 6 · Answer a questionnaire *(Sam's Munich problem)*

- **Start on:** Questionnaires, a new questionnaire with ~15 pasted questions.
- **0–3s:** Click *Draft*.
- **3–15s:** Answers fill in. Some are marked as needing review.
- **15–20s:** Hold on one flagged answer.
- **Captions:** "Paste the questionnaire." → "It says which answers it can't back."
- **Before recording:** run it once and read the answers. This is AI output — if
  any drafted answer overclaims, it will be on screen, and the clip's whole point
  is that it doesn't.

---

## Tier 2 — shot lists

**7 · Access review.** Open an in-progress review → mark three people *keep*, one
*revoke* → complete → the evidence CSV appears. Captions: "Review who has
access." → "Signed and filed as evidence."

**8 · Policy.** Generate an Access Control policy → scroll the draft → approve.
Captions: "A draft in seconds." → "You edit and approve it."

**9 · Trust Center.** The public page, scrolled slowly, from a logged-out browser.
Caption: "Send prospects this, not a PDF."

**10 · 14-Day Sprint.** Getting started page, scroll through the days. Caption:
"A finishable path. Not 300 items."

**11 · Evidence.** Evidence page → open one file → show which requirements it
backs. Caption: "Every file, dated and linked."

**12 · Report.** Reports → the one-page snapshot → save as PDF. Caption: "One page
for your prospect."

## Tier 3

**13 · Co-Pilot.** Ask "What should I do this week?" — only record if the answer
is good on the recording workspace. **14 · Vendors & risks.** Scroll each
register. **15 · Activity log.** Scroll, then open one entry.

---

## Where each clip goes

| Place | Clips |
|---|---|
| Homepage, under the headline | 1 |
| Homepage, feature sections | 3, 6, 7, 9 |
| `/demo` | 1, 3, 4, 5 — alongside the interactive steps, so the page works without a click |
| LinkedIn posts, one clip each | 2 (once fixed), 4, 6 |
| After a sales call | Tier 1 stitched into one 60–90s cut |

---

## Order of work

1. Fix the framework-add gap
2. Seed the recording workspace
3. Record tier 1 (clips 1, 3, 4, 5, 6 — then 2 once fixed)
4. Put clip 1 on the homepage and clips 1, 3, 4, 5 on `/demo`
5. Record tier 2 as the site's feature sections get built
