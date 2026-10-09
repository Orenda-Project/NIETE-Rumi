import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { render, fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { newUiSourceFiles, scanCopy, scanStyle } from "../../newui/checks/source";
import { collectCopy, copyProblem, tapProblems } from "../../newui/checks/rules";
import { TEACHER_UI_COPY } from "./copy";
import { GradeSubjectButton } from "./GradeSubjectButton";
import { HistoryList } from "./HistoryList";
import { HistoryRow } from "./HistoryRow";
import { ListRow } from "./ListRow";
import { ClassPicker } from "./ClassPicker";
import { DateRangeBar } from "./DateRangeBar";
import { ProgressSteps } from "./ProgressSteps";
import { VoiceNote } from "./VoiceNote";

/**
 * bd-fmf24g.2 — the teacher kit's design rules, checked with the new UI's own checkers (newui/checks):
 *   tap   every button, link and input a kit component renders is a 56px target;
 *   style left/right utilities (Urdu mirrors: start/end only), motion outside motion-safe:, and the theme's
 *         lying `grid` / `rounded-lg|md|sm` are refused. Raw hexes are allowed here: the teacher app is drawn in
 *         the canvas's coach-v2 look (#33374a, #f3f4f6, #e5e7eb …), as coach/ui.tsx is;
 *   copy  words come from copy.ts (≤4 words, never a sentence) or from props — none written into a component.
 */

// __dirname, not import.meta.url: under jsdom the module URL is http://.
const TEACHER_DIRS = [resolve(__dirname), resolve(__dirname, "../icons")];
const files = () => TEACHER_DIRS.flatMap((d) => newUiSourceFiles(d).map((f) => ({ ...f, rel: `${d.split(/[\\/]/).pop()}/${f.rel}` })));
const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("teacher kit: style", () => {
  it("reads the kit's source", () => {
    const rels = files().map((f) => f.rel);
    expect(rels).toEqual(expect.arrayContaining(["ui/GradeSubjectButton.tsx", "ui/HistoryList.tsx", "icons/FeatureArt.tsx"]));
  });

  it("no left/right utilities, no motion outside motion-safe:, no lying theme classes", () => {
    // The one false positive: the prose "~1 min left" (notify.timeLeft, bd-fmf24g.15) — the checker splits any string on spaces
    // and reads a lone "left" as the utility. It is the operator's design wording, and a word, not a class.
    const PROSE = (p: { file: string; rule: string; text: string }) => p.file === "ui/copy.ts" && p.rule === "physical" && p.text === "left";
    const problems = files().flatMap((f) => scanStyle(f.rel, f.text)).filter((p) => p.rule !== "raw-colour" && p.rule !== "feature-colour" && !PROSE(p));
    expect(problems).toEqual([]);
  });

  it("the checker still catches them (planted)", () => {
    const planted = scanStyle("ui/Planted.tsx", "const c = 'ml-2 text-left animate-spin grid';").map((p) => p.rule);
    expect(planted).toEqual(expect.arrayContaining(["physical", "motion", "theme"]));
  });
});

describe("teacher kit: copy", () => {
  it("every default word is a label: at most 4 words, never a sentence", () => {
    // The one exception, with its reason: the hero report PNG's footer, word for word ("Made just for you, Ayesha"
    // is 5 words with her name) — report-v2/hero-report.template.js.
    const ALLOWED = [/^report\.madeFor\(/];
    const bad = collectCopy(TEACHER_UI_COPY)
      .filter((c) => copyProblem(c.text) && !ALLOWED.some((a) => a.test(c.path)))
      .map((c) => `${c.path}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it("no words written into a component (they come from copy.ts or props)", () => {
    const problems = files().filter((f) => !f.rel.endsWith("/copy.ts")).flatMap((f) => scanCopy(f.rel, f.text));
    expect(problems).toEqual([]);
  });

  it("the checker still catches them (planted)", () => {
    const planted = scanCopy("ui/Planted.tsx", 'const x = <button aria-label="Open the lesson plan you used today.">See all</button>;');
    expect(planted.map((p) => p.text)).toEqual(["Open the lesson plan you used today.", "See all"]);
  });
});

describe("teacher kit: every target is 56px or more", () => {
  it("GradeSubjectButton (card, row, link, button), ListRow (link, button, row), HistoryRow (link, download), HistoryList (toggle, See all, Show more)", () => {
    const { container } = inRouter(
      <div>
        <GradeSubjectButton grade={4} subject="Science" to="/a" />
        <GradeSubjectButton grade={4} subject="Science" onPress={() => {}} variant="row" state="selected" />
        <ListRow prefix="Chap" number="1" label="One" to="/c" />
        <ListRow prefix="Chap" number="2" label="Two" onPress={() => {}} variant="row" />
        <HistoryRow subject="Math" grade={5} title="Fractions" to="/h" />
        <HistoryRow subject="Math" grade={5} title="Fractions" action="download" onAction={() => {}} />
        <HistoryList heading="Recent" collapsible seeAllTo="/all" groups={[{ day: "Today", items: [{ subject: "Urdu", grade: 3, title: "A", to: "/x" }] }]} />
        <HistoryList heading="Recent" collapsible groups={[{ day: "Today", items: [{ subject: "Urdu", grade: 3, title: "A", to: "/x" }] }]} onShowMore={() => {}} />
        <HistoryList heading="Recent" seeAllTo="/all" groups={[{ day: "Today", items: [{ subject: "Urdu", grade: 3, title: "A", to: "/x" }] }]} />
      </div>,
    );
    expect(tapProblems(container)).toEqual([]);
  });

  it("ClassPicker: the trigger, the grade buttons, the subjects (buttons and links), her-classes-only rows", () => {
    const combos = [3, 4, 5, 6, 7].flatMap((g) => [{ grade: g, subject: "Math" }, { grade: g, subject: "English" }]);
    const { unmount } = inRouter(<ClassPicker label="Pick" combos={combos} value={{ grade: 4, subject: "Math" }} to={(v, p) => (p.mine ? `/x/${v.grade}` : undefined)} />);
    expect(tapProblems(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Grade 4 · Math/ }));
    expect(tapProblems(document.body)).toEqual([]);
    unmount();
    inRouter(<ClassPicker label="Mine" combos={combos.slice(0, 3)} allowOther={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Mine/ }));
    expect(tapProblems(document.body)).toEqual([]);
  });

  it("DateRangeBar: the button, the tray's choices, the dates and Show", () => {
    render(<DateRangeBar today="2026-10-08" />);
    expect(tapProblems(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /This month/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Select dates" }));
    expect(tapProblems(document.body)).toEqual([]);
  });

  it("ProgressSteps' Done line and VoiceNote's play", () => {
    const { container } = render(<div>
      <ProgressSteps steps={[{ label: "A", state: "done" }]} done doneLabel="Report ready" />
      <VoiceNote from="Digital Coach" duration="1:30" time="11:06" src="/v.mp3" />
    </div>);
    expect(tapProblems(container)).toEqual([]);
  });
});
