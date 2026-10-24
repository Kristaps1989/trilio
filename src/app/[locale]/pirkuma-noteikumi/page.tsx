import { LegalDocument, legalMetadata } from "@/ui/LegalDocument";

// Terms for goods Trilio sells itself (personal offers), for private and business buyers.
export const dynamic = "force-dynamic";

export function generateMetadata() {
  return legalMetadata("purchase", "/pirkuma-noteikumi");
}

export default function Page() {
  return <LegalDocument doc="purchase" />;
}
