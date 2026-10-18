import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Button set from the Claude Design prototype (docs/DESIGN_FIX_PLAN.md §3).
// Buttons size to their label; `block` makes them fill the row. Every size
// keeps the 44 px touch target (CLAUDE.md).

const variants = {
  /** Lime call to action on the dark background. */
  primary: "bg-lime text-night font-bold",
  /** Outlined on dark. */
  outline: "border-[1.5px] border-line-40 bg-transparent text-mist font-semibold",
  /** Lime outline on dark (compare toggle). */
  lime: "border-[1.5px] border-lime bg-transparent text-mist font-bold",
  /** Dark button on white cards. */
  dark: "bg-night text-white font-bold",
  /** Outlined button on white cards. */
  card: "border-[1.5px] border-card-button-line bg-white text-night font-semibold",
  /** Light solid button on dark. */
  light: "bg-mist text-night font-bold",
  /** Confirming a destructive choice. */
  danger: "bg-warning text-night font-bold",
  /** Underlined text action. */
  link: "bg-transparent text-stone underline underline-offset-2 font-normal",
} as const;

const sizes = {
  sm: "min-h-11 rounded-control px-4 text-[15px]",
  md: "min-h-[52px] rounded-control px-6 text-[17px]",
  lg: "min-h-14 rounded-button px-[26px] text-lg",
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

type Style = { variant?: ButtonVariant; size?: ButtonSize; block?: boolean };

export function buttonClass({ variant = "primary", size = "md", block = false }: Style = {}): string {
  const pad = variant === "link" ? "px-1" : "";
  return [
    "inline-flex items-center justify-center gap-2 text-center leading-tight transition-opacity disabled:opacity-50",
    variants[variant],
    sizes[size],
    pad,
    block ? "w-full" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function Button({ variant, size, block, className = "", ...props }: ComponentProps<"button"> & Style) {
  return (
    <button type="button" {...props} className={`${buttonClass({ variant, size, block })} ${className}`} />
  );
}

export function ButtonLink({
  variant,
  size,
  block,
  className = "",
  children,
  ...props
}: ComponentProps<typeof Link> & Style & { children: ReactNode }) {
  return (
    <Link {...props} className={`${buttonClass({ variant, size, block })} ${className}`}>
      {children}
    </Link>
  );
}
