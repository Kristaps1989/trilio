"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The admin's sections as one row of chips: scrolls sideways on a phone.

export function AdminNav({ items, label }: { items: { href: string; label: string }[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-gutter overflow-x-auto px-gutter">
      <ul className="flex min-w-max gap-2">
        {items.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-semibold ${
                  active ? "bg-lime text-night" : "border-[1.5px] border-line-30 text-mist"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
