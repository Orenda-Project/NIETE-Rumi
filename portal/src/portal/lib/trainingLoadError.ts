// bd-44003 — why a training level failed to load, in words the teacher can act on.
//
// The server already gets this right. `_assertLevelUnlocked` / `_assertModuleUnlocked`
// (dashboard/routes/portal.routes.js) refuse with a 403 and a real sentence built
// from the SAME state the badges render — "You need to pass Level 1's exam before
// this level opens" — so a refusal can never contradict the UI. PortalTraining
// used to discard that and raise one generic toast for every failure, which made
// three unrelated situations look identical:
//
//   locked  → an earlier level must be finished   (actionable, and permanent
//             until she does something about it, so it must STAY on screen)
//   error   → the request failed                  (retrying may work)
//   empty   → the level has no content            (nothing she can do; report it)
//
// A toast also fades, so a teacher who looked away was left with an empty
// dropdown and no explanation — reported on the partner sheet as both "locked
// training says Module Cannot be Loaded" and "no dropdown available after
// selecting the level".
//
// Rule of thumb when editing: NEVER paraphrase a message the server sent. If its
// wording improves, the portal should inherit that for free.

/** What the teacher should read, and whether it may disappear. */
export interface TrainingLoadError {
  kind: "locked" | "error";
  message: string;
  /** true → render it as text that stays put, not a toast that fades. */
  persist: boolean;
}

/** Shown when a course returns zero modules — not an error, but not nothing. */
export const EMPTY_MODULES_MESSAGE =
  "This part of the training has no content yet. Please tell NIETE so they can add it.";

/** Generic, deliberately retryable — used only when the server said nothing. */
const RETRYABLE_MESSAGE = "Something went wrong loading this. Please try again.";

/**
 * Classify an axios-shaped failure from the training endpoints.
 *
 * A 403 is a refusal and stays a refusal even with an empty body: dressing it
 * up as a transient error would invite a teacher to retry something that can
 * never succeed until she finishes an earlier level.
 */
export function classifyTrainingLoadError(err: unknown): TrainingLoadError {
  const res = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
  const status = res?.status;
  const serverMessage = typeof res?.data?.error === "string" && res.data.error.trim()
    ? res.data.error.trim()
    : null;

  if (status === 403) {
    return {
      kind: "locked",
      // A 403 with no body still must not read as "try again".
      message: serverMessage || "This part of the training is locked until you finish the level before it.",
      persist: true,
    };
  }

  // Any other status: the server's own words beat our generic text when it sent
  // some (e.g. 409 "That level is not part of your program"), but it is not a
  // lock, so it does not claim to be one.
  return {
    kind: "error",
    message: serverMessage || RETRYABLE_MESSAGE,
    persist: Boolean(serverMessage),
  };
}
