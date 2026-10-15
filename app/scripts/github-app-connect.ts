/**
 * Connect a GitHub App installation to the test workspace (RECORDING_EMAIL's
 * company) without the browser round-trip — for testing locally while
 * production's callback isn't configured yet. Stores only the installation id.
 *
 *   npx tsx scripts/github-app-connect.ts <installationId>
 *   npx tsx scripts/github-app-connect.ts --disconnect
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

(async () => {
  const { createAdminSupabase } = await import("@/lib/supabase/admin");
  const { encryptSecret } = await import("@/lib/crypto");
  const { installationAccount } = await import("@/lib/integrations/github/client");
  const db = createAdminSupabase();
  const email = process.env.RECORDING_EMAIL!;
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
  const user = users.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error("test account not found");
  const { data: member } = await db.from("company_members").select("company_id").eq("user_id", user.id).limit(1).maybeSingle();
  const companyId = member!.company_id as string;

  if (process.argv.includes("--disconnect")) {
    await db.from("integrations").delete().eq("company_id", companyId).eq("provider", "github");
    console.log("GitHub disconnected from the test workspace.");
    return;
  }
  const installationId = Number(process.argv[2]);
  if (!installationId) throw new Error("usage: github-app-connect.ts <installationId>");
  const account = await installationAccount(installationId);
  const { error } = await db.from("integrations").upsert(
    {
      company_id: companyId,
      provider: "github",
      access_token: encryptSecret(JSON.stringify({ kind: "app", installationId })),
      status: "connected",
      connected_by: user.id,
      metadata: { login: account.login, account_type: account.type, connection: "app" },
    },
    { onConflict: "company_id,provider" },
  );
  if (error) throw new Error(error.message);
  console.log(`Connected installation ${installationId} (${account.login}, ${account.type}) to the test workspace.`);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
