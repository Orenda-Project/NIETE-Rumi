import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-fmf24g.13 — Attendance in Urdu: the selector (title, search, a class's Not marked / Marked chip, today's
 * date) and the shared month and day names take their words from ATTENDANCE (bilingual) and the Urdu month and
 * weekday names; class and child names stay as the API sends them; English dates are exactly as before.
 * MACHINE-DRAFTED Urdu from the bot's (حاضری، حاضری لگائیں، کلاس چنیں، آپ کی کلاسیں).
 */

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null }));
vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));

import api from "../../services/api";
import { AttendanceHub } from "./AttendanceHub";
import { ATTENDANCE_V2_COPY_UR as U } from "./copy";
import { dayLabel, monthLabel } from "./model";

const http = api as unknown as { get: ReturnType<typeof vi.fn> };
const plain = (t: string | null) => (t || "").replace(/[⁦⁩]/g, "");

beforeEach(async () => {
  vi.clearAllMocks();
  http.get.mockResolvedValue({ data: { date: "2026-10-08", classes: [
    { listId: "l1", label: "Grade 4 - A", grade: 4, section: "A", subjects: ["Math"], students: 30, marked: false, present: null, absent: null, leave: null },
    { listId: "l2", label: "Grade 5 - B", grade: 5, section: "B", subjects: ["English"], students: 28, marked: true, present: 26, absent: 2, leave: 0 },
  ] } });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("ur"); });
});

describe("Attendance in Urdu", () => {
  it("the selector: title, search, the Not marked and Marked chips, today's date", async () => {
    render(<MemoryRouter><AttendanceHub /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(U.title);
    expect((await screen.findAllByText(U.notMarked)).length).toBeGreaterThan(0);
    const text = plain(document.body.textContent);
    expect(text).toContain(U.markedOf(26, 28));
    expect(text).toContain("جمعرات 8 اکتوبر");
    expect(screen.queryByText("Not marked")).toBeNull();
  });
});

describe("month and day names", () => {
  it("Urdu when asked; English exactly as before", () => {
    expect(monthLabel("2026-10", "ur")).toBe("اکتوبر 2026");
    expect(dayLabel("2026-10-08", "ur")).toBe("جمعرات 8 اکتوبر");
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(dayLabel("2026-10-08")).toBe(new Date("2026-10-08T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", ""));
  });
});
