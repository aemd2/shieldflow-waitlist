"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, ExternalLink } from "lucide-react";
import { updateTrustSettings } from "@/app/actions/settings";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function TrustSettings({
  companyName,
  initialSlug,
  initialEnabled,
}: {
  companyName: string;
  initialSlug: string;
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [slug, setSlug] = useState(initialSlug || slugify(companyName));
  const [enabled, setEnabled] = useState(initialEnabled);

  function save(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateTrustSettings({ enabled, slug });
      if (res?.error) {
        toast("error", res.error);
        return;
      }
      toast("success", enabled ? "Trust Center published" : "Trust Center hidden");
      router.refresh();
    });
  }

  const publicUrl = `/trust/${slug}`;

  return (
    <form onSubmit={save} className="card space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-[var(--brand-emerald)]" />
        <h2 className="text-sm font-semibold text-foreground">Public Trust Center</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        A public page showing your live compliance score, framework progress, and published
        (final) policies — share it with prospects instead of filling in security questionnaires.
      </p>

      <div>
        <label className="mb-1 block text-sm font-medium">Public URL name</label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">/trust/</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            className="input flex-1"
            minLength={3}
            maxLength={60}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lowercase letters, numbers, and dashes"
            required
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 accent-[var(--brand-emerald)]"
        />
        Publish the Trust Center publicly
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
        {enabled && initialEnabled && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-foreground underline"
          >
            View public page <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </form>
  );
}
