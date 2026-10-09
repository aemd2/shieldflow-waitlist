import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

/**
 * How ShieldFlow reaches a customer's AWS account.
 *
 * Preferred: a read-only role in the customer's account that ShieldFlow assumes
 * with a per-workspace External ID — no customer key is ever stored, the session
 * lasts 15 minutes, and it shows up in the customer's own CloudTrail under
 * "ShieldFlow-…". ShieldFlow's side is one IAM user whose only permission is
 * sts:AssumeRole (docs/AWS_SETUP.md); its key lives in the server environment.
 *
 * Legacy: an access key the customer pasted. Still works, shown with an
 * "upgrade to role" note.
 */
export type AwsAuth =
  | { kind: "role"; roleArn: string; externalId: string; sessionName: string }
  | { kind: "key"; accessKeyId: string; secretAccessKey: string };

export interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export class AwsAccessError extends Error {
  constructor(
    public kind: "auth" | "not_configured" | "unavailable",
    public userMessage: string,
  ) {
    super(userMessage);
    this.name = "AwsAccessError";
  }
}

/** The role name every customer creates — fixed so ShieldFlow's own permission can be this narrow. */
export const ROLE_NAME = "ShieldFlowAudit";

export const ROLE_ARN_RE = /^arn:aws:iam::(\d{12}):role\/(?:[\w+=,.@-]+\/)*[\w+=,.@-]{1,64}$/;

/** ShieldFlow's scanner identity, from the server environment. */
function scannerKey(): AwsCreds | null {
  const accessKeyId = process.env.SHIELDFLOW_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.SHIELDFLOW_AWS_SECRET_ACCESS_KEY?.trim();
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}

/** True once the owner setup in docs/AWS_SETUP.md is done. */
export function roleConnectAvailable(): boolean {
  return Boolean(scannerKey() && scannerAccountId());
}

/** The account customers' roles must trust. */
export function scannerAccountId(): string | null {
  const id = process.env.SHIELDFLOW_AWS_ACCOUNT_ID?.trim();
  return id && /^\d{12}$/.test(id) ? id : null;
}

/** RoleSessionName allows [\w+=,.@-], max 64. */
export function sessionNameFor(companyId: string): string {
  return `ShieldFlow-${companyId.replace(/[^\w]/g, "").slice(0, 12)}`;
}

const STS_REGION = "us-east-1";

function errorName(err: unknown): string {
  return (err as { name?: string })?.name ?? "";
}

/** Short-lived credentials for one scan. */
export async function credentialsFor(auth: AwsAuth): Promise<AwsCreds> {
  if (auth.kind === "key") {
    return { accessKeyId: auth.accessKeyId, secretAccessKey: auth.secretAccessKey };
  }
  const scanner = scannerKey();
  if (!scanner) {
    throw new AwsAccessError(
      "not_configured",
      "Role-based AWS connections aren't set up on this ShieldFlow server yet.",
    );
  }
  const sts = new STSClient({ region: STS_REGION, credentials: scanner, maxAttempts: 2 });
  try {
    const res = await sts.send(
      new AssumeRoleCommand({
        RoleArn: auth.roleArn,
        RoleSessionName: auth.sessionName,
        ExternalId: auth.externalId,
        DurationSeconds: 900,
      }),
    );
    const c = res.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey) {
      throw new AwsAccessError("unavailable", "AWS returned no credentials for the role. Try again.");
    }
    return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
  } catch (err) {
    if (err instanceof AwsAccessError) throw err;
    if (/AccessDenied|InvalidClientTokenId|NoSuchEntity/i.test(errorName(err))) {
      throw new AwsAccessError(
        "auth",
        "ShieldFlow couldn't assume this role. Check the role exists, is named " +
          `${ROLE_NAME}, and trusts ShieldFlow with your External ID — the CloudFormation ` +
          "link and the Terraform snippet set both.",
      );
    }
    throw new AwsAccessError("unavailable", "Couldn't reach AWS. Please try again.");
  }
}

/** The account the credentials belong to (needs no permissions). */
export async function callerAccount(creds: AwsCreds): Promise<string> {
  const sts = new STSClient({ region: STS_REGION, credentials: creds, maxAttempts: 2 });
  try {
    const res = await sts.send(new GetCallerIdentityCommand({}));
    if (!res.Account) throw new Error("no account");
    return res.Account;
  } catch (err) {
    if (/InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient|ExpiredToken/i.test(errorName(err))) {
      throw new AwsAccessError("auth", "AWS rejected these credentials.");
    }
    throw new AwsAccessError("unavailable", "Couldn't reach AWS. Please try again.");
  }
}
