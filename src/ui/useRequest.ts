"use client";

import { useRouter } from "@/i18n/navigation";
import { useState, useTransition } from "react";
import { toggleSavedAction } from "@/app/[locale]/velmju-saraksts/actions";
import type { SaveTarget } from "@/app/[locale]/velmju-saraksts/save";
import { track } from "@/ui/analytics/track";
import { metaTrack } from "@/ui/analytics/meta";

// The "Pieprasīt labāku cenu" state machine, shared by the card button and
// the question before the shop (docs/PRICE_NOTIFY_PLAN.md §8.3, §8.4): a tap
// saves and asks; signed out it opens the e-mail field (`panel.email` null);
// signed in where Trilio sources, the first tap asks the one yes
// (`panel.email` set); a done save with alerts on shows the note.

export type RequestPanel = { email: string | null };

export function useRequest(target: SaveTarget, initial: boolean, withNote = true) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ email: string } | null>(null);
  const [panel, setPanel] = useState<RequestPanel | null>(null);
  // Another button for the same item (and the refresh after a tap) brings the server's state.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setSaved(initial);
  }

  function run(next: boolean, consent = false) {
    setSaved(next); // optimistic
    start(async () => {
      const r = await toggleSavedAction(target, next, consent);
      if (!r.ok) {
        setSaved(!next);
        if (r.reason === "auth") setPanel({ email: null });
        else if (r.reason === "consent") setPanel({ email: r.email });
        return;
      }
      setPanel(null);
      if (r.saved) track("save_item", { item: target.kind });
      if (r.lead) metaTrack("Lead", {}, r.lead);
      setNote(r.saved && r.alerts && r.email && withNote ? { email: r.email } : null);
      router.refresh();
    });
  }

  return { saved, pending, note, panel, run, closePanel: () => setPanel(null) };
}
