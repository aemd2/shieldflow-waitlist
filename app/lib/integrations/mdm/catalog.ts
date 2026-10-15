import type { CheckDef } from "@/lib/checks-core";
import { deviceChecks } from "@/lib/integrations/devices";
import type { MdmProvider } from "@/lib/integrations/mdm/clients";

export const MDM_AREAS = [{ area: "devices", title: "Laptops & phones" }];

export const MDM_META: Record<MdmProvider, { title: string; checks: CheckDef[]; reads: readonly (readonly [string, string])[]; connect: string; never: string[] }> = {
  kandji: {
    title: "Kandji",
    checks: deviceChecks(
      "kandji",
      "Kandji",
      {
        encryption: "Kandji → Library → add the FileVault item → assign it to every Mac blueprint. Kandji escrows the recovery key.",
        retire: "Kandji → Devices → the device → Actions → Delete Device Record (if it's gone), or ask its owner to connect to the internet.",
      },
      ["GET /api/v1/devices", "GET /api/v1/devices/{id}/details (FileVault)"],
    ),
    reads: [
      ["Device list (read)", "name, platform, OS version, last check-in, assigned user"],
      ["Device details (read)", "whether FileVault is on"],
    ],
    connect:
      "In Kandji → Settings → Access → API token, create a token with only the device-list and device-details read permissions. Paste the API URL shown on the same page and the token. ShieldFlow reads the device list once a day.",
    never: ["Recovery keys, passcodes, installed apps, files or locations — the token can't read them.", "Send commands: no lock, wipe or install — the token has no write permissions."],
  },
  jamf: {
    title: "Jamf Pro",
    checks: deviceChecks(
      "jamf",
      "Jamf",
      {
        encryption: "Jamf Pro → Computers → Configuration Profiles → Security & Privacy → FileVault → Require FileVault, with an institutional or individual recovery key escrowed → scope to all computers.",
        retire: "Jamf Pro → Computers → the computer → Management → remove it if it's gone, or have its owner run 'sudo jamf recon'.",
      },
      ["POST /api/oauth/token", "GET /api/v1/computers-inventory (GENERAL, DISK_ENCRYPTION, OPERATING_SYSTEM, USER_AND_LOCATION)"],
    ),
    reads: [["Computer inventory (read)", "name, OS, last contact, FileVault state, assigned user's email"]],
    connect:
      "In Jamf Pro → Settings → API roles and clients, create an API role with only 'Read Computers' and 'Read Computer Inventory Collection', then an API client with that role. Paste your Jamf address, the client ID and the secret.",
    never: ["Recovery keys, scripts, policies, files or locations.", "Send commands or change anything: the API role is read-only."],
  },
};
