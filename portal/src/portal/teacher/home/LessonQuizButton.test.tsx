import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * "Quiz this lesson" on the plan page: drawn only with the Home card's switch on AND a signed quiz home for this
 * session; the tap is logged as lp_quiz and goes to the quiz home. Switch off: nothing is drawn and nothing is asked.
 */

const h = vi.hoisted(() => ({ card: true, quizHome: "/quiz/teacher/tok" as string | null }));
vi.mock("./useHomeData", async (orig) => ({
  ...(await orig<typeof import("./useHomeData")>()),
  useHomeSwitches: () => ({ card: h.card, order: false }),
}));
vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  getQuizHome: vi.fn(async () => h.quizHome),
  tapHome: vi.fn(),
}));

import { getQuizHome, tapHome } from "./api";
import { LessonQuizButton } from "./LessonQuizButton";
import { HOME_CARD_COPY, HOME_CARD_COPY_UR } from "./copy";

const assign = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  h.card = true;
  h.quizHome = "/quiz/teacher/tok";
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
});
const draw = () => render(<MemoryRouter><LessonQuizButton /></MemoryRouter>);

describe("LessonQuizButton", () => {
  it("switch on and a quiz home: the button, which logs lp_quiz and opens the quiz home", async () => {
    draw();
    const b = await screen.findByRole("button", { name: HOME_CARD_COPY.lp.quizThis });
    fireEvent.click(b);
    expect(tapHome).toHaveBeenCalledWith("lp_quiz");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/quiz/teacher/tok"));
  });

  it("on a Digital Coach report: the same button, logged as coach_quiz", async () => {
    render(<MemoryRouter><LessonQuizButton from="coach" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: HOME_CARD_COPY.lp.quizThis }));
    expect(tapHome).toHaveBeenCalledWith("coach_quiz");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/quiz/teacher/tok"));
  });

  it("switch on but no quiz home (the bot off, a coach): nothing drawn", async () => {
    h.quizHome = null;
    draw();
    await waitFor(() => expect(getQuizHome).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("switch off: nothing drawn and nothing asked", async () => {
    h.card = false;
    draw();
    await new Promise((r) => setTimeout(r, 5));
    expect(getQuizHome).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the Urdu words are the copy registry's", () => {
    expect(HOME_CARD_COPY_UR.lp.quizThis).toBeTruthy();
  });
});
