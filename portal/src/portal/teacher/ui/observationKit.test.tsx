import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { ReadyTray, type TrayRow } from "./ReadyTray";
import { ReadyBanner } from "./ReadyBanner";
import { LeaveNote } from "./LeaveNote";

/**
 * bd-4404s7.4 — the kit's notices speak of a coach's observation being SENT: the strip's ring in the observation red
 * with its own state line, the banner's "Observation sent" / "Couldn't send", and the leave note's second line.
 */
const row = (over: Partial<TrayRow> = {}): TrayRow => ({
  id: "observation:v1", feature: "observations", what: "Observation", gradeSubject: "Ayesha Bibi", title: "Tue 6 Oct · 38 min",
  state: "making", progress: 0.62, left: "", to: "/portal/coach/visit/v1/sending", status: "Sending · 62%", ...over,
});
const b = { id: "observation:v1", feature: "observations" as const, what: "Observation", title: "Ayesha Bibi", line: "Tue 6 Oct · 38 min" };

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("ReadyTray for an observation", () => {
  it("shows its own state line, in the observation red, not 'Being made · Almost done'", () => {
    render(<MemoryRouter><ReadyTray items={[row()]} onOpenList={() => {}} /></MemoryRouter>);
    const link = within(screen.getByRole("region", { name: "Being made" })).getByRole("link");
    expect(link).toHaveTextContent("Observation · Ayesha Bibi");
    expect(link).toHaveTextContent("Sending · 62%");
    expect(link).not.toHaveTextContent("Almost done");
    expect(link).toHaveAccessibleName(/Observation, Ayesha Bibi, Tue 6 Oct · 38 min\. Sending · 62%/);
    expect(screen.getByTestId("notice-ring")).toHaveAttribute("data-progress", "62");
    expect(link.querySelector("circle:last-child")).toHaveAttribute("stroke", "#c8331f");
  });

  it("a plan or a paper row is exactly as before", () => {
    render(<MemoryRouter><ReadyTray items={[row({ feature: "lessons", what: "Lesson plan", status: undefined, left: "~1 min left" })]} onOpenList={() => {}} /></MemoryRouter>);
    expect(screen.getByRole("link")).toHaveTextContent("Being made · ~1 min left");
  });
});

describe("ReadyBanner for an observation", () => {
  it("sent: 'Observation sent', the name, the day and length, Open", () => {
    render(<ReadyBanner items={[b]} onOpen={() => {}} onClose={() => {}} onExpire={() => {}} />);
    const banner = screen.getByTestId("ready-banner");
    expect(banner).toHaveAccessibleName("Observation sent");
    expect(banner).toHaveTextContent("Ayesha Bibi");
    expect(banner).toHaveTextContent("Tue 6 Oct · 38 min");
    expect(screen.getByTestId("banner-bar")).toHaveAttribute("data-hue", "#c8331f");
  });

  it("failed: 'Couldn't send' (not 'Couldn't make it'), the reason, Try again", () => {
    render(<ReadyBanner variant="failed" items={[b]} reason="The internet stopped." onRetry={() => {}} onOpen={() => {}} onClose={() => {}} onExpire={() => {}} />);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveAccessibleName("Couldn't send");
    expect(banner).toHaveTextContent("The internet stopped.");
    expect(within(banner).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<ReadyBanner items={[b]} onOpen={() => {}} onClose={() => {}} onExpire={() => {}} />);
    expect(screen.getByTestId("ready-banner")).toHaveAccessibleName("مشاہدہ بھیجا گیا");
  });
});

describe("LeaveNote", () => {
  it("carries a second, muted line when the screen has one", () => {
    render(<LeaveNote text="You can leave. We'll tell you here." sub="The observation keeps sending in the background." />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("You can leave. We'll tell you here.");
    expect(note).toHaveTextContent("The observation keeps sending in the background.");
  });

  it("is as before with no second line", () => {
    render(<LeaveNote text="x" />);
    expect(screen.getByRole("note").textContent).toBe("x");
  });
});
