/**
 * bd-o15qnr.38 (queue #219) — the v7 Feedback Form's save, with a time limit.
 *
 * Prod, 22 Nov 00:13 PKT: the form sat on "Saving" for 45+ s although the server had saved it in 1 s (POST
 * /leader/observe/:id/draft 200, 1028 ms). The save waited on its answer with no limit, and the Save tray's buttons are
 * disabled while it waits, so an answer that never reached the page left her on "Saving" with no way on.
 *
 * Each try now has SAVE_TRY_MS. A try with no answer in that time, or no answer at all (the connection dropped), is
 * LOST and the same answers are sent once more: the bot takes a re-save (it is how the form is edited after a save).
 * An answer that is an error (400, 409, 5xx) is a REFUSAL, shown as before and never re-sent.
 */
export const SAVE_SLOW_MS = 6_000;
export const SAVE_TRY_MS = 15_000;
export const SAVE_TRIES = 2;

export type SaveTry = { kind: "saved" } | { kind: "lost" } | { kind: "refused"; err: unknown };

const NEVER = new Promise<SaveTry>(() => {});

/** One try: its outcome, a timer that says "lost" after SAVE_TRY_MS, and a way to stop that timer. */
export function tryOnce(send: () => Promise<unknown>, ms = SAVE_TRY_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<SaveTry>((resolve) => { timer = setTimeout(() => resolve({ kind: "lost" }), ms); });
  const outcome: Promise<SaveTry> = Promise.resolve()
    .then(send)
    .then(
      () => ({ kind: "saved" as const }),
      (err) => ((err as { response?: unknown })?.response ? { kind: "refused" as const, err } : { kind: "lost" as const }),
    );
  return { outcome, limit, stop: () => clearTimeout(timer) };
}

/** An earlier try counts only if it comes back saved (its loss or refusal was already acted on). */
export const savedOnly = (p: Promise<SaveTry>): Promise<SaveTry> => p.then((o) => (o.kind === "saved" ? o : NEVER));
