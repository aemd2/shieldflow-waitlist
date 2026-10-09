# AWS integration — owner setup and how it works

This is the one-time setup that turns on **"Connect with a read-only role"** for
customers, plus a map of what the AWS integration does. Until the setup is done,
the Connect AWS screen still offers the access-key fallback, and the role option
says it isn't available yet.

---

## 1. One-time setup (≈ 15 minutes, in ShieldFlow's own AWS account)

Customers create a role called `ShieldFlowAudit` in *their* account that trusts
*ShieldFlow's* AWS account. ShieldFlow then assumes that role for 15 minutes per
scan. For that, ShieldFlow needs a tiny identity of its own that can do nothing
except assume those roles.

### 1a. The scanner user

In ShieldFlow's AWS account (not a customer's):

1. IAM → Users → **Create user** `shieldflow-scanner`. No console access.
2. Attach this inline policy, and nothing else:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "sts:AssumeRole",
         "Resource": "arn:aws:iam::*:role/ShieldFlowAudit"
       }
     ]
   }
   ```

3. Security credentials → **Create access key** (use case: application running
   outside AWS). Copy the key ID and secret straight into Vercel (next step).
   Don't paste them anywhere else.

Even if this key leaked, it can only assume roles that a customer has created
*and* that trust ShieldFlow's account *and* that are called with that
customer's secret External ID. It cannot read anything by itself.

### 1b. Vercel environment variables (Production)

| Variable | Value |
|---|---|
| `SHIELDFLOW_AWS_ACCESS_KEY_ID` | the scanner user's key ID |
| `SHIELDFLOW_AWS_SECRET_ACCESS_KEY` | the scanner user's secret |
| `SHIELDFLOW_AWS_ACCOUNT_ID` | ShieldFlow's 12-digit AWS account ID (shown to customers so their role can trust it) |
| `SHIELDFLOW_AWS_TEMPLATE_URL` | the S3 URL of the role template (step 1c) — enables the one-click CloudFormation link |
| `CRON_SECRET` | already set; the daily sync dispatcher uses it to call one worker per workspace |

Redeploy after adding them.

### 1c. The CloudFormation template in S3

CloudFormation's quick-create link only accepts templates hosted in S3.

1. Download the template the app serves:
   `https://shieldflow.cloud/api/aws/role-template` → save as
   `shieldflow-audit-role-v1.yaml`.
2. Create a bucket (e.g. `shieldflow-public-templates`, region `us-east-1`).
   Allow public reads for this one bucket only (bucket-level Block Public Access
   off; keep the account-level setting on for everything else).
3. Upload the file and add a bucket policy allowing `s3:GetObject` on
   `arn:aws:s3:::shieldflow-public-templates/*` for `"Principal": "*"`.
4. Set `SHIELDFLOW_AWS_TEMPLATE_URL` to
   `https://shieldflow-public-templates.s3.amazonaws.com/shieldflow-audit-role-v1.yaml`.

When the template changes (`TEMPLATE_VERSION` in `app/lib/aws/role.ts`), upload
it under a new file name and update the variable. Customers on an older version
keep working: anything their role can't read shows as "can't tell — the role
isn't allowed X", never as a pass.

---

## 2. What customers do

1. **Integrations → AWS → Connect.** ShieldFlow shows an External ID (one per
   workspace) and three ways to create the role, all generated from
   `app/lib/aws/role.ts` so they can't disagree: CloudFormation (one click),
   Terraform, AWS CLI.
2. Paste the role ARN, name the account ("prod"), choose whether it's in audit
   scope. ShieldFlow assumes the role once to check it works, then runs the
   first scan.
3. Repeat for other accounts. Staging and dev can be connected **out of scope**:
   scanned and shown, never alerted, never counted toward a framework.
4. Connect the account **IAM Identity Center is managed from** (usually the
   organisation's management account) to see who can reach production through
   Identity Center. It can be out of scope; its people still count.

The role is AWS's `SecurityAudit` policy, a short list of newer read calls, and
an explicit **Deny** on every call that would read data (objects, rows,
secrets, parameters, log lines, decrypt). In IAM a deny always wins. The public
page `/aws-checks` lists every check and the exact API calls behind it.

---

## 3. What a scan does

Daily (cron: one worker per workspace, each with its own time budget) and on
"Scan now":

| Area | What | Where it shows |
|---|---|---|
| Posture | 30+ checks across identity, logging, detection, internet exposure, encryption, patching (with the Extended Support $ it's costing), vulnerabilities, backups | AWS → Posture, controls, measures |
| People | Identity Center users with their permission sets (direct or via group) + IAM users; matched to Personnel → **leavers with AWS access**, **logins nobody knows** | AWS → People, Personnel, access reviews ("AWS (production accounts)") |
| Changes | Console and root write actions in production, from CloudTrail's free event history; kept beyond AWS's 90 days | AWS → Changes ("Record why…" per change) |
| Backups | Data stores and their backups; **restore tests** from AWS Backup restore jobs and RDS/DynamoDB restores in CloudTrail, remembered after AWS forgets them | AWS → Backups, "Back up and test restores" measure |
| Facts | Where data lives (region by region, EU or not), encryption, backups, logging, MFA, exposure — stated as true only when the checks pass | AWS → Facts, questionnaire drafts, Co-Pilot, supplier data sheet (CSV), Trust Center (opt-in) |

Only regions that hold resources are scanned. Anything that couldn't be read
(a missing permission, a region the budget ran out on, an account that failed)
makes a check "can't tell" with the reason. It never passes by default.

### Workspace settings (AWS → Posture → Settings, and AWS → Facts)

- **Keep audit logs at least N days** (default 365)
- **Test a restore at least every N days** (default 365)
- **Data residency promise**: none / the EU / Europe (EU + UK + Switzerland).
  When set, every data store and backup copy outside it fails `aws.data_residency`.
- **Show verified facts on the Trust Center** (default off). Only currently-true
  facts are published, dated; who has access is never published.

### Evidence filed automatically (on "Scan now", once a day)

- `aws-security-report-<date>.csv`: every check, failing resources
- `aws-asset-inventory-<date>.csv`: on "Keep an asset inventory"
- `aws-production-access-<date>.csv`: on "Grant least-privilege access"
- `aws-manual-changes-<date>.csv`: on "Track every production change" (when there were any)

Every sync also appends each check's verdict to `check_history`, the
day-by-day record a Type II audit period needs.

### Weekly email

Mondays, "This week in AWS": checks that started failing and got fixed since
last week, changes made by hand without a recorded reason, and the one fix to
do first.

---

## 4. Code map

| File | Role |
|---|---|
| `app/lib/aws/credentials.ts` | AssumeRole with External ID; legacy keys |
| `app/lib/aws/collect.ts` | read-only collectors (global + per active region) |
| `app/lib/aws/people.ts` | Identity Center + IAM users collector |
| `app/lib/aws/cloudtrail.ts` | console/root changes, native restore events |
| `app/lib/aws/evaluate.ts` | posture → verdicts (pure) |
| `app/lib/aws/roster.ts` | merge people across accounts, match to Personnel (pure) |
| `app/lib/aws/stores.ts`, `facts.ts` | data locations and customer-facing facts (pure) |
| `app/lib/aws/scan.ts` | per-account scan, carry-forward, workspace merge |
| `app/lib/aws/catalog.ts` | every check: why, API calls, Terraform/CLI/console fix |
| `app/lib/aws/role.ts` | the role in CloudFormation / Terraform / CLI |
| `app/lib/aws/checks.cases.ts` | verdict cases: `npx tsx lib/aws/checks.cases.ts` |
| `app/supabase/migrations/0052–0054` | accounts, exceptions, history, change events, Trust Center RPC |
