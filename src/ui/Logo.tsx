import { useTranslations } from "next-intl";

/** Brand mark + wordmark from docs/BRAND.md. Primary version: lime mark on dark. */
export function Logo({ className = "" }: { className?: string }) {
  const t = useTranslations("header");
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 40 40" width="32" height="32" role="img" aria-label={t("logoAlt")}>
        <rect width="40" height="40" rx="11" fill="#D8F45A" />
        <rect x="8.5" y="19" width="6.5" height="13" rx="2" fill="#0F2A2E" />
        <rect x="16.75" y="14" width="6.5" height="18" rx="2" fill="#0F2A2E" />
        <circle cx="20" cy="9" r="3" fill="#0F2A2E" />
        <rect x="25" y="23" width="6.5" height="9" rx="2" fill="#0F2A2E" />
      </svg>
      <span className="font-heading text-2xl font-bold tracking-[-0.045em] text-mist" aria-hidden="true">
        trilio
      </span>
    </span>
  );
}
