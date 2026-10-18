import type { ReactNode } from "react";

// Layout primitives from the prototype: every screen sits in a centred
// column whose width depends on the screen type (docs/DESIGN_FIX_PLAN.md §1).

const widths = {
  /** Sign-in, payment. */
  narrow: "max-w-[480px]",
  /** Free text, "soon" states. */
  medium: "max-w-[640px]",
  /** Questions and pickers. */
  form: "max-w-[720px]",
  /** Welcome, radar, account, legal text. */
  text: "max-w-[760px]",
  /** Results, category pages, home sections. */
  wide: "max-w-[1160px]",
} as const;

export type ContainerSize = keyof typeof widths;

export function Container({
  size = "text",
  className = "",
  children,
}: {
  size?: ContainerSize;
  className?: string;
  children: ReactNode;
}) {
  return <div className={`mx-auto w-full ${widths[size]} ${className}`}>{children}</div>;
}

/**
 * A flow screen: the column is centred vertically in the space between the
 * header and the footer, as in the prototype's welcome and question screens.
 */
export function Screen({
  size = "form",
  gap = "gap-[18px]",
  children,
}: {
  size?: ContainerSize;
  gap?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center pt-2 pb-6">
      <Container size={size} className={`flex flex-col ${gap}`}>
        {children}
      </Container>
    </div>
  );
}

/** A content page: top-aligned column with generous bottom space. */
export function Page({
  size = "text",
  gap = "gap-[18px]",
  children,
}: {
  size?: ContainerSize;
  gap?: string;
  children: ReactNode;
}) {
  return (
    <div className="pt-3 pb-12">
      <Container size={size} className={`flex flex-col ${gap}`}>
        {children}
      </Container>
    </div>
  );
}

/** Lime uppercase line above a title. */
export function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-sm font-bold uppercase tracking-[0.04em] text-lime ${className}`}>{children}</p>;
}

const titleScales = {
  hero: "title-hero",
  results: "title-results",
  screen: "title-screen",
} as const;

export function PageTitle({
  scale = "screen",
  as: Tag = "h1",
  id,
  children,
}: {
  scale?: keyof typeof titleScales;
  as?: "h1" | "h2";
  id?: string;
  children: ReactNode;
}) {
  return (
    <Tag id={id} className={`font-heading text-mist ${titleScales[scale]}`}>
      {children}
    </Tag>
  );
}

export function Lead({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-lead text-stone ${className}`}>{children}</p>;
}

/** Section heading inside a page (Space Grotesk 20–22 px). */
export function SectionTitle({
  children,
  id,
  className = "",
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <h2 id={id} className={`font-heading text-[22px] font-semibold leading-tight text-mist ${className}`}>
      {children}
    </h2>
  );
}

/** Lime-tinted help or info box. */
export function InfoBox({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[14px] bg-lime-12 px-4 py-[14px] text-base leading-normal text-mist ${className}`}
    >
      {children}
    </div>
  );
}

/** Bordered panel on the dark background (radar sections, explanations). */
export function Panel({
  children,
  className = "",
  tone = "line",
}: {
  children: ReactNode;
  className?: string;
  tone?: "line" | "lime" | "dashed";
}) {
  const border =
    tone === "lime"
      ? "border-[1.5px] border-lime"
      : tone === "dashed"
        ? "border-[1.5px] border-dashed border-line-30"
        : "border-[1.5px] border-line-25";
  return <div className={`rounded-panel-lg px-[22px] py-5 ${border} ${className}`}>{children}</div>;
}
