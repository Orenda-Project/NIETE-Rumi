import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { tapProblems } from "../../newui/checks/rules";
import { SelectField, Tabs, ChoiceChips, StatStrip, ScoreRing, TrendChart, AudioCard, RecordUploadPair } from "./index";

/** bd-4404s7.1 (PR 2c) — SelectField, Tabs, ChoiceChips, StatStrip, ScoreRing, TrendChart, AudioCard, RecordUploadPair. */
beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const OPTS = [{ value: "", label: "All coaches", sub: "6 coaches" }, { value: "a", label: "Asma Khan" }, { value: "s", label: "Sana Nasir" }];

describe("SelectField", () => {
  it("a 68px field showing the choice (or the placeholder); a tap opens a Tray of 56px+ options", () => {
    const onChange = vi.fn();
    const { container } = render(<SelectField label="Coach" title="Select coach" value="a" options={OPTS} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /Coach.*Asma Khan/ });
    expect(trigger.className).toMatch(/min-h-\[68px\]/);
    expect(tapProblems(container)).toEqual([]);
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Select coach")).toBeTruthy();
    expect(tapProblems(document.body)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: /Sana Nasir/ }));
    expect(onChange).toHaveBeenCalledWith("s");
    expect(screen.queryByRole("dialog")).toBeNull(); // a pick closes it
  });
  it("the picked option is marked; options can carry a second line", () => {
    render(<SelectField label="Coach" title="Select coach" value="" options={OPTS} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Coach/ }));
    const picked = screen.getByRole("button", { name: /All coaches/, pressed: true });
    expect(picked).toBeTruthy();
    expect(screen.getAllByText("6 coaches").length).toBeGreaterThan(0);
  });
  it("nothing chosen shows the placeholder (Select)", () => {
    render(<SelectField label="School" title="Select school" value={null} options={OPTS} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /School.*Select/ })).toBeTruthy();
  });
  it("disabled is not openable", () => {
    render(<SelectField label="School" title="s" value={null} options={OPTS} onChange={() => {}} disabled />);
    expect(screen.getByRole("button", { name: /School/ })).toBeDisabled();
  });
});

describe("Tabs", () => {
  it("buttons: a tablist with counts, the picked one indigo, 56px", () => {
    const onChange = vi.fn();
    const { container } = render(<Tabs label="Schools and teachers" value="schools" onChange={onChange} tabs={[{ key: "schools", label: "Schools", count: 12 }, { key: "teachers", label: "Teachers", count: 84 }]} />);
    expect(screen.getByRole("tablist", { name: "Schools and teachers" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Schools/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Teachers/ }).textContent).toContain("84");
    expect(tapProblems(container)).toEqual([]);
    fireEvent.click(screen.getByRole("tab", { name: /Teachers/ }));
    expect(onChange).toHaveBeenCalledWith("teachers");
  });
  it("tabs with `to` are links, the current one aria-current", () => {
    inRouter(<Tabs label="x" value="b" tabs={[{ key: "a", label: "A", to: "/a" }, { key: "b", label: "B", to: "/b" }]} />);
    expect(screen.getByRole("link", { name: "A" })).toHaveAttribute("href", "/a");
    expect(screen.getByRole("link", { name: "B" })).toHaveAttribute("aria-current", "page");
  });
});

describe("ChoiceChips", () => {
  it("a radiogroup of chips with a label; the picked one indigo; each a 56px target", () => {
    const onChange = vi.fn();
    const { container } = render(<ChoiceChips label="Sort" value="least" onChange={onChange} options={[{ key: "least", label: "Least visited" }, { key: "most", label: "Most visited" }]} />);
    expect(screen.getByRole("radiogroup", { name: "Sort" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Least visited" })).toHaveAttribute("aria-checked", "true");
    expect(tapProblems(container)).toEqual([]);
    fireEvent.click(screen.getByRole("radio", { name: "Most visited" }));
    expect(onChange).toHaveBeenCalledWith("most");
    expect(screen.getByText("Sort")).toBeTruthy();
  });
  it("multiple: toggles, value is a list", () => {
    const onChange = vi.fn();
    render(<ChoiceChips label="Teaching level" multiple value={["p"]} onChange={onChange} options={[{ key: "p", label: "Primary" }, { key: "m", label: "Middle" }]} />);
    expect(screen.getByRole("button", { name: "Primary" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Middle" }));
    expect(onChange).toHaveBeenCalledWith(["p", "m"]);
    fireEvent.click(screen.getByRole("button", { name: "Primary" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("StatStrip", () => {
  it("flat numbers in a row, a dash when missing, each a named group", () => {
    render(<StatStrip items={[{ value: 0, label: "Visits" }, { value: null, label: "Since visit" }, { value: 31, label: "Teachers" }, { value: "66%", label: "Avg. HITL Score" }]} />);
    expect(screen.getByRole("group", { name: "Visits, 0" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Since visit, —" })).toBeTruthy();
    expect(screen.getByText("66%")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("5 columns at most", () => {
    const { container } = render(<StatStrip items={Array.from({ length: 7 }, (_, i) => ({ value: i, label: `L${i}` }))} />);
    expect(container.querySelectorAll("[data-stat]")).toHaveLength(5);
  });
});

describe("ScoreRing", () => {
  it("a ring filled to the percentage with the number inside and a spoken name", () => {
    render(<ScoreRing value={64} label="Digital Coach score" />);
    const ring = screen.getByRole("img", { name: "Digital Coach score 64%" });
    // jsdom drops conic-gradient, so the fill is asserted by its data attribute (the style line is one template string)
    expect(ring.getAttribute("data-pct")).toBe("64");
    expect(ring.textContent).toBe("64%");
  });
  it("no score shows a dash on an empty ring; values are clamped", () => {
    const { unmount } = render(<ScoreRing value={null} label="Score" />);
    expect(screen.getByRole("img", { name: "Score —" }).textContent).toBe("—");
    unmount();
    render(<ScoreRing value={140} label="Score" />);
    expect(screen.getByRole("img").getAttribute("data-pct")).toBe("100");
  });
  it("size", () => {
    render(<ScoreRing value={50} label="S" size={48} />);
    expect(screen.getByRole("img")).toHaveStyle({ width: "48px", height: "48px" });
  });
});

describe("TrendChart", () => {
  const pts = [
    { date: "2026-08-12", value: 70, kind: "hitl" as const }, { date: "2026-08-30", value: 56, kind: "dc" as const },
    { date: "2026-09-09", value: 62, kind: "hitl" as const }, { date: "2026-10-06", value: 34, kind: "hitl" as const },
  ];
  it("two series on one scale: HITL filled, DC hollow green, joined by a line, with a legend", () => {
    const { container } = render(<TrendChart points={pts} label="HITL and DC scores" dateLabel={(d) => d.slice(5)} legend={{ hitl: "HITL", dc: "DC" }} />);
    expect(screen.getByRole("img", { name: "HITL and DC scores" })).toBeTruthy();
    expect(container.querySelectorAll("circle[data-kind='hitl']")).toHaveLength(3);
    const dc = container.querySelector("circle[data-kind='dc']")!;
    expect(dc.getAttribute("fill")).toBe("#fff");
    expect(dc.getAttribute("stroke")).toBe("#48b078");
    expect(container.querySelector("polyline")).not.toBeNull();
    expect(screen.getByText("HITL")).toBeTruthy();
    expect(screen.getByText("08-12")).toBeTruthy();
  });
  it("one point: a dot, no line", () => {
    const { container } = render(<TrendChart points={pts.slice(0, 1)} label="x" dateLabel={(d) => d} />);
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(container.querySelector("polyline")).toBeNull();
  });
  it("band rows (Analytics' rating over time): dots sit on the row they name", () => {
    const rows = [{ key: "a", label: "Excellent" }, { key: "b", label: "Good" }, { key: "c", label: "Fair" }];
    const { container } = render(<TrendChart points={[{ date: "d1", row: 0 }, { date: "d2", row: 2 }]} rows={rows} label="Rating" dateLabel={(d) => d} />);
    expect(screen.getByText("Excellent")).toBeTruthy();
    const ys = Array.from(container.querySelectorAll("circle")).map((c) => Number(c.getAttribute("cy")));
    expect(ys[1]).toBeGreaterThan(ys[0]);
  });
});

describe("AudioCard", () => {
  it("a card with a 56px play ring, the title and a second line; a lead and an action slot", () => {
    const { container } = render(<AudioCard title="Ayesha Bibi's observation" sub="38 min · just now" lead={<ScoreRing value={64} label="Score" />} action={<button type="button" className="min-h-[56px]">Redo</button>} />);
    expect(screen.getByText("Ayesha Bibi's observation")).toBeTruthy();
    expect(screen.getByText("38 min · just now")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Score 64%" })).toBeTruthy();
    expect(tapProblems(container)).toEqual([]);
  });
  it("with a src it plays for real (preload none) and flips to Pause; one at a time", () => {
    const play = vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event("play")); return Promise.resolve(); });
    const pause = vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event("pause")); });
    const { container } = render(<div><AudioCard title="One" src="/a.webm" /><AudioCard title="Two" src="/b.webm" /></div>);
    const audios = container.querySelectorAll("audio");
    expect(audios[0]).toHaveAttribute("preload", "none");
    const [p1, p2] = screen.getAllByRole("button", { name: "Play" });
    fireEvent.click(p1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Pause" })).toHaveLength(1);
    fireEvent.click(p2);
    expect(pause).toHaveBeenCalled(); // the first was paused by the second starting
    play.mockRestore(); pause.mockRestore();
  });
});

describe("RecordUploadPair", () => {
  it("two squares in one box, no heading: Start recording (dark) and Upload recording (white), 176px", () => {
    const rec = vi.fn(); const up = vi.fn();
    const { container } = inRouter(<RecordUploadPair onRecord={rec} onUpload={up} />);
    const r = screen.getByRole("button", { name: "Start recording" });
    const u = screen.getByRole("button", { name: "Upload recording" });
    expect(r.className).toMatch(/min-h-\[176px\]/);
    expect(r.className).toMatch(/bg-\[#33374a\]/);
    expect(u.className).toMatch(/bg-white/);
    expect(tapProblems(container)).toEqual([]);
    fireEvent.click(r); fireEvent.click(u);
    expect(rec).toHaveBeenCalled(); expect(up).toHaveBeenCalled();
    expect(container.querySelector("h1,h2,h3")).toBeNull();
  });
  it("links when given `recordTo` / `uploadTo`; small actions underneath (Reschedule, Cancel visit)", () => {
    const cancel = vi.fn();
    inRouter(<RecordUploadPair recordTo="/r" uploadTo="/u" actions={[{ key: "re", label: "Reschedule", to: "/re" }, { key: "c", label: "Cancel visit", onPress: cancel, danger: true }]} />);
    expect(screen.getByRole("link", { name: "Start recording" })).toHaveAttribute("href", "/r");
    expect(screen.getByRole("link", { name: "Reschedule" })).toHaveAttribute("href", "/re");
    fireEvent.click(screen.getByRole("button", { name: "Cancel visit" }));
    expect(cancel).toHaveBeenCalled();
  });
  it("the recording icon pulses only when motion is allowed (a CSS class, never an animate- utility)", () => {
    const { container } = inRouter(<RecordUploadPair onRecord={() => {}} onUpload={() => {}} />);
    expect(container.querySelector(".rup-core")).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/animate-/);
  });
  it("Urdu words", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    inRouter(<RecordUploadPair onRecord={() => {}} onUpload={() => {}} />);
    expect(screen.getByRole("button", { name: "ریکارڈنگ شروع کریں" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ریکارڈنگ اپ لوڈ کریں" })).toBeTruthy();
  });
});
