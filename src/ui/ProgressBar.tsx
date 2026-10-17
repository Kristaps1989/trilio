import { useTranslations } from "next-intl";

/** "Jautājums N no M" with a bar; announced politely to screen readers when it changes. */
export function ProgressBar({ n, m }: { n: number; m: number }) {
  const t = useTranslations("flow");
  const pct = Math.round((n / m) * 100);
  return (
    <div className="flex flex-col gap-2">
      <p id="flow-progress" className="text-sm font-semibold text-stone" aria-live="polite">
        {t("progress", { n, m })}
      </p>
      <div
        role="progressbar"
        aria-labelledby="flow-progress"
        aria-valuemin={1}
        aria-valuemax={m}
        aria-valuenow={n}
        className="h-1.5 w-full overflow-hidden rounded-full bg-mist-32"
      >
        <div className="h-full rounded-full bg-lime transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
