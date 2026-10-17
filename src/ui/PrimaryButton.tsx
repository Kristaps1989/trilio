import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const base =
  "flex min-h-14 w-full items-center justify-center rounded-button px-6 text-lg font-bold transition-opacity disabled:opacity-50";
const styles = {
  primary: `${base} bg-lime text-night`,
  secondary: `${base} border-[1.5px] border-mist-32 bg-white-5 text-mist font-semibold`,
  light: `${base} bg-night text-mist`,
};

type Variant = keyof typeof styles;

export function PrimaryButton({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" {...props} className={`${styles[variant]} ${className}`} />;
}

export function PrimaryLink({
  variant = "primary",
  className = "",
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; children: ReactNode }) {
  return (
    <Link {...props} className={`${styles[variant]} ${className}`}>
      {children}
    </Link>
  );
}
