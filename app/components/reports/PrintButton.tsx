"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

// Browser-native "Save as PDF" via the print dialog — no PDF dependency, and the
// @media print styles (see globals.css) strip the app chrome so only the report
// prints. Reliable across every browser and what auditors accept.
export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="print:hidden" leftIcon={<Printer className="h-4 w-4" />}>
      Print / Save as PDF
    </Button>
  );
}
