"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, Copy, Trash2 } from "lucide-react";
import { createInvite, revokeInvite, removeMember } from "@/app/actions/team";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { TeamMember, PendingInvite } from "@/lib/db/queries";

function roleLabel(role: string): string {
  if (role === "admin") return "Admin";
  if (role === "auditor") return "Auditor (read-only)";
  return "Member";
}

function RoleBadge({ role, isOwner }: { role: string; isOwner: boolean }) {
  const label = isOwner ? "Owner" : roleLabel(role);
  return <Badge variant="neutral">{label}</Badge>;
}

export function TeamSettings({
  isOwner,
  ownerUserId,
  currentUserId,
  members,
  invites,
}: {
  isOwner: boolean;
  ownerUserId: string;
  currentUserId: string;
  members: TeamMember[];
  invites: PendingInvite[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin" | "auditor">("member");
  const [expiresInDays, setExpiresInDays] = useState(30);

  function invite(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createInvite({
        email,
        role,
        expiresInDays: role === "auditor" ? expiresInDays : 0,
      }).catch(() => ({
        error: "Network problem — please try again.",
      }));
      if ("error" in res && res.error) {
        toast("error", res.error);
        return;
      }
      toast("success", `Invite created for ${email.trim().toLowerCase()}`);
      setEmail("");
      router.refresh();
    });
  }

  function copyLink(token: string) {
    const link = `${window.location.origin}/join?token=${token}`;
    navigator.clipboard.writeText(link).then(
      () => toast("success", "Invite link copied to clipboard"),
      () => toast("error", "Couldn't copy — link: " + link),
    );
  }

  function revoke(id: string) {
    start(async () => {
      const res = await revokeInvite(id).catch(() => ({ error: "Network problem." }));
      if ("error" in res && res.error) {
        toast("error", res.error);
        return;
      }
      toast("success", "Invite revoked");
      router.refresh();
    });
  }

  function remove(userId: string, memberEmail: string) {
    if (!confirm(`Remove ${memberEmail} from the workspace?`)) return;
    start(async () => {
      const res = await removeMember(userId).catch(() => ({ error: "Network problem." }));
      if ("error" in res && res.error) {
        toast("error", res.error);
        return;
      }
      toast("success", `${memberEmail} removed`);
      router.refresh();
    });
  }

  return (
    <div className="card space-y-5">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-[var(--brand-emerald)]" />
        <h2 className="text-sm font-semibold text-foreground">Team</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Invite teammates to collaborate on compliance. Everyone shares the same workspace data;
        only the owner can manage the team.
      </p>

      {/* Members */}
      <div className="space-y-2">
        {members.map((m) => {
          const memberIsOwner = m.user_id === ownerUserId;
          return (
            <div
              key={m.user_id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">
                  {m.email}
                  {m.user_id === currentUserId && (
                    <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <RoleBadge role={m.role} isOwner={memberIsOwner} />
                {isOwner && !memberIsOwner && (
                  <button
                    type="button"
                    onClick={() => remove(m.user_id, m.email)}
                    disabled={pending}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${m.email}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pending invites
          </h3>
          {invites.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{inv.email}</div>
                <div className="text-xs text-muted-foreground">
                  {roleLabel(inv.role)} · invited, not yet joined
                </div>
              </div>
              {isOwner && (
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => copyLink(inv.token)}
                    className="inline-flex items-center gap-1 text-xs text-foreground underline"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy link
                  </button>
                  <button
                    type="button"
                    onClick={() => revoke(inv.id)}
                    disabled={pending}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Revoke invite for ${inv.email}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Invite form (owner only) */}
      {isOwner ? (
        <form onSubmit={invite} className="space-y-3 border-t border-border pt-4">
          <label className="block text-sm font-medium">Invite a teammate</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="input flex-1"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "member" | "admin" | "auditor")}
              className="input sm:w-44"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="auditor">Auditor (read-only)</option>
            </select>
            <Button type="submit" loading={pending}>
              {pending ? "Working..." : "Create invite"}
            </Button>
          </div>
          {role === "auditor" && (
            <div className="flex items-center gap-2">
              <label htmlFor="auditor-expiry" className="text-xs text-muted-foreground">
                Auditor access expires in
              </label>
              <input
                id="auditor-expiry"
                type="number"
                min={0}
                max={365}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(Number(e.target.value))}
                className="input w-20"
              />
              <span className="text-xs text-muted-foreground">days (0 = no expiry)</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Creates a private link to share. They must sign in with this exact email to join.
            Auditors get <strong>read-only</strong> access to controls, evidence and reports — no
            changes, billing or team management. (Email delivery turns on once custom SMTP is
            configured.)
          </p>
        </form>
      ) : (
        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          Only the workspace owner can invite or remove teammates.
        </p>
      )}
    </div>
  );
}
