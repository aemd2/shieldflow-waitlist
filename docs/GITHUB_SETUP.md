# GitHub integration — owner setup and how it works

This is the one-time setup that turns on **"Install the GitHub App (read-only)"**
for customers, plus a map of what the GitHub integration does. Until it's done,
the GitHub card offers a fine-grained token instead (and, if the old OAuth app
is configured, "Connect with GitHub", which asks for the `repo` scope — read
*and write* to all code. The App replaces it).

---

## 1. One-time setup

**The quick way (one click):**

```bash
npx tsx scripts/github-app-setup.ts          # opens a page; click "Create GitHub App" on GitHub
npx tsx scripts/github-app-check.ts          # confirms the keys work and lists installations
npx tsx scripts/github-app-setup.ts --vercel # copies the five keys into Vercel (CLI logged in)
```

The script posts the App's definition (below) to GitHub as a manifest, gets the
keys back from GitHub directly and writes them to `.env.local` and
`.env.github-app.local` (both git-ignored). Nothing is copied by hand.

**By hand (≈ 10 minutes, in ShieldFlow's own GitHub account):**

1. GitHub → your organisation (or personal) **Settings → Developer settings →
   GitHub Apps → New GitHub App**.
2. **Name**: `ShieldFlow` (the slug GitHub gives it, e.g. `shieldflow`, goes in
   `GITHUB_APP_SLUG`).
3. **Homepage URL**: `https://<your domain>/checks/github`.
4. **Callback URL**: `https://<your domain>/api/integrations/github/app/callback`
   and tick **Request user authorization (OAuth) during installation**. This is
   what proves who installed it: the callback exchanges the one-time code and
   only saves an installation the installer can actually see.
5. **Setup URL**: leave empty. **Webhook**: untick *Active* (we poll daily).
6. **Permissions** — every one **Read-only**, nothing else:

   | Repository permissions | Organization permissions |
   |---|---|
   | Metadata | Members |
   | Administration | Administration |
   | Pull requests | |
   | Dependabot alerts | |
   | Secret scanning alerts | |
   | Code scanning alerts | |

   **Not** Contents — ShieldFlow never reads code.
7. **Where can this GitHub App be installed?** → *Any account*.
8. Create it. Then on the App's page:
   - copy **App ID** → `GITHUB_APP_ID`;
   - copy **Client ID** → `GITHUB_APP_CLIENT_ID`;
   - **Generate a new client secret** → `GITHUB_APP_CLIENT_SECRET`;
   - **Generate a private key** (downloads a `.pem`) → paste its contents into
     `GITHUB_APP_PRIVATE_KEY` (newlines may be written as `\n`).
9. Put the five values in Vercel (Production + Preview) and `.env.local`, then
   redeploy. Don't paste them anywhere else.

Local testing needs its own App (callback `http://localhost:3001/...`), or set
the production App's callback temporarily.

---

## 2. What the customer does

Integrations → GitHub → **Install the GitHub App (read-only)** → GitHub shows the
exact permissions → they pick the organisation and the repositories → back on
`/integrations/github`, **Scan now**. Customers who connected with a token see a
note offering the switch.

---

## 3. What a scan does

`lib/integrations/github/` — the same shape as AWS:

| File | Does |
|---|---|
| `client.ts` | App JWT (RS256), 1-hour installation token per scan, paging, GraphQL, time budget |
| `collect.ts` | Reads repositories, protection (classic **and** rulesets), Dependabot switch, write deploy keys, merged PRs + reviews (GraphQL), org 2FA requirement, members, owners, outside collaborators, Dependabot / secret / code-scanning alerts |
| `evaluate.ts` | Pure: posture → 16 checks. Anything unread is *can't tell*, never pass |
| `catalog.ts` | Titles, why, severity, control codes, API calls, fixes (Terraform ruleset, `gh` CLI, UI) |
| `scan.ts` | Collect → evaluate → match people → store the merged-PR population (`code_changes`) → save `integrations.last_scan` |
| `checks.cases.ts` | `npx tsx lib/integrations/github/checks.cases.ts` — the must-not-pass cases |

Every sync also files two CSVs as evidence: the security report, and the day's
**merged changes** on *Track every production change* (the CC8.1 sample).

Out of scope: a repository topic `shieldflow-out-of-scope`, or "Mark out of
scope" on any resource with a reason (kept as evidence). An unreviewed merge
can be accepted as an emergency change from the Changes tab.

People: members are matched to Personnel by public email, name, or a handle
that fits exactly one person. Anyone else can be linked once ("this is…",
stored in `identity_links`) or marked "not a person". The leaver and
unknown-account checks use that.
