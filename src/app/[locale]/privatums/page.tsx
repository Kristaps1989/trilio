import { LegalDocument, legalMetadata } from "@/ui/LegalDocument";

// Company details come from runtime configuration, so the page renders per request.
export const dynamic = "force-dynamic";

export function generateMetadata() {
  return legalMetadata("privacy", "/privatums");
}

export default function Page() {
  return <LegalDocument doc="privacy" />;
}
