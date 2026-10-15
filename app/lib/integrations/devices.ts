import { daysSince, exceptionMap, listNames, resourceKey, Verdict, type CheckDef, type CheckOutcome, type ExceptionRow, type Section } from "@/lib/checks-core";

/**
 * Laptops and phones from any device manager (Intune, Kandji, Jamf): one shape,
 * one set of checks, so "are our laptops encrypted?" means the same thing
 * whichever MDM a customer uses. Pure.
 */

export interface Device {
  id: string;
  name: string;
  os: string;
  osVersion: string | null;
  /** Disk encryption (FileVault / BitLocker); null = the MDM doesn't report it. */
  encrypted: boolean | null;
  /** Last time the device checked in with the MDM. */
  lastSeen: string | null;
  /** The person it belongs to, as the MDM knows them (email or username). */
  owner: string | null;
  ownerName: string | null;
  /** Company-owned vs personal (BYOD), when known. */
  corporate: boolean | null;
}

export interface DevicePerson {
  name: string;
  email: string;
  status: string;
}

export interface DeviceEvaluateOptions {
  now: Date;
  exceptions: ExceptionRow[];
  /** Checked in within this many days, or the device's state is stale. */
  staleDays: number;
  /** Personnel, to check every active person has a managed device. */
  people: DevicePerson[] | null;
}

export const deviceResource = (provider: string, d: Pick<Device, "id" | "name" | "owner">) => ({
  id: resourceKey(provider, null, "device", d.id),
  label: `${d.name}${d.owner ? ` (${d.owner})` : ""}`,
  region: null,
});
export const personResource = (provider: string, email: string, label: string) => ({
  id: resourceKey(provider, null, "person", email.toLowerCase()),
  label,
  region: null,
});

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The device checks for one MDM: `${prefix}.device_encryption`, `.device_checkin`, `.device_coverage`, `.device_leavers`. */
export function evaluateDevices(prefix: string, devices: Section<Device[]>, opts: DeviceEvaluateOptions, truncated = false): CheckOutcome[] {
  const ex = exceptionMap(opts.exceptions, opts.now);
  const V = (key: string) => new Verdict(`${prefix}.${key}`, ex);
  const out: CheckOutcome[] = [];
  const list = devices.ok ? devices.data : [];
  const stale = (d: Device) => daysSince(d.lastSeen, opts.now) > opts.staleDays;

  {
    const v = V("device_encryption");
    v.read(devices, "devices");
    if (truncated) v.gap("more devices than one scan reads");
    const unknown: string[] = [];
    for (const d of list) {
      if (d.encrypted === false) v.flag(deviceResource(prefix, d));
      else if (d.encrypted === null) unknown.push(d.name);
      // Encrypted when last seen, but not seen for a while: its state now is a guess.
      else if (stale(d)) unknown.push(`${d.name} (not seen for ${opts.staleDays}+ days)`);
    }
    if (unknown.length) v.gap(`encryption unknown for ${listNames(unknown, 3)}`);
    out.push(
      v.settle(
        list.length ? `All ${list.length} managed devices report disk encryption.` : "No managed devices.",
        (n) => `${n} of ${list.length} devices aren't encrypted.`,
      ),
    );
  }
  {
    const v = V("device_checkin");
    v.read(devices, "devices");
    if (truncated) v.gap("more devices than one scan reads");
    for (const d of list) if (stale(d)) v.flag({ ...deviceResource(prefix, d), label: `${deviceResource(prefix, d).label} — last seen ${d.lastSeen ? `${Math.floor(daysSince(d.lastSeen, opts.now))} days ago` : "never"}` });
    out.push(
      v.settle(`Every device checked in within ${opts.staleDays} days.`, (n) => `${n} ${n === 1 ? "device hasn't" : "devices haven't"} checked in for ${opts.staleDays}+ days — retire it, or find it.`),
    );
  }
  {
    const v = V("device_coverage");
    v.read(devices, "devices");
    if (truncated) v.gap("more devices than one scan reads");
    const active = (opts.people ?? []).filter((p) => p.status !== "offboarded" && p.email);
    if (!opts.people || !active.length) v.gap("nobody is recorded in Personnel yet, so coverage can't be measured");
    const owners = new Set<string>();
    for (const d of list) {
      if (d.owner) owners.add(norm(d.owner));
      if (d.owner && !d.owner.includes("@")) owners.add(`user:${norm(d.owner)}`);
    }
    for (const p of active) {
      const local = norm(p.email).split("@")[0];
      if (!owners.has(norm(p.email)) && !owners.has(`user:${local}`)) v.flag(personResource(prefix, p.email, `${p.name} (${p.email})`));
    }
    out.push(
      v.settle(`Every one of ${active.length} people in Personnel has a managed device.`, (n) => `${n} of ${active.length} people in Personnel have no managed device.`),
    );
  }
  {
    const v = V("device_leavers");
    v.read(devices, "devices");
    const leavers = new Map((opts.people ?? []).filter((p) => p.status === "offboarded" && p.email).map((p) => [norm(p.email), p]));
    for (const d of list) {
      const p = d.owner ? leavers.get(norm(d.owner)) : undefined;
      if (p && !stale(d)) v.flag({ ...deviceResource(prefix, d), label: `${d.name} — ${p.name} has left` });
    }
    out.push(v.settle("No active device belongs to someone who left.", (n) => `${n} ${n === 1 ? "device still checks in for someone" : "devices still check in for people"} who left — collect and wipe ${n === 1 ? "it" : "them"}.`));
  }
  return out;
}

/** The four device checks' definitions for one MDM, worded for it. */
export function deviceChecks(prefix: string, mdm: string, consolePath: { encryption: string; retire: string }, apiCalls: string[]): CheckDef<"devices">[] {
  const ENDPOINT = ["CC6.8", "A.8.1", "164.312(a)(2)(iv)", "Req 5"];
  return [
    {
      key: `${prefix}.device_encryption`,
      title: "Every laptop is encrypted",
      area: "devices",
      severity: "high",
      why: "A lost laptop without disk encryption is a data breach you have to report; with it, it's a hardware cost. Auditors ask for this list.",
      controlCodes: ENDPOINT,
      apiCalls,
      fix: { console: consolePath.encryption },
    },
    {
      key: `${prefix}.device_checkin`,
      title: `Every device checks in with ${mdm}`,
      area: "devices",
      severity: "medium",
      why: "A device that hasn't checked in for weeks is lost, wiped, or out of policy — and its encryption and patch state are unknown.",
      controlCodes: ENDPOINT,
      apiCalls,
      fix: { console: consolePath.retire },
    },
    {
      key: `${prefix}.device_coverage`,
      title: "Everyone has a managed device",
      area: "devices",
      severity: "high",
      why: `Someone working on a laptop ${mdm} doesn't know about is working on a laptop nobody can prove is encrypted or patched.`,
      controlCodes: ENDPOINT,
      apiCalls: [...apiCalls, "Personnel (ShieldFlow)"],
      fix: { console: `Enrol their laptop in ${mdm}, or mark the person out of scope with a reason (e.g. contractor on their own managed device).` },
    },
    {
      key: `${prefix}.device_leavers`,
      title: "No device belongs to someone who left",
      area: "devices",
      severity: "medium",
      informational: true,
      why: "A leaver's laptop still checking in still holds company data.",
      controlCodes: [],
      apiCalls: [...apiCalls, "Personnel (ShieldFlow)"],
      fix: { console: `Collect the laptop, then wipe and retire it in ${mdm}.` },
    },
  ];
}
