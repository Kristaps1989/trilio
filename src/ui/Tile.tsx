import { Link } from "@/i18n/navigation";
import type { ReactNode } from "react";

// Category tile from the prototype: 112 px tall, icon at the top, label at
// the bottom. Laid out with TileGrid (auto-fill, min 150 px).

export function TileGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[10px]">
      {children}
    </ul>
  );
}

export function TileIcon({ path }: { path?: string }) {
  if (!path) {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" className="text-lime">
        <circle cx="6" cy="12" r="1.6" fill="currentColor" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
        <circle cx="18" cy="12" r="1.6" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-lime"
    >
      <path d={path} />
    </svg>
  );
}

export function Tile({
  href,
  icon,
  label,
  sublabel,
  wide = false,
}: {
  href: string;
  icon?: ReactNode;
  label: string;
  sublabel?: string | null;
  /** Spans the whole row ("Kaut kas cits"). */
  wide?: boolean;
}) {
  return (
    <li className={wide ? "col-span-full" : ""}>
      <Link
        href={href}
        className="flex h-full min-h-[112px] flex-col items-start justify-between gap-3 rounded-[14px] border-[1.5px] border-mist-32 bg-white-5 p-4 text-left text-base leading-[1.25] font-semibold text-mist transition-colors hover:border-lime hover:bg-lime-18"
      >
        {icon}
        <span className="flex flex-col gap-1">
          <span>{label}</span>
          {sublabel ? <span className="text-sm font-normal text-stone">{sublabel}</span> : null}
        </span>
      </Link>
    </li>
  );
}
