import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import i18n from "i18next";

/**
 * bd-gzfdu9 (VIDREC, SPEC §4.7) — the recommended clip's card on the portal report, under "Try next class": a 16:9
 * thumbnail, the clip's title, "⏱ {n} min · {language}", the why line, and ONE full-width Watch button that opens the
 * /v player in the same tab. No level is shown (SPEC v1.2.1). Nothing at all when the API sent no card.
 */

vi.mock("../../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  portal: {},
  language: { get: vi.fn(() => new Promise(() => {})), set: vi.fn() },
}));

import { VideoRecoCard } from "./VideoRecoCard";
import { COACHING_V2_COPY as C, COACHING_V2_COPY_UR as U } from "./copy";

const CARD = {
  title: "Asking why-questions",
  levelLabel: null,
  durationS: 120,
  language: "ur",
  reason: "At 12:40 a question was answered at once; this clip shows the wait.",
  thumbUrl: "/v/thumb/3.jpg",
  href: "/v/tok-abc?s=portal",
};

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});

describe("VideoRecoCard", () => {
  it("no card → nothing rendered", () => {
    expect(render(<VideoRecoCard video={null} />).container.innerHTML).toBe("");
    expect(render(<VideoRecoCard video={undefined} />).container.innerHTML).toBe("");
  });

  it("English: heading, title, minutes · language, the why line, one Watch link to the player in the same tab", () => {
    render(<VideoRecoCard video={CARD} />);
    const card = screen.getByRole("region", { name: C.videoRecoCardTitle });
    expect(screen.getByRole("heading", { name: "🎬 Watch this next" })).toBeTruthy();
    expect(card.textContent).toContain("Asking why-questions");
    expect(card.textContent).toContain("⏱ 2 min · Urdu");
    expect(card.textContent).toContain(CARD.reason);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("Watch (2 min)");
    expect(links[0].getAttribute("href")).toBe("/v/tok-abc?s=portal");
    expect(links[0].getAttribute("target")).toBeNull();
    const img = card.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/v/thumb/3.jpg");
    // SPEC v1.2.1: no surface shows the ladder level.
    expect(card.textContent).not.toMatch(/Level|Aspiring|Emerging|Skilled/);
  });

  it("Urdu: the page's words in Urdu, the API's title and reason as sent", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    render(<VideoRecoCard video={{ ...CARD, title: "کیوں والے سوال پوچھنا", reason: "اس کلپ میں سوال کے بعد انتظار دکھایا گیا ہے۔", durationS: 75 }} />);
    expect(screen.getByRole("heading", { name: U.videoRecoCardTitle })).toBeTruthy();
    const card = screen.getByRole("region", { name: U.videoRecoCardTitle });
    expect(card.textContent).toContain("⏱ 1 منٹ · اردو");
    expect(card.textContent).toContain("کیوں والے سوال پوچھنا");
    expect(screen.getByRole("link").textContent).toBe("دیکھیں (1 منٹ)");
    expect(card.textContent).not.toMatch(/Watch|min\b|Urdu/);
  });

  it("a clip with no length or unknown language: no invented minutes, a plain Watch", () => {
    render(<VideoRecoCard video={{ ...CARD, durationS: null, language: null, thumbUrl: null }} />);
    const card = screen.getByRole("region", { name: C.videoRecoCardTitle });
    expect(card.textContent).not.toContain("⏱");
    expect(screen.getByRole("link").textContent).toBe("Watch");
    expect(card.querySelector("img")).toBeNull();
  });

  it("a card with no link is not drawn (nothing to open)", () => {
    expect(render(<VideoRecoCard video={{ ...CARD, href: "" }} />).container.innerHTML).toBe("");
  });

  it("fits a 360 px phone: no fixed width wider than the screen, long words wrap", () => {
    const { container } = render(<VideoRecoCard video={{ ...CARD, title: "A".repeat(80) }} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/w-\[(3[7-9]\d|[4-9]\d\d)px\]|min-w-\[(3[7-9]\d|[4-9]\d\d)px\]/);
    expect(html).toContain("break-words");
  });
});

// R7p (COS 20261026T043131 §2): card-mode reasons as production stores them (tests/coaching/video-reco/
// fixtures-r7p-app-card.json, from the $0 fresh-5 replay on sandbox 10de2eb303): the card sentence sits in an FSI…PDI
// isolate, an Urdu sentence inside an English line, and an Urdu line whose quote opens on a digit.
const CARD_MODE = [
  ["en", "Your report asks you to try: \"⁨اگلی کلاس میں، جب آپ board task شروع کریں، تو بورڈ پر دو versions لکھیں: basic (add 's' words) اور stretch (words needing 'es' یا spelling change)، ہر open-ended question کے بعد 5–7 سیکنڈ wait time رکھیں۔⁩\". This clip shows one way to do it."],
  ["ur", "آپ کی رپورٹ کہتی ہے کہ یہ آزمائیں: \"⁨اگلی کلاس میں، جب بورڈ پر '2 کے نیچے 0' والا place value مثال دکھائیں، تو ہر worked example کے بعد ایک مختصر open-ended question 'یہاں 0 کیوں؟' پوچھیں، 5 سیکنڈ wait time دیں اور ایک طالب علم سے ایک sentence میں سمجھائیں۔⁩\"۔ یہ کلپ اس کا ایک طریقہ دکھاتا ہے۔"],
] as const;

describe("VideoRecoCard, card mode (R7p)", () => {
  it.each(CARD_MODE)("%s: the stored reason is drawn whole, isolate intact, dir=auto; one Watch link to the app's /v", async (lng, reason) => {
    await act(async () => { await i18n.changeLanguage(lng); });
    render(<VideoRecoCard video={{ ...CARD, durationS: 51.57, reason }} />);
    const why = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === reason);
    expect(why.getAttribute("dir")).toBe("auto");
    expect(why.textContent).toMatch(/\u2068[^\u2069]+\u2069/);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/v/tok-abc?s=portal");
  });
});
