import { cloudFormationTemplate, TEMPLATE_VERSION } from "@/lib/aws/role";

export const dynamic = "force-static";

/**
 * The read-only role's CloudFormation template, public so it can be read before
 * connecting — and downloaded by the ShieldFlow owner to publish to S3 for the
 * one-click link (docs/AWS_SETUP.md).
 */
export function GET() {
  return new Response(cloudFormationTemplate(), {
    headers: {
      "content-type": "text/yaml; charset=utf-8",
      "content-disposition": `inline; filename="shieldflow-audit-role-v${TEMPLATE_VERSION}.yaml"`,
    },
  });
}
