"use client";

import { Button } from "./Button";

export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="card" size="sm" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
