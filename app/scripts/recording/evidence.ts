/**
 * Evidence for the recording workspace: what a company that actually did the
 * work would have on file. Without it, every requirement credited by a measure
 * raises its own "Completed without evidence" alert and the sample company looks
 * like a mess on camera.
 *
 * Each document is uploaded once and attached to its measure, which makes it
 * evidence for every requirement the measure covers — the same thing a user does
 * from the Measures page. Documents for requirements that were marked complete by
 * hand, outside any measure, are attached to those requirements directly.
 *
 * Every document says, in its own footer, that it's a sample and the company is
 * fictional.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const SAMPLE_NOTE = "Sample evidence for the product recording — Northwind Analytics is not a real company.";

export function pdfPage(title: string, version: string, body: string) {
  return `<!doctype html><meta charset="utf-8"><style>
    body{font:12.5px/1.55 "Segoe UI",system-ui,sans-serif;color:#1f2937;margin:56px 64px}
    header{border-bottom:2px solid #0b1f3a;padding-bottom:14px;margin-bottom:22px}
    .co{color:#0b1f3a;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:11px}
    h1{font-size:24px;margin:6px 0 4px;color:#0b1f3a}
    .meta{color:#6b7280;font-size:11px}
    h2{font-size:14px;margin:20px 0 6px;color:#0b1f3a}
    footer{position:fixed;bottom:36px;left:64px;right:64px;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb;padding-top:8px}
  </style><header><div class="co">Northwind Analytics</div><h1>${title}</h1>
  <div class="meta">${version} · Owner: Daniel Weber, CTO · Classification: Internal</div></header>
  ${body}<footer>Sample document created for a product demonstration. Northwind Analytics is fictional.</footer>`;
}

/** A document supports every requirement its measure covers, plus any listed by
 *  code — for requirements this workspace had marked complete by hand earlier. */
type Doc = { measure?: string; codes?: string[]; file: string; kind: "pdf" | "csv"; content: string };

const DOCS: Doc[] = [
  {
    measure: "security-policies",
    codes: ["A.5.15"],
    file: "Information Security Policy v2.1.pdf",
    kind: "pdf",
    content: pdfPage("Information Security Policy", "Version 2.1 · Approved 2 June 2026", `
      <h2>1. Purpose</h2><p>Sets out how Northwind protects customer and company information, and who is accountable for it.</p>
      <h2>2. Scope</h2><p>All employees, contractors and systems that store or process Northwind or customer data.</p>
      <h2>3. Access</h2><p>Access is granted on least privilege, approved by the system owner, reviewed quarterly and removed within one business day of leaving.</p>
      <h2>4. Authentication</h2><p>Multi-factor authentication is required on every system that supports it. Passwords are held in the company password manager.</p>
      <h2>5. Data protection</h2><p>Customer data is encrypted in transit and at rest, as set out in the Encryption Standard.</p>
      <h2>6. Incidents</h2><p>Suspected incidents are reported immediately and handled under the Incident Response Plan.</p>
      <h2>7. Review</h2><p>This policy is reviewed at least once a year and whenever something material changes.</p>`),
  },
  {
    measure: "incident-response-plan",
    file: "Incident Response Plan v1.3.pdf",
    kind: "pdf",
    content: pdfPage("Incident Response Plan", "Version 1.3 · Last tested 15 July 2026", `
      <h2>Roles</h2><p>Incident lead: Head of Platform. Communications: Head of Sales. Executive: CTO.</p>
      <h2>Severity</h2><p>SEV1 customer data exposed or service down · SEV2 service degraded · SEV3 internal only.</p>
      <h2>Phases</h2><p>Detect, contain, eradicate, recover, review. Customers are told of a SEV1 within 24 hours, and regulators wherever the law requires it.</p>
      <h2>Exercises</h2><p>A tabletop exercise runs twice a year. The July 2026 exercise simulated a leaked cloud credential.</p>`),
  },
  {
    measure: "vendor-contracts",
    file: "Supplier Security Terms v1.0.pdf",
    kind: "pdf",
    content: pdfPage("Supplier Security Terms", "Version 1.0 · Adopted 3 March 2026", `
      <h2>Confidentiality</h2><p>Suppliers keep Northwind and customer data confidential and use it only to provide the service.</p>
      <h2>Security</h2><p>Suppliers maintain controls equivalent to ISO 27001 or SOC 2 and provide evidence on request.</p>
      <h2>Breach notice</h2><p>Suppliers tell Northwind within 48 hours of any incident affecting our data.</p>
      <h2>Sub-processors</h2><p>Any new sub-processor needs 30 days of notice.</p>`),
  },
  {
    measure: "encrypt-at-rest",
    file: "Encryption Standard v1.2.pdf",
    kind: "pdf",
    content: pdfPage("Encryption Standard", "Version 1.2 · Approved 20 May 2026", `
      <h2>At rest</h2><p>Production databases and object storage use AES-256, with keys held in AWS KMS. Laptops use full-disk encryption.</p>
      <h2>In transit</h2><p>TLS 1.2 or higher on every public endpoint. Plain HTTP redirects to HTTPS.</p>
      <h2>Keys</h2><p>Customer-data keys rotate yearly. Access to KMS is limited to two named engineers.</p>`),
  },
  {
    measure: "asset-inventory",
    file: "asset-inventory-2026-09.csv",
    kind: "csv",
    content: [
      "asset_id,type,name,owner,location,classification",
      "A-001,Cloud account,Production AWS account,Sam Okafor,eu-west-1,Restricted",
      "A-002,Database,Customer Postgres,Amara Osei,eu-west-1,Restricted",
      "A-003,Object storage,Customer exports,Amara Osei,eu-west-1,Restricted",
      "A-004,Source code,GitHub organisation,Daniel Weber,SaaS,Confidential",
      "A-005,Identity,Google Workspace,Ellen Byrne,SaaS,Confidential",
      "A-006,Laptop,Laptop - Sam Okafor,Sam Okafor,Remote,Confidential",
      "A-007,Laptop,Laptop - Amara Osei,Amara Osei,Remote,Confidential",
    ].join("\n"),
  },
  {
    measure: "incident-log",
    file: "incident-log-2026.csv",
    kind: "csv",
    content: [
      "date,id,severity,summary,status,root_cause",
      "2026-02-11,INC-014,SEV3,Phishing email reported by staff; nobody clicked,Closed,External phishing campaign",
      "2026-05-02,INC-015,SEV2,API latency above target for 40 minutes,Closed,Database connection pool exhausted",
      "2026-07-15,INC-016,SEV3,Tabletop exercise: leaked cloud credential,Closed,Exercise - no real impact",
    ].join("\n"),
  },
  {
    measure: "vendor-reviews",
    file: "vendor-review-log-2026.csv",
    kind: "csv",
    content: [
      "vendor,reviewed_on,reviewer,soc2_report,risk,next_review",
      "Amazon Web Services,2026-03-10,Sam Okafor,On file,Critical,2027-03-10",
      "GitHub,2026-03-12,Daniel Weber,On file,High,2027-03-12",
      "Google Workspace,2026-03-12,Ellen Byrne,On file,High,2027-03-12",
      "Slack,2026-04-02,Ellen Byrne,On file,Medium,2027-04-02",
      "Stripe,2026-04-20,Julia Novak,Requested,High,2026-10-20",
    ].join("\n"),
  },
  {
    measure: "data-inventory",
    file: "data-inventory-2026-09.csv",
    kind: "csv",
    content: [
      "dataset,system,classification,owner,retention,flows_to",
      "Customer accounts,Postgres,Restricted,Amara Osei,Contract plus 30 days,Stripe (billing)",
      "Usage events,Postgres,Confidential,Ravi Patel,13 months,None",
      "Customer exports,Object storage,Restricted,Amara Osei,30 days,Customer only",
      "Staff records,Google Workspace,Confidential,Ellen Byrne,Employment plus 6 years,None",
    ].join("\n"),
  },
  {
    measure: "mfa",
    file: "Password and MFA Standard v1.0.pdf",
    kind: "pdf",
    content: pdfPage("Password and MFA Standard", "Version 1.0 · Approved 2 June 2026", `
      <h2>Multi-factor authentication</h2><p>Required on Google Workspace, AWS, GitHub and Stripe. Enforced at the identity provider, not left to each person.</p>
      <h2>Passwords</h2><p>Generated and stored in the company password manager. Shared credentials live in shared vaults, never in chat or documents.</p>
      <h2>Lost devices</h2><p>Report within one hour. Sessions are revoked and second factors re-enrolled.</p>`),
  },
  {
    codes: ["A.5.7", "A.8.8", "A.8.9"],
    file: "Vulnerability and Configuration Management v1.1.pdf",
    kind: "pdf",
    content: pdfPage("Vulnerability and Configuration Management", "Version 1.1 · Approved 20 May 2026", `
      <h2>Threat information</h2><p>The platform team follows vendor advisories for every system in the asset inventory and reviews them weekly.</p>
      <h2>Scanning</h2><p>Dependencies are scanned on every pull request. Container images are scanned before deploy.</p>
      <h2>Fix times</h2><p>Critical: 7 days · High: 30 days · Medium: 90 days.</p>
      <h2>Configuration</h2><p>Infrastructure is defined as code and changed only through reviewed pull requests.</p>`),
  },
  {
    codes: ["A.8.28"],
    file: "Secure Development Standard v1.0.pdf",
    kind: "pdf",
    content: pdfPage("Secure Development Standard", "Version 1.0 · Approved 20 May 2026", `
      <h2>Reviews</h2><p>Every change to production code is reviewed by a second engineer before merge. Main is protected.</p>
      <h2>Secrets</h2><p>No secrets in code. Pushes are scanned for keys, and anything found is rotated.</p>
      <h2>Dependencies</h2><p>Scanned on every pull request; see the Vulnerability and Configuration Management standard for fix times.</p>
      <h2>Training</h2><p>Engineers complete secure-coding training when they join and yearly after that.</p>`),
  },
  {
    codes: ["A.7.1", "A.8.1"],
    file: "Remote Work and Device Policy v1.0.pdf",
    kind: "pdf",
    content: pdfPage("Remote Work and Device Policy", "Version 1.0 · Approved 2 June 2026", `
      <h2>Premises</h2><p>Northwind has no office holding customer data. Production runs in AWS data centres, covered by AWS's own certifications.</p>
      <h2>Laptops</h2><p>Company laptops only, with full-disk encryption, automatic updates and a screen lock after five minutes.</p>
      <h2>Working in public</h2><p>No customer data on screen in public places. Use a trusted network.</p>`),
  },
  {
    codes: ["A.8.13"],
    file: "Backup Standard v1.0.pdf",
    kind: "pdf",
    content: pdfPage("Backup Standard", "Version 1.0 · Approved 20 May 2026", `
      <h2>What is backed up</h2><p>The customer database, daily, with point-in-time recovery for 35 days. Object storage is versioned.</p>
      <h2>Where</h2><p>Encrypted snapshots are copied to a second AWS region.</p>
      <h2>Restore testing</h2><p>A full restore drill is scheduled for Q4 2026 and tracked on the risk register until it has been done.</p>`),
  },
  {
    codes: ["A.8.15", "A.8.16"],
    file: "Logging and Monitoring Standard v1.0.pdf",
    kind: "pdf",
    content: pdfPage("Logging and Monitoring Standard", "Version 1.0 · Approved 20 May 2026", `
      <h2>What is logged</h2><p>Sign-ins, admin actions, API access and infrastructure changes.</p>
      <h2>Retention</h2><p>Logs are kept for 12 months and cannot be edited by the engineers they record.</p>
      <h2>Alerting</h2><p>Unusual sign-ins and changes to production access page the on-call engineer.</p>`),
  },
  {
    codes: ["A.6.3"],
    file: "security-training-2026.csv",
    kind: "csv",
    content: [
      "name,course,completed_on",
      "Sam Okafor,Security awareness 2026,2026-02-03",
      "Daniel Weber,Security awareness 2026,2026-02-03",
      "Amara Osei,Security awareness 2026,2026-02-04",
      "Lukas Brandt,Security awareness 2026,2026-02-05",
      "Sofia Marín,Security awareness 2026,2026-02-05",
      "Tom Hughes,Security awareness 2026,2026-02-06",
      "Mei Chen,Security awareness 2026,2026-02-06",
      "Omar Haddad,Security awareness 2026,2026-02-09",
      "Julia Novak,Security awareness 2026,2026-02-09",
      "Ravi Patel,Security awareness 2026,2026-02-10",
      "Ellen Byrne,Security awareness 2026,2026-02-10",
      "Noah Kim,Security awareness 2026,2026-03-04",
    ].join("\n"),
  },
];

export async function seedEvidence(
  db: SupabaseClient,
  companyId: string,
  userId: string,
  log: (s: string) => void,
) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  let rows = 0;
  let removed = 0;
  try {
    for (const doc of DOCS) {
      let body: Buffer;
      if (doc.kind === "pdf") {
        await page.setContent(doc.content, { waitUntil: "load" });
        body = await page.pdf({ format: "A4", printBackground: true });
      } else {
        body = Buffer.from(doc.content, "utf8");
      }
      const mime = doc.kind === "pdf" ? "application/pdf" : "text/csv";
      const storagePath = `${companyId}/sample/${doc.file.replace(/\s+/g, "-").toLowerCase()}`;
      const { error: upErr } = await db.storage
        .from("evidence").upload(storagePath, body, { contentType: mime, upsert: true });
      if (upErr) throw new Error(`upload ${doc.file}: ${upErr.message}`);

      const row = {
        company_id: companyId,
        file_name: doc.file,
        storage_path: storagePath,
        mime_type: mime,
        size_bytes: body.length,
        note: SAMPLE_NOTE,
        uploaded_by: userId,
      };
      const { data: have } = await db
        .from("evidence").select("id, control_id, measure_id").eq("company_id", companyId).eq("storage_path", storagePath);

      // A measure's document goes on the measure, once: it's then evidence for
      // every requirement the measure covers (migration 0051).
      let measureId: string | null = null;
      if (doc.measure) {
        const { data: m } = await db.from("measures").select("id").eq("key", doc.measure).single();
        measureId = m!.id as string;
        if (!(have ?? []).some((e) => e.measure_id === measureId)) {
          const { error } = await db.from("evidence").insert({ ...row, measure_id: measureId });
          if (error) throw new Error(`evidence for ${doc.file}: ${error.message}`);
          rows += 1;
        }
      }

      // Requirements named by code were marked complete by hand, outside any
      // measure: those get the document attached directly.
      const byCode: string[] = [];
      if (doc.codes) {
        const { data: ctl } = await db.from("controls").select("id").in("code", doc.codes);
        const { data: mine } = await db.from("control_status").select("control_id").eq("company_id", companyId)
          .in("control_id", (ctl ?? []).map((c) => c.id as string));
        byCode.push(...(mine ?? []).map((c) => c.control_id as string));
      }
      const direct = new Set((have ?? []).map((e) => e.control_id as string | null).filter(Boolean));
      const toAdd = byCode.filter((id) => !direct.has(id));
      if (toAdd.length) {
        const { error } = await db.from("evidence").insert(toAdd.map((controlId) => ({ ...row, control_id: controlId })));
        if (error) throw new Error(`evidence rows for ${doc.file}: ${error.message}`);
        rows += toAdd.length;
      }

      // Earlier seeds copied a measure's document onto each requirement one by
      // one — the very chore measure evidence removes. Drop those copies.
      const stale = (have ?? []).filter((e) => e.control_id && !byCode.includes(e.control_id as string));
      if (stale.length) {
        await db.from("evidence").delete().in("id", stale.map((e) => e.id as string));
        removed += stale.length;
      }
    }
  } finally {
    await browser.close();
  }
  log(`${DOCS.length} evidence documents → ${rows} added${removed ? `, ${removed} per-requirement copies replaced` : ""}`);
}
