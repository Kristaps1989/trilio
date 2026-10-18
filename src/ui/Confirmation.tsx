import type { ReactNode } from "react";
import { PageTitle, Screen } from "./layout";

/** Success screen from the prototype: lime check circle, title, text, inline buttons. */
export function Confirmation({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <Screen size="medium">
      <span
        aria-hidden="true"
        className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-lime"
      >
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0F2A2E"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <PageTitle>{title}</PageTitle>
      <p className="text-lg leading-normal text-stone">{body}</p>
      <div className="flex flex-wrap gap-3">{children}</div>
    </Screen>
  );
}
