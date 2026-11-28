import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import i18n from "i18next";

/**
 * bd-pdwwk4.6.20 — "Share with your class": the class link card up top while a link is unsent (the server's `top: true`,
 * switch web_quiz_class_link_share). Teachers almost never forwarded the link while the card sat last on Home, under every
 * tile. Home draws two slots, ONE /class-link ask between them, and exactly one of them draws the card:
 *   - top: only with `top: true` AND a class whose link was not sent this term;
 *   - bottom (the default, today's place): every other case — so with the switch off, Home is as it was.
 * And tonight's ready line no longer says "nothing to send" to a teacher whose class link never went out.
 */
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from "../../services/api";
import { ClassLinkCard } from "./ClassLinkCard";
import { CLASS_LINK_COPY as EN } from "../classlink/copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
const URL1 = "https://quiz.example.org/j/K7QM2XR9TB";
const C1 = { classId: "c1", grade: 3, section: "A", url: URL1, sendHref: `https://wa.me/?text=${encodeURIComponent(`${URL1}?f=1`)}`, sent: false, round: null };
const on = (body: unknown) => http.get.mockResolvedValue({ data: body });

function Both() {
  return (<div><div data-testid="top-slot"><ClassLinkCard slot="top" /></div><div data-testid="bottom-slot"><ClassLinkCard /></div></div>);
}
const drawn = () => ({
  top: !!screen.getByTestId("top-slot").querySelector("[data-testid=class-link-card]"),
  bottom: !!screen.getByTestId("bottom-slot").querySelector("[data-testid=class-link-card]"),
});

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  http.get.mockReset();
  http.post.mockReset();
  http.post.mockResolvedValue({ data: { ok: true } });
});

describe("ClassLinkCard slots", () => {
  it("switch on, a link unsent: the card draws up top only, from one ask", async () => {
    on({ classes: [C1], reportHref: null, top: true });
    render(<Both />);
    await flush();
    expect(drawn()).toEqual({ top: true, bottom: false });
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it("switch on, every link sent: back at the bottom (the folded line)", async () => {
    on({ classes: [{ ...C1, sent: true }], reportHref: null, top: true });
    render(<Both />);
    await flush();
    expect(drawn()).toEqual({ top: false, bottom: true });
  });

  it("switch off (no top key): today's place, the bottom", async () => {
    on({ classes: [C1], reportHref: null });
    render(<Both />);
    await flush();
    expect(drawn()).toEqual({ top: false, bottom: true });
  });

  it("a tap on Send up top folds the class there; the card does not jump to the bottom", async () => {
    on({ classes: [C1], reportHref: null, top: true });
    render(<Both />);
    await flush();
    await act(async () => { screen.getByTestId("class-link-send").click(); });
    expect(drawn()).toEqual({ top: true, bottom: false });
    expect(screen.getByTestId("class-link-sent")).toBeTruthy();
  });
});

describe("tonight's line while the class link is unsent", () => {
  it("asks the teacher to send the link, never 'nothing to send'", async () => {
    on({ classes: [{ ...C1, round: { lesson: "Adding two-digit numbers", played: 0 } }], reportHref: null, top: true });
    render(<ClassLinkCard slot="top" />);
    await flush();
    const line = screen.getByTestId("class-link-round").textContent || "";
    expect(line).toContain(EN.readyUnsent("Adding two-digit numbers"));
    expect(line).not.toMatch(/nothing to send/);
  });

  it("once sent: today's line", async () => {
    on({ classes: [{ ...C1, sent: true, round: { lesson: null, played: 0 } }], reportHref: null });
    render(<ClassLinkCard />);
    await flush();
    expect(screen.getByTestId("class-link-round").textContent).toContain(EN.readyNoLesson);
  });
});
