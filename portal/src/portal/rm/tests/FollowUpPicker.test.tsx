import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../../services/api", () => ({ portal: { getConfig: vi.fn() }, language: { get: vi.fn(), set: vi.fn() }, default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../components/PortalLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div> }));
vi.mock("../../lib/recordingSession", () => ({ useRecordingSession: () => null, useLogoutGuard: (f: unknown) => f }));

import { boot, F, http, renderRm, rmWorld, serve, settle } from "./harness";
import { composeLines, defaultDue, joinSchools, wForIntervention } from "../compose";

/**
 * bd-sex15q.17 — G8, the RM's follow-up: template, W, one to three of THAT coach's schools, the date; a preview of the
 * three lines in both languages; "Send" posts exactly {coach_user_id, template_id, w_id, school_ids, due_on} (A11): no
 * lines, no codes, no free text. The server composes what the coach reads.
 */
const C03 = "00000000-0000-4000-8000-070000000003";
const S01 = "00000000-0000-4000-8000-010000000001";
const S05 = "00000000-0000-4000-8000-010000000005";
const S06 = "00000000-0000-4000-8000-010000000006";

async function openFor(label = "C-03") {
  await renderRm("");
  const row = screen.getAllByTestId("coach-row").find((r) => within(r).getByTestId("coach-label").textContent === label)!;
  fireEvent.click(within(row).getByTestId("follow-up"));
  await settle();
  return screen.getByTestId("follow-up-picker");
}

describe.each(["en", "ur"] as const)("FollowUpPicker (%s)", (lang) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T05:00:00Z"));
    await boot(lang);
    serve(rmWorld());
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("opens on the coach's own schools (R18), defaults from the needs-me reason, and previews three lines in both languages", async () => {
    const dlg = await openFor();
    expect(http.get.mock.calls.map((c: unknown[]) => c[0])).toContain(`/coachip/rm/coach/${C03}`);
    // C-03 needs me because S-06 is unvisited → RM-T2 "a visit is due", with the unvisited school picked
    expect((within(dlg).getByTestId("picker-template-RM-T2") as HTMLInputElement).checked).toBe(true);
    const picked = within(dlg).getAllByTestId("picker-school").filter((b) => (b as HTMLInputElement).checked).map((b) => b.getAttribute("data-school"));
    // C-03's S-06 is 6 weeks unvisited (S-05 is 3): only S-06 is due a visit
    expect(picked).toEqual([S06]);
    expect((within(dlg).getByTestId("picker-date") as HTMLInputElement).value).toBe("2026-10-30");
    const own = within(dlg).getByTestId(`picker-preview-${lang}`).querySelectorAll("li");
    const other = within(dlg).getByTestId(`picker-preview-${lang === "en" ? "ur" : "en"}`).querySelectorAll("li");
    expect(own).toHaveLength(3);
    expect(other).toHaveLength(3);
    const en = within(dlg).getByTestId("picker-preview-en").textContent || "";
    expect(en.replace(/[⁦-⁩]/g, "")).toContain("Govt. Primary School Fictional-06 have had no visit for 4 weeks or more.");
    expect(en).toContain("30 Oct");
    expect(/T-\d{2}/.test(dlg.textContent || "")).toBe(false);
  });

  it("Send posts exactly the five contract keys, nothing typed, no lines, no codes", async () => {
    const dlg = await openFor();
    fireEvent.click(within(dlg).getByTestId("picker-template-RM-T1"));
    fireEvent.click(within(dlg).getByTestId("picker-w-W-IP-TIME"));
    await act(async () => { fireEvent.click(within(dlg).getByTestId("picker-send")); });
    await settle();
    const posts = http.post.mock.calls.filter((c: unknown[]) => c[0] === "/coachip/rm/notes");
    expect(posts).toHaveLength(1);
    const body = posts[0][1] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["coach_user_id", "due_on", "school_ids", "template_id", "w_id"]);
    expect(body).toEqual({ coach_user_id: C03, template_id: "RM-T1", w_id: "W-IP-TIME", school_ids: [S06], due_on: "2026-10-30" });
    expect(JSON.stringify(body)).not.toMatch(/lines|codes|code_id|text|T-\d/);
    expect(screen.getByTestId("picker-sent")).toBeTruthy();
  });

  it("one to three schools: a fourth cannot be picked, none disables Send", async () => {
    const dlg = await openFor();
    const box = (id: string) => within(dlg).getAllByTestId("picker-school").find((b) => b.getAttribute("data-school") === id) as HTMLInputElement;
    fireEvent.click(box(S01));
    fireEvent.click(box(S05));
    const boxes = within(dlg).getAllByTestId("picker-school") as HTMLInputElement[];
    expect(boxes.filter((b) => b.checked)).toHaveLength(3);
    expect(boxes.filter((b) => !b.checked).every((b) => b.disabled)).toBe(true);
    for (const id of [S01, S05, S06]) fireEvent.click(box(id));
    expect((within(dlg).getByTestId("picker-send") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a refused send says so and stays open; nothing else is written", async () => {
    serve(rmWorld({ "POST /coachip/rm/notes": () => { throw Object.assign(new Error("400"), { response: { status: 400, data: { error: "bad_request" } } }); } }));
    const dlg = await openFor();
    await act(async () => { fireEvent.click(within(dlg).getByTestId("picker-send")); });
    await settle();
    expect(screen.getByTestId("picker-failed")).toBeTruthy();
    expect(http.post.mock.calls.filter((c: unknown[]) => c[0] !== "/coachip/rm/notes")).toEqual([]);
  });

  it("the Monday bar walks the needs-me coaches without an open note, one picker at a time", async () => {
    await renderRm("");
    fireEvent.click(screen.getByTestId("rm-monday"));
    await settle();
    expect(screen.getByTestId("follow-up-picker").textContent).toContain("C-02");
  });
});

describe("compose (the preview only)", () => {
  it("joins schools per language and fills every slot", () => {
    expect(joinSchools(["A", "B", "C"], "en")).toBe("A, B and C");
    expect(joinSchools(["A"], "en")).toBe("A");
    const [l1, l2, l3] = composeLines("RM-T1", { w_short: { en: "Ran out of time", ur: "وقت ختم ہو گیا" }, schools: ["S"], due_on: "2026-10-30", i_title: null }, "en");
    expect(l1).toBe('This month "Ran out of time" shows most at S.');
    expect(l2).toBe('Please run "the first school step for this move" there before 30 Oct.');
    expect(l3).toBe("Bring the moment to the Friday circle.");
    for (const tid of ["RM-T1", "RM-T2", "RM-T3", "RM-T4"] as const) {
      for (const l of ["en", "ur"] as const) {
        expect(composeLines(tid, { w_short: { en: "W", ur: "W" }, schools: ["S"], due_on: "2026-10-30", i_title: { en: "I", ur: "I" } }, l).join(" ")).not.toMatch(/\{[a-z_]+\}/);
      }
    }
  });
  it("the due date defaults to this week's Friday (Karachi), the W of a library id is its prefix", () => {
    expect(defaultDue("2026-10-26")).toBe("2026-10-30");
    expect(defaultDue("2026-10-30")).toBe("2026-10-30");
    expect(defaultDue("2026-10-31")).toBe("2026-11-06");
    expect(wForIntervention("I-IP-TIME-3")).toBe("W-IP-TIME");
    expect(wForIntervention("I-IP-4")).toBe("W-IP");
    expect(wForIntervention("I-PHON-NAMES-1")).toBe("W-PHON-NAMES");
    expect(wForIntervention("nonsense")).toBeNull();
  });
});
