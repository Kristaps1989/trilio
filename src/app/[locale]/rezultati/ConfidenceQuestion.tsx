"use client";

import { useState } from "react";

// The one question that measures this page (docs/CONFIDENCE_PLAN.md §3 E):
// one tap, anonymous; "no" opens an optional line about what was missing.

type Labels = { question: string; yes: string; no: string; note: string; send: string; thanks: string };

export function ConfidenceQuestion({
  subcategoryId,
  sessionId,
  labels,
}: {
  subcategoryId: string;
  sessionId: string | null;
  labels: Labels;
}) {
  const [state, setState] = useState<"ask" | "why" | "done">("ask");
  const [note, setNote] = useState("");
  const send = (confident: boolean, text?: string) =>
    fetch("/api/confidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subcategoryId, sessionId, confident, ...(text ? { note: text } : {}) }),
    }).catch(() => undefined);

  return (
    <section
      aria-labelledby="confidence-q"
      className="flex flex-col gap-3 rounded-panel border-[1.5px] border-line-25 px-5 py-4"
    >
      <h2 id="confidence-q" className="font-heading text-lg font-semibold text-mist">
        {labels.question}
      </h2>
      {state === "done" ? (
        <p role="status" className="text-base text-lime">
          {labels.thanks}
        </p>
      ) : state === "why" ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(false, note.trim());
            setState("done");
          }}
        >
          <label htmlFor="confidence-note" className="text-[15px] text-stone">
            {labels.note}
          </label>
          <textarea
            id="confidence-note"
            value={note}
            maxLength={300}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-control border border-line-30 bg-white-5 px-3 py-2 text-base text-mist"
          />
          <div>
            <button type="submit" className="min-h-11 rounded-full bg-lime px-5 text-sm font-bold text-night">
              {labels.send}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-ga-event="confidence_answer"
            data-ga-param-answer="yes"
            onClick={() => {
              void send(true);
              setState("done");
            }}
            className="min-h-11 rounded-full bg-lime px-5 text-sm font-bold text-night"
          >
            {labels.yes}
          </button>
          <button
            type="button"
            data-ga-event="confidence_answer"
            data-ga-param-answer="no"
            onClick={() => setState("why")}
            className="min-h-11 rounded-full border border-line-30 px-5 text-sm font-semibold text-mist"
          >
            {labels.no}
          </button>
        </div>
      )}
    </section>
  );
}
