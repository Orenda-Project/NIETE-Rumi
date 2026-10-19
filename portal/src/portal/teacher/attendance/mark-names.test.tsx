import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * bd-qvnzh5 — on a phone the roll call cut every child's name to about the first name (ICT feedback, Attendance
 * row 12): the name was one `truncate` line beside three fixed 52px P/A/L buttons, ~108px on a 360px screen.
 * Many children share a first name, so the teacher could not tell who she was marking. The name now wraps to two
 * lines and the buttons are 44px wide — still 56px tall, the kit's tap height.
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));

import api from "../../services/api";
import { MarkPage } from "./MarkPage";
import { tapProblems } from "../../newui/checks/rules";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const LONG = "Muhammad Abdullah Khan Niazi";

beforeEach(() => {
  vi.clearAllMocks();
  http.get.mockImplementation((url: string) => {
    if (url.endsWith("/roster")) return Promise.resolve({ data: { listId: "l1", label: "Grade 4 - A", students: [{ id: "s1", name: LONG, roll: 1 }] } });
    if (url.endsWith("/day")) return Promise.resolve({ data: { date: "2026-10-19", marked: false, present: null, absent: null, leave: null, statuses: {} } });
    return Promise.resolve({ data: { date: "2026-10-19", classes: [
      { listId: "l1", label: "Grade 4 - A", grade: 4, section: "A", subjects: ["Math"], students: 1, marked: false, present: null, absent: null, leave: null },
    ] } });
  });
});

const renderMark = () => render(
  <MemoryRouter initialEntries={["/m/l1/mark"]}>
    <Routes><Route path="/m/:listId/mark" element={<MarkPage />} /></Routes>
  </MemoryRouter>,
);

describe("roll call: a child's full name fits on a phone", () => {
  it("the name wraps to two lines instead of being cut to one", async () => {
    renderMark();
    const name = await screen.findByText(LONG);
    expect(name.className).not.toMatch(/\btruncate\b/);
    expect(name.className).toMatch(/\bline-clamp-2\b/);
    expect(name.className).toMatch(/\bbreak-words\b/);
  });

  it("P/A/L are 44px wide, still 56px tall", async () => {
    renderMark();
    const group = await screen.findByRole("radiogroup", { name: LONG });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons).toHaveLength(3);
    buttons.forEach((b) => {
      expect(b.className).toMatch(/\bw-11\b/);
      expect(b.className).toMatch(/\bh-14\b/);
    });
    expect(tapProblems(group)).toEqual([]);
  });

  it("no attendance screen cuts a child's name to one line", () => {
    const dir = resolve(__dirname);
    const cut = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .flatMap((f) => readFileSync(resolve(dir, f), "utf8").split("\n").map((line, i) => ({ f, i: i + 1, line })))
      .filter(({ line }) => /\{s\.name\}<\/span>/.test(line) && /\btruncate\b/.test(line))
      .map(({ f, i }) => `${f}:${i}`);
    expect(cut).toEqual([]);
  });
});
