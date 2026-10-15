/**
 * Cases for the device managers' address checks and FileVault mapping (the
 * device checks themselves are covered in microsoft/checks.cases.ts).
 * Run with:  npx tsx lib/integrations/mdm/checks.cases.ts
 */
import { jamfEncrypted, normalizeJamfUrl, normalizeKandjiHost } from "@/lib/integrations/mdm/clients";

let failures = 0;
function expect(label: string, got: unknown, want: unknown) {
  const pass = got === want;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  -> ${String(got)}${pass ? "" : ` (wanted ${String(want)})`}`);
}

expect("Kandji US API URL", normalizeKandjiHost("https://acme.api.kandji.io/api/v1"), "acme.api.kandji.io");
expect("Kandji EU API URL", normalizeKandjiHost("acme.api.eu.kandji.io"), "acme.api.eu.kandji.io");
expect("Kandji: any other host refused", normalizeKandjiHost("evil.example.com"), null);
expect("Kandji: lookalike refused", normalizeKandjiHost("acme.api.kandji.io.evil.com"), null);

expect("Jamf Cloud", normalizeJamfUrl("acme.jamfcloud.com"), "https://acme.jamfcloud.com");
expect("Jamf: http refused", normalizeJamfUrl("http://acme.jamfcloud.com"), null);
expect("Jamf: IP literal refused", normalizeJamfUrl("https://10.0.0.5"), null);
expect("Jamf: localhost refused", normalizeJamfUrl("https://localhost:8443"), null);
expect("Jamf: internal name refused", normalizeJamfUrl("https://jamf.corp"), null);
expect("Jamf: own public server kept with port", normalizeJamfUrl("https://jamf.acme.com:8443/"), "https://jamf.acme.com:8443");

expect("ENCRYPTED → encrypted", jamfEncrypted("ENCRYPTED"), true);
expect("UNENCRYPTED → not", jamfEncrypted("UNENCRYPTED"), false);
expect("ENCRYPTING → unknown (not yet)", jamfEncrypted("ENCRYPTING"), null);
expect("missing → unknown", jamfEncrypted(undefined), null);

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
