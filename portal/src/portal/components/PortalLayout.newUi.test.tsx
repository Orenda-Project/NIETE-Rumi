import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * bd-5rz1v.12 — the new indigo bar is taller than the old white one (10px +
 * a 56px item + 14px, plus the phone's safe area, against 64px), so with the
 * flag ON the page must keep its last line clear of it and the recording bar
 * (bd-5rz1v.10) must dock above it, not on it. With the flag OFF both keep
 * exactly the classes they had.
 *
 * The recording session is the one thing replaced here (its context is private
 * to recordingSession.tsx); the API is mocked at the service boundary.
 */

let session: Record<string, unknown> | null = null;
vi.mock("../lib/recordingSession", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/recordingSession")>();
  return { ...real, useRecordingSession: () => session, useRecordingClock: () => 754000 };
});
vi.mock("../services/api", () => ({
  portal: { getDashboard: vi.fn(), getConfig: vi.fn() },
  auth: { logout: vi.fn() },
}));

import { portal } from "../services/api";
import { resetNewUiMemory } from "../lib/useNewUi";
import PortalLayout from "./PortalLayout";
import { BottomActions, BottomButton } from "../newui/BottomButton";
import { DESK_BAR_STRIP_PX } from "./RecordingBar";

const api = portal as unknown as { getDashboard: ReturnType<typeof vi.fn>; getConfig: ReturnType<typeof vi.fn> };

const OLD_MAIN = "px-4 md:px-6 lg:px-8 pt-4 pb-20 md:pb-8";
const OLD_MAIN_RECORDING = "px-4 md:px-6 lg:px-8 pt-4 pb-40 md:pb-24";
const OLD_DOCK = "bottom-[72px]";

beforeEach(() => {
  vi.clearAllMocks();
  resetNewUiMemory();
  session = null;
  api.getDashboard.mockResolvedValue({ user: { firstName: "Ayesha", role: "teacher", phoneNumber: "920000000001" } });
});

async function renderLayout(newUi: boolean, recording = false) {
  api.getConfig.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi } });
  if (recording) session = { active: true, paused: false, screenWentOff: false, returnTo: "/portal/coaching/record", elapsedMs: () => 754000 };
  const view = render(
    <MemoryRouter initialEntries={["/portal/dashboard"]}>
      <PortalLayout><div>page</div></PortalLayout>
    </MemoryRouter>,
  );
  await screen.findByText("page");
  if (newUi) await screen.findByTestId("newui-bottom-nav");
  else await waitFor(() => expect(api.getConfig).toHaveBeenCalled());
  return view;
}

const main = (c: HTMLElement) => c.querySelector("main") as HTMLElement;
const dock = () => screen.getByTestId("recording-bar").parentElement as HTMLElement;

describe("flag OFF — the layout is unchanged", () => {
  it("keeps the page padding it had", async () => {
    const { container } = await renderLayout(false);
    expect(main(container).className).toBe(OLD_MAIN);
  });

  it("keeps the recording bar where it was, and the padding under it", async () => {
    const { container } = await renderLayout(false, true);
    expect(main(container).className).toBe(OLD_MAIN_RECORDING);
    expect(dock().className.split(/\s+/)).toContain(OLD_DOCK);
  });
});

describe("flag ON — room for the taller indigo bar", () => {
  it("keeps the page's last line clear of the bar (and of the safe area)", async () => {
    const { container } = await renderLayout(true);
    const cls = main(container).className;
    expect(cls).toContain("pb-[calc(96px+env(safe-area-inset-bottom))]");
    expect(cls).toContain("md:pb-8");
    expect(cls).not.toContain("pb-20");
  });

  it("docks the recording bar above the indigo bar, not on it", async () => {
    const { container } = await renderLayout(true, true);
    const d = dock().className.split(/\s+/);
    // bd-5rz1v.26 — an opaque strip from the top of the indigo bar; the bar itself 8px (pb-2) above it.
    expect(d).toEqual(expect.arrayContaining(["bottom-[calc(80px+env(safe-area-inset-bottom))]", "pb-2", "bg-nu-surface"]));
    expect(d).not.toContain(OLD_DOCK);
    expect(main(container).className).toContain("pb-[calc(176px+env(safe-area-inset-bottom))]");
  });

  it("bd-5rz1v.26.4 — on a desktop the page pads past the docked bar's strip, so its end is never under it", async () => {
    const { container } = await renderLayout(true, true);
    const cls = main(container).className.split(/\s+/);
    const pad = cls.find((c) => /^md:pb-/.test(c))!;
    // md:pb-24 → 96px; md:pb-[104px] → 104px
    const px = /\[(\d+)px\]/.test(pad) ? Number(pad.match(/\[(\d+)px\]/)![1]) : Number(pad.replace("md:pb-", "")) * 4;
    expect(px).toBeGreaterThanOrEqual(DESK_BAR_STRIP_PX + 14);
    const d = dock().className.split(/\s+/);
    expect(d).toEqual(expect.arrayContaining(["md:inset-x-0", "md:bottom-0", "md:bg-nu-surface"]));
  });

  it("reads /config once for the layout and the navigation together", async () => {
    await renderLayout(true);
    const newUiReads = api.getConfig.mock.calls.length;
    // useChildTest also reads /config; the two useNewUi callers share one read.
    expect(newUiReads).toBeLessThanOrEqual(2);
  });
});

describe("bd-5rz1v.14 — a page's bottom action button and the recording bar", () => {
  async function renderWithAction(recording: boolean) {
    api.getConfig.mockResolvedValue({ success: true, features: { assessmentGenerator: false, assessmentGeneratorMessage: null, newUi: true } });
    if (recording) session = { active: true, paused: false, screenWentOff: false, returnTo: "/portal/coaching/record", elapsedMs: () => 754000 };
    render(
      <MemoryRouter initialEntries={["/portal/curriculum"]}>
        <PortalLayout ownHeading>
          <BottomActions><BottomButton>Open</BottomButton></BottomActions>
        </PortalLayout>
      </MemoryRouter>,
    );
    await screen.findByTestId("newui-bottom-nav");
    return screen.getByTestId("newui-bottom-actions").className.split(/\s+/);
  }

  it("while a lesson records, the layout tells the button to stand above the bar", async () => {
    const cls = await renderWithAction(true);
    expect(cls).toContain("bottom-[calc(144px+env(safe-area-inset-bottom))]");
    expect(screen.getByTestId("recording-bar")).toBeInTheDocument();
  });

  it("with nothing recording, it sits just above the menu", async () => {
    const cls = await renderWithAction(false);
    expect(cls).toContain("bottom-[calc(80px+env(safe-area-inset-bottom))]");
  });
});
