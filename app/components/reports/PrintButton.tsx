"use client";

import { Printer } from "lucide-react";

// Browser-native "Save as PDF" via the print dialog — no PDF dependency, and the
// @media print styles (see globals.css) strip the app chrome so only the report
// prints. Reliable across every browser and what auditors accept.
export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="btn-primary print:hidden">
      <Printer className="mr-2 inline h-4 w-4" /> Print / Save as PDF
    </button>
  );
}
