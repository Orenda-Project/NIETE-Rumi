import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-snkn32.39 — the Lesson Plans main page's first screen (testers Zarmeen and Hasnat, 13 Nov: "Make my own should be
 * an option, visible separately"; "the first screen should clearly separate ready-made lesson plans from Make my own"):
 *
 *   Given Make my own is on, for a teacher   two separate choices, each a card with its own one-line explanation:
 *                                            Ready-made lesson plans → grade and subject (today's path, unchanged);
 *                                            Make my own → grade and subject in own mode (today's own path)
 *   Given it is off, unknown, or a leader    today's single "New lesson plan" card, no explanation, no own card
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({ default: { get: vi.fn(async () => ({ data: {} })), post: vi.fn() } }));
vi.mock("./own/RecentOwnPlans", () => ({ RecentOwnPlans: () => null }));
vi.mock("./RegionCard", () => ({ RegionCard: () => null }));
vi.mock("../../fln/FlnBand", () => ({ FlnBand: () => null }));
const who = vi.hoisted(() => ({ on: true as boolean | null, leader: false }));
vi.mock("./own/flag", () => ({ useLpMakeOwn: () => who.on }));
vi.mock("./audience", () => ({ useLessonsLeader: () => who.leader }));

import { LessonsHomePage } from "./LessonsHome";
import { LESSONS_NEW } from "./paths";
import { LESSONS_V2_COPY as L } from "./copy";
import { OWN_COPY as C } from "./own/copy";
import { OWN_START } from "./own/state";

beforeEach(() => {
  cleanup();
  who.on = true;
  who.leader = false;
});

const page = () => render(<MemoryRouter><LessonsHomePage /></MemoryRouter>);

describe("the first screen: ready-made or Make my own", () => {
  it("for a teacher with Make my own on: two separate choices, each explained in one line", () => {
    page();
    const ready = screen.getByTestId("start-ready");
    const own = screen.getByTestId("start-own");
    expect(ready).not.toBe(own);
    expect(ready.contains(own) || own.contains(ready)).toBe(false);

    const readyLink = within(ready).getByRole("link");
    expect(readyLink.getAttribute("href")).toBe(LESSONS_NEW);
    expect(within(ready).getByText(C.readyMade)).toBeTruthy();
    expect(within(ready).getByText(C.readyMadeHint)).toBeTruthy();

    const ownLink = within(own).getByRole("link");
    expect(ownLink.getAttribute("href")).toBe(OWN_START);
    expect(within(own).getByText(C.makeMyOwn)).toBeTruthy();
    expect(within(own).getByText(C.makeOwnHint)).toBeTruthy();

    // Both choices sit together, named, ready-made first.
    const group = screen.getByRole("group", { name: C.chooseOne });
    expect(within(group).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([LESSONS_NEW, OWN_START]);
  });

  it("off, unknown, or a leader: today's single New lesson plan card, nothing else", () => {
    for (const s of [{ on: false, leader: false }, { on: null, leader: false }, { on: true, leader: true }]) {
      cleanup();
      Object.assign(who, s);
      page();
      const plus = screen.getByRole("link", { name: new RegExp(L.newLessonPlan) });
      expect(plus.getAttribute("href")).toBe(LESSONS_NEW);
      expect(screen.queryByText(C.readyMadeHint)).toBeNull();
      expect(screen.queryByTestId("start-own")).toBeNull();
      expect(screen.queryByRole("group", { name: C.chooseOne })).toBeNull();
    }
  });
});
