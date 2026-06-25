// Server-side AWS helpers (plain fetch + node:crypto SigV4 — no SDK, mirrors
// lib/github.ts). Reads account security posture from the IAM/STS query APIs
// using a read-only access key the user pastes. Global endpoints, us-east-1.

import { createHash, createHmac } from "crypto";

const REGION = "us-east-1";

export class AwsError extends Error {
  constructor(
    public kind: "auth" | "forbidden" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "AwsError";
  }
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

// AWS SigV4 signing-key derivation: HMAC chain from "AWS4"+secret through
// date → region → service → "aws4_request".
function signingKey(secret: string, date: string, service: string): Buffer {
  const kDate = hmac("AWS4" + secret, date);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * Make a SigV4-signed POST to an AWS query API (form-encoded body like
 * "Action=GetAccountSummary&Version=2010-05-08"). Returns the raw Response.
 */
async function awsQuery(
  service: "iam" | "sts",
  host: string,
  body: string,
  keyId: string,
  secret: string,
): Promise<Response> {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8); // YYYYMMDD
  const contentType = "application/x-www-form-urlencoded";

  // Canonical headers must be lowercase, trimmed, and sorted alphabetically.
  const canonicalHeaders =
    `content-type:${contentType}\n` + `host:${host}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";

  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join("\n");

  const scope = `${dateStamp}/${REGION}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = hmac(signingKey(secret, dateStamp, service), stringToSign).toString("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    return await fetch(`https://${host}/`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "X-Amz-Date": amzDate,
        Authorization: authorization,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AwsError("unavailable", "Couldn't reach AWS. Please try again.");
  }
}

function xmlError(body: string): { code: string; message: string } {
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? "";
  const message = /<Message>([^<]+)<\/Message>/.exec(body)?.[1] ?? "";
  return { code, message };
}

// Maps an AWS error response to a friendly AwsError. `kind=auth` for bad keys
// (so the caller can flag the integration as needing reconnect).
function throwAwsError(status: number, body: string): never {
  const { code } = xmlError(body);
  if (
    status === 403 &&
    /InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient|InvalidAccessKeyId|AuthFailure/i.test(
      code,
    )
  ) {
    throw new AwsError("auth", "AWS rejected these credentials. Check the access key and secret.");
  }
  if (status === 403 || /AccessDenied/i.test(code)) {
    throw new AwsError(
      "forbidden",
      "These credentials work but lack read permissions. Attach the AWS-managed IAMReadOnlyAccess policy to the IAM user.",
    );
  }
  throw new AwsError("unavailable", "AWS is unavailable right now. Try again shortly.");
}

/** Validate a pasted access key via STS GetCallerIdentity (needs no permissions). Returns the account ID. */
export async function validateCredentials(keyId: string, secret: string): Promise<string> {
  const res = await awsQuery(
    "sts",
    "sts.amazonaws.com",
    "Action=GetCallerIdentity&Version=2011-06-15",
    keyId,
    secret,
  );
  const body = await res.text();
  if (!res.ok) throwAwsError(res.status, body);
  const account = /<Account>(\d+)<\/Account>/.exec(body)?.[1];
  if (!account) throw new AwsError("unavailable", "Unexpected response from AWS. Try again.");
  return account;
}

export interface AwsPasswordPolicy {
  minimumLength: number | null;
  requireSymbols: boolean;
  requireNumbers: boolean;
  requireUppercase: boolean;
  requireLowercase: boolean;
  maxPasswordAge: number | null;
  reusePrevention: number | null;
}

export interface AccountSecurityReport {
  accountId: string;
  rootMfaEnabled: boolean;
  users: number;
  mfaDevices: number;
  mfaDevicesInUse: number;
  // null = no IAM password policy is set (itself a finding for SOC 2 / CIS).
  passwordPolicy: AwsPasswordPolicy | null;
}

function summaryValue(body: string, key: string): number {
  const re = new RegExp(`<key>${key}</key>\\s*<value>(-?\\d+)</value>`);
  const m = re.exec(body);
  return m ? Number(m[1]) : 0;
}

function policyBool(body: string, field: string): boolean {
  return new RegExp(`<${field}>true</${field}>`, "i").test(body);
}

function policyNum(body: string, field: string): number | null {
  const m = new RegExp(`<${field}>(\\d+)</${field}>`, "i").exec(body);
  return m ? Number(m[1]) : null;
}

/** Pull account-level security posture: root MFA, user/MFA counts, password policy. */
export async function fetchAccountSecurity(
  keyId: string,
  secret: string,
): Promise<AccountSecurityReport> {
  const accountId = await validateCredentials(keyId, secret);

  // GetAccountSummary
  const sumRes = await awsQuery(
    "iam",
    "iam.amazonaws.com",
    "Action=GetAccountSummary&Version=2010-05-08",
    keyId,
    secret,
  );
  const sumBody = await sumRes.text();
  if (!sumRes.ok) throwAwsError(sumRes.status, sumBody);

  // GetAccountPasswordPolicy — NoSuchEntity (404) means no policy is configured.
  const polRes = await awsQuery(
    "iam",
    "iam.amazonaws.com",
    "Action=GetAccountPasswordPolicy&Version=2010-05-08",
    keyId,
    secret,
  );
  const polBody = await polRes.text();
  let passwordPolicy: AwsPasswordPolicy | null = null;
  if (polRes.ok) {
    passwordPolicy = {
      minimumLength: policyNum(polBody, "MinimumPasswordLength"),
      requireSymbols: policyBool(polBody, "RequireSymbols"),
      requireNumbers: policyBool(polBody, "RequireNumbers"),
      requireUppercase: policyBool(polBody, "RequireUppercaseCharacters"),
      requireLowercase: policyBool(polBody, "RequireLowercaseCharacters"),
      maxPasswordAge: policyNum(polBody, "MaxPasswordAge"),
      reusePrevention: policyNum(polBody, "PasswordReusePrevention"),
    };
  } else if (!/NoSuchEntity/i.test(polBody)) {
    // A real failure (not just "no policy set") — surface it.
    throwAwsError(polRes.status, polBody);
  }

  return {
    accountId,
    rootMfaEnabled: summaryValue(sumBody, "AccountMFAEnabled") === 1,
    users: summaryValue(sumBody, "Users"),
    mfaDevices: summaryValue(sumBody, "MFADevices"),
    mfaDevicesInUse: summaryValue(sumBody, "MFADevicesInUse"),
    passwordPolicy,
  };
}
