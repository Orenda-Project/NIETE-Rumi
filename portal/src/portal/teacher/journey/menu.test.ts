import { describe, expect, test } from "vitest";
import { currentMenuItem } from "../menu";
import { JOURNEY_PATH, journeyTaughtPath } from "./paths";

// bd-96f69c.9 design review #5: My journey is one tap from Home, so Home stays lit in the menu while she reads it.
describe("My journey keeps Home current in the menu", () => {
  test("the journey page", () => {
    expect(currentMenuItem(JOURNEY_PATH)).toBe("home");
  });
  test("the journey page with a trailing slash", () => {
    expect(currentMenuItem(`${JOURNEY_PATH}/`)).toBe("home");
  });
  test("Home's Taught in class filter (the query string is not part of the path)", () => {
    expect(currentMenuItem(journeyTaughtPath().split("?")[0])).toBe("home");
  });
  test("a look-alike path is not the journey", () => {
    expect(currentMenuItem(`${JOURNEY_PATH}ney`)).toBeNull();
  });
});
