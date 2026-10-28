import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, renderRm, rmWorld, serve } from "./harness";

/**
 * fix-r5 s4 train 7 items 4 + 5 (design-qa 172524, lead-final 223944). jsdom has no layout, so the asks are asserted
 * as the classes the browser lays out from; the live 390×844 measure is in the pass post.
 */
const cls = (el: Element | null) => (el?.getAttribute("class") || "").split(/\s+/);

describe.each(["en", "ur"] as const)("train 7 RM layout (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
    serve(rmWorld());
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("item 4: S10's circle line wraps (never truncates the W name) and the play pill stays on line one", async () => {
    await renderRm("/circle");
    for (const row of screen.getAllByTestId("circle-row")) {
      const line = within(row).getByTestId("circle-line");
      expect(cls(line)).not.toContain("truncate");
      expect(cls(line)).toContain("whitespace-normal");
      const head = within(row).getByTestId("circle-play").parentElement as HTMLElement;
      expect(cls(head)).toContain("items-start");
      expect(cls(head)).not.toContain("items-center");
    }
  });

  it("item 5: the phone bar's EN / اردو pills are at least 44 px high", async () => {
    await renderRm("");
    const pills = [...screen.getAllByTestId("rm-lang-en"), ...screen.getAllByTestId("rm-lang-ur")];
    expect(pills.length).toBeGreaterThan(0);
    for (const p of pills) {
      expect(cls(p)).toContain("min-h-[44px]");
      expect(cls(p)).not.toContain("min-h-[40px]");
    }
  });
});
