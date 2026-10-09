import { ROLE_NAME } from "@/lib/aws/credentials";
import { AWS_CHECKS } from "@/lib/aws/catalog";

/**
 * The read-only role a customer creates, in the three forms they might want it —
 * CloudFormation (one click), Terraform (how they manage everything else), AWS
 * CLI — generated from this one file so they can never disagree.
 *
 * Permissions: the AWS-managed `SecurityAudit` policy (read-only security
 * configuration across services), a small inline policy for the newer read calls
 * SecurityAudit may not cover yet, and an explicit Deny on every call that would
 * read customer data. Deny always wins in IAM, so even if AWS widens
 * SecurityAudit one day, ShieldFlow still can't read an object, a row, a secret or
 * a log line.
 */

export const TEMPLATE_VERSION = 1;

/** Newer or less common read calls the scanner makes, kept explicit. */
export const EXTRA_READ_ACTIONS = [
  "eks:DescribeClusterVersions",
  "inspector2:BatchGetAccountStatus",
  "inspector2:ListFindingAggregations",
  "lambda:ListFunctionUrlConfigs",
  "ecr:DescribeImages",
  "ecr:DescribeRepositories",
  "dynamodb:DescribeContinuousBackups",
  "rds:DescribeDBMajorEngineVersions",
  "cloudtrail:LookupEvents",
  "backup:ListBackupPlans",
  "backup:ListProtectedResources",
  "backup:ListRestoreJobs",
  "backup:ListRestoreTestingPlans",
  "backup:ListCopyJobs",
  "identitystore:ListUsers",
  "identitystore:ListGroups",
  "identitystore:ListGroupMemberships",
  "sso:ListInstances",
  "sso:ListPermissionSets",
  "sso:DescribePermissionSet",
  "sso:ListAccountAssignments",
  "sso:ListPermissionSetsProvisionedToAccount",
  "sso:ListManagedPoliciesInPermissionSet",
  "sso:GetInlinePolicyForPermissionSet",
  "sso:ListAccountsForProvisionedPermissionSet",
  "organizations:DescribeOrganization",
  "organizations:ListAccounts",
];

/** Calls that would read customer data. Denied explicitly, whatever else allows. */
export const DENIED_DATA_ACTIONS = [
  "s3:GetObject",
  "s3:GetObjectVersion",
  "dynamodb:GetItem",
  "dynamodb:BatchGetItem",
  "dynamodb:Query",
  "dynamodb:Scan",
  "rds-data:*",
  "secretsmanager:GetSecretValue",
  "ssm:GetParameter",
  "ssm:GetParameters",
  "ssm:GetParametersByPath",
  "kms:Decrypt",
  "lambda:GetFunction",
  "logs:GetLogEvents",
  "logs:FilterLogEvents",
  "ecr:GetDownloadUrlForLayer",
  "ecr:BatchGetImage",
  "athena:GetQueryResults",
];

/** Every read action the scanner makes, deduplicated — for the public catalogue. */
export function allReadActions(): string[] {
  return [...new Set([...AWS_CHECKS.flatMap((c) => c.apiCalls), ...EXTRA_READ_ACTIONS])].sort();
}

const yamlList = (items: string[], indent: number) => items.map((a) => `${" ".repeat(indent)}- ${a}`).join("\n");
const hclList = (items: string[], indent: number) => items.map((a) => `${" ".repeat(indent)}"${a}",`).join("\n");

/** The CloudFormation template (parameters filled at stack creation). */
export function cloudFormationTemplate(): string {
  return `AWSTemplateFormatVersion: "2010-09-09"
Description: >
  ShieldFlow read-only audit role (template v${TEMPLATE_VERSION}). SecurityAudit plus a
  few newer read calls, with an explicit deny on reading any customer data.
Parameters:
  ShieldFlowAccountId:
    Type: String
    AllowedPattern: "[0-9]{12}"
    Description: ShieldFlow's AWS account (shown on the Connect AWS screen)
  ExternalId:
    Type: String
    MinLength: 16
    Description: Your workspace's External ID (shown on the Connect AWS screen)
Resources:
  ShieldFlowAuditRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: ${ROLE_NAME}
      MaxSessionDuration: 3600
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              AWS: !Sub "arn:aws:iam::\${ShieldFlowAccountId}:root"
            Action: sts:AssumeRole
            Condition:
              StringEquals:
                sts:ExternalId: !Ref ExternalId
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/SecurityAudit
      Policies:
        - PolicyName: ShieldFlowAuditExtras
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Sid: ReadOnlyExtras
                Effect: Allow
                Action:
${yamlList(EXTRA_READ_ACTIONS, 18)}
                Resource: "*"
              - Sid: NeverReadCustomerData
                Effect: Deny
                Action:
${yamlList(DENIED_DATA_ACTIONS, 18)}
                Resource: "*"
Outputs:
  RoleArn:
    Description: Paste this into ShieldFlow
    Value: !GetAtt ShieldFlowAuditRole.Arn
`;
}

export function terraformSnippet(scannerAccountId: string, externalId: string): string {
  return `# ShieldFlow read-only audit role (template v${TEMPLATE_VERSION})
resource "aws_iam_role" "shieldflow_audit" {
  name                 = "${ROLE_NAME}"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${scannerAccountId}:root" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "sts:ExternalId" = "${externalId}" } }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "shieldflow_security_audit" {
  role       = aws_iam_role.shieldflow_audit.name
  policy_arn = "arn:aws:iam::aws:policy/SecurityAudit"
}

resource "aws_iam_role_policy" "shieldflow_extras" {
  name = "ShieldFlowAuditExtras"
  role = aws_iam_role.shieldflow_audit.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadOnlyExtras"
        Effect   = "Allow"
        Resource = "*"
        Action = [
${hclList(EXTRA_READ_ACTIONS, 10)}
        ]
      },
      {
        Sid      = "NeverReadCustomerData"
        Effect   = "Deny"
        Resource = "*"
        Action = [
${hclList(DENIED_DATA_ACTIONS, 10)}
        ]
      },
    ]
  })
}

output "shieldflow_role_arn" {
  value = aws_iam_role.shieldflow_audit.arn
}
`;
}

export function cliCommands(scannerAccountId: string, externalId: string): string {
  const trust = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: `arn:aws:iam::${scannerAccountId}:root` },
        Action: "sts:AssumeRole",
        Condition: { StringEquals: { "sts:ExternalId": externalId } },
      },
    ],
  });
  const extras = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      { Sid: "ReadOnlyExtras", Effect: "Allow", Resource: "*", Action: EXTRA_READ_ACTIONS },
      { Sid: "NeverReadCustomerData", Effect: "Deny", Resource: "*", Action: DENIED_DATA_ACTIONS },
    ],
  });
  return `aws iam create-role --role-name ${ROLE_NAME} --max-session-duration 3600 \\
  --assume-role-policy-document '${trust}'

aws iam attach-role-policy --role-name ${ROLE_NAME} \\
  --policy-arn arn:aws:iam::aws:policy/SecurityAudit

aws iam put-role-policy --role-name ${ROLE_NAME} --policy-name ShieldFlowAuditExtras \\
  --policy-document '${extras}'

aws iam get-role --role-name ${ROLE_NAME} --query Role.Arn --output text`;
}

/** One-click stack creation, when the template has been published to S3 (docs/AWS_SETUP.md). */
export function cloudFormationQuickCreateUrl(scannerAccountId: string, externalId: string): string | null {
  const templateUrl = process.env.SHIELDFLOW_AWS_TEMPLATE_URL?.trim();
  if (!templateUrl) return null;
  const params = new URLSearchParams({
    templateURL: templateUrl,
    stackName: "ShieldFlowAudit",
    param_ShieldFlowAccountId: scannerAccountId,
    param_ExternalId: externalId,
  });
  return `https://console.aws.amazon.com/cloudformation/home#/stacks/quickcreate?${params.toString()}`;
}
