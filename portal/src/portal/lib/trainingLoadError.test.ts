/**
 * bd-44003 — a locked level must say WHY, and the three failure kinds must differ.
 *
 * THE BUG THIS ENCODES
 * --------------------
 * The server already answers this well. `_assertLevelUnlocked`
 * (dashboard/routes/portal.routes.js) refuses a locked level with a 403 and a
 * real sentence — "You need to pass Level 1's exam before this level opens" —
 * derived from the same state the badges render, so a refusal can never
 * contradict the UI the teacher is looking at.
 *
 * PortalTraining threw that sentence away. `GET /training/modules` and
 * `GET /training/module/:id` each caught bare and raised one generic toast
 * ("Could not load modules" / "Could not load module"), so three unrelated
 * situations were indistinguishable:
 *
 *   - the level is LOCKED and an earlier level must be finished  (actionable)
 *   - the request FAILED and retrying may work                    (retryable)
 *   - the level genuinely has NO content                          (report it)
 *
 * Reported on the partner sheet twice: "locked training says Module Cannot be
 * Loaded" (Primary r12) and "there is no dropdown available after selecting
 * the level" (Middle and High r24) — the same defect wearing a different hat,
 * because a toast fades and leaves an empty dropdown behind it.
 *
 * WHY THIS IS A PURE HELPER
 * -------------------------
 * The decision — given an axios error, what should the teacher read, and is it
 * permanent or worth retrying — is the whole bug. Extracting it keeps the test
 * honest: no Radix Select to drive in jsdom, and the classification is pinned
 * directly. The component's only job is to render what this returns.
 */

import { describe, it, expect } from "vitest";
import { classifyTrainingLoadError, EMPTY_MODULES_MESSAGE } from "./trainingLoadError";

const LOCKED = "You need to pass Level 1's exam before this level opens.";

function httpError(status: number, error?: string) {
  return { response: { status, data: error ? { error } : {} } };
}

describe("bd-44003 — classifyTrainingLoadError", () => {
  it("passes the server's own words through for a locked level", () => {
    const out = classifyTrainingLoadError(httpError(403, LOCKED));
    expect(out.message).toBe(LOCKED);
    expect(out.kind).toBe("locked");
    // If the server's wording improves, the portal inherits it — never paraphrase.
    expect(out.message).not.toMatch(/could not load/i);
  });

  it("marks the locked case as persistent — a message that fades is the bug", () => {
    expect(classifyTrainingLoadError(httpError(403, LOCKED)).persist).toBe(true);
  });

  it("offers a retry for a plain server failure, and never implies a lock", () => {
    const out = classifyTrainingLoadError(httpError(500));
    expect(out.kind).toBe("error");
    expect(out.message).toMatch(/try again/i);
    // Claiming she is locked out would be a lie about her record.
    expect(out.message).not.toMatch(/locked|before this level opens/i);
  });

  it("treats a network error with no response as retryable", () => {
    const out = classifyTrainingLoadError(new Error("Network Error"));
    expect(out.kind).toBe("error");
    expect(out.message).toMatch(/try again/i);
  });

  it("gives the three kinds three different messages", () => {
    const locked = classifyTrainingLoadError(httpError(403, LOCKED)).message;
    const failed = classifyTrainingLoadError(httpError(500)).message;
    const empty = EMPTY_MODULES_MESSAGE;
    expect(new Set([locked, failed, empty]).size).toBe(3);
  });

  it("tells the teacher who to tell when a level has no content at all", () => {
    expect(EMPTY_MODULES_MESSAGE).toMatch(/no content|nothing/i);
    expect(EMPTY_MODULES_MESSAGE).toMatch(/NIETE|support/i);
    expect(EMPTY_MODULES_MESSAGE).not.toMatch(/locked/i);
  });

  it("falls back to the server's message on a 403 that carries no text", () => {
    // Fail-safe: a 403 is still a refusal even if the body is empty. It must
    // not be dressed up as a transient error the teacher should retry.
    const out = classifyTrainingLoadError(httpError(403));
    expect(out.kind).toBe("locked");
    expect(out.persist).toBe(true);
    expect(out.message).not.toMatch(/try again/i);
  });

  it("prefers a server message over the generic text on any status", () => {
    const out = classifyTrainingLoadError(httpError(409, "That level is not part of your program."));
    expect(out.message).toBe("That level is not part of your program.");
  });
});
