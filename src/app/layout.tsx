import type { ReactNode } from "react";

// Every page lives under [locale] (src/app/[locale]/layout.tsx renders <html>).
// This root layout only exists so the root not-found page has a parent.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
