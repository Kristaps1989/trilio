import { LegalDocument, legalMetadata } from "@/ui/LegalDocument";

// Company details come from runtime configuration, so the page renders per request.
export const dynamic = "force-dynamic";

export function generateMetadata() {
  return legalMetadata("terms", "/noteikumi");
}

export default function Page() {
  return <LegalDocument doc="terms" />;
}
