import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { BEHAVIOUR_MODULE, COACH_MODULES } from "./modules";

/**
 * bd-rlxkkt.3 — the Coach Training map exists twice: the portal's (this page) and the bot's
 * (bot/shared/config/coach-training-modules.js, which the coach's Feedback Report links from). The portal and the bot
 * are separate builds, so this test loads the bot's copy and fails the moment the two disagree: the module a card
 * links must be the module this page opens.
 */
const require = createRequire(import.meta.url);
const bot = require("../../../../../bot/shared/config/coach-training-modules.js");

describe("the portal's Coach Training map IS the bot's", () => {
  it("same nine modules: number, key, page and both titles", () => {
    expect(COACH_MODULES).toEqual(bot.COACH_MODULES);
  });
  it("same behaviour → module map", () => {
    expect(BEHAVIOUR_MODULE).toEqual(bot.BEHAVIOUR_MODULE);
  });
});
