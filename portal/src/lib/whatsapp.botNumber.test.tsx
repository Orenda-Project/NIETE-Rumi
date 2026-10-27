import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { resetNewUiMemory } from "@/portal/lib/useNewUi";
import { WHATSAPP_URL_PICKER as WA } from "@/lib/whatsapp";

/**
 * The WhatsApp chat buttons open THIS deployment's bot, never a number baked into the bundle.
 *
 * The portal is one build served by every tier (sandbox, staging, production). A constant number in the bundle sent
 * sandbox and staging testers to the production bot. The tier's own number lives on the server (WHATSAPP_BOT_NUMBER,
 * else REFERRAL_BOT_NUMBER) and reaches the browser at runtime as `bot` on GET /api/portal/config. No number there
 * (unset, or a failed read) means no chat button at all — never a fallback to some other bot.
 *
 * Only the network boundary is mocked (the api module's getConfig / auth calls); every component is the real one.
 */

const h = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setupSignIn: vi.fn(),
}));

vi.mock("@/portal/services/api", () => ({
  portal: { getConfig: h.getConfig },
  auth: { setupSignIn: h.setupSignIn },
  language: { get: vi.fn(), set: vi.fn() },
}));

import Hero from "@/components/Hero";
import Navigation from "@/components/Navigation";
import FinalCTA from "@/components/FinalCTA";
import HowItWorks from "@/pages/HowItWorks";
import { RegisterOnWhatsApp, chatLink } from "@/portal/auth/RegisterOnWhatsApp";
import PortalSetup from "@/portal/pages/PortalSetup";

// A made-up bot number, built from parts so the public repo holds no phone-shaped literal.
const BOT = ["92", "000", "0000001"].join("");
const SERVER_BOT = ["92", "000", "0000002"].join("");

type Mode = "bot" | "none" | "fails";
function setConfig(mode: Mode) {
  h.getConfig.mockReset();
  if (mode === "bot") h.getConfig.mockResolvedValue({ success: true, features: {}, bot: BOT });
  if (mode === "none") h.getConfig.mockResolvedValue({ success: true, features: {}, bot: null });
  if (mode === "fails") h.getConfig.mockRejectedValue(new Error("network"));
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

const waLinks = (root: ParentNode = document) =>
  Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="wa.me"]')).map((a) => a.getAttribute("href") || "");

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetNewUiMemory();
});

const MARKETING: Array<[string, () => JSX.Element]> = [
  ["Hero", () => <Hero />],
  ["Navigation", () => <Navigation />],
  ["FinalCTA", () => <FinalCTA />],
  ["HowItWorks", () => <HowItWorks />],
];

describe("marketing pages: the chat button opens the bot the server names", () => {
  it.each(MARKETING)("%s: every wa.me link is this tier's bot (from /config)", async (_name, ui) => {
    setConfig("bot");
    render(<MemoryRouter>{ui()}</MemoryRouter>);
    await settle();
    const links = waLinks();
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) expect(href.startsWith(`${WA}${BOT}?`)).toBe(true);
  });

  it.each(MARKETING)("%s: /config names no bot → no wa.me button at all", async (_name, ui) => {
    setConfig("none");
    render(<MemoryRouter>{ui()}</MemoryRouter>);
    await settle();
    expect(document.querySelector(`a[href^="${WA}9"]`)).toBeNull();
    expect(waLinks()).toEqual([]);
  });

  it.each(MARKETING)("%s: /config fails → no wa.me button at all", async (_name, ui) => {
    setConfig("fails");
    render(<MemoryRouter>{ui()}</MemoryRouter>);
    await settle();
    expect(document.querySelector(`a[href^="${WA}9"]`)).toBeNull();
    expect(waLinks()).toEqual([]);
  });

  it("the landing page's three buttons share ONE /config read", async () => {
    setConfig("bot");
    render(<MemoryRouter><Navigation /><Hero /><FinalCTA /></MemoryRouter>);
    await settle();
    expect(waLinks()).toHaveLength(3);
    expect(h.getConfig).toHaveBeenCalledTimes(1);
  });
});

describe("Register on WhatsApp (a number that is not registered)", () => {
  it("chatLink: the server's link wins over the config number", () => {
    const fromServer = `${WA}${SERVER_BOT}?text=%2Fregister`;
    expect(chatLink("/register", fromServer, BOT)).toBe(fromServer);
  });

  it("chatLink: no server link → this tier's config number with the command typed", () => {
    expect(chatLink("/register", null, BOT)).toBe(`${WA}${BOT}?text=${encodeURIComponent("/register")}`);
  });

  it("chatLink: neither → null (no button), never another bot", () => {
    expect(chatLink("/register", null, null)).toBeNull();
    expect(chatLink("/register", undefined, undefined)).toBeNull();
  });

  it("the button uses the server's link when it sends one", async () => {
    setConfig("bot");
    const fromServer = `${WA}${SERVER_BOT}?text=%2Fregister`;
    render(<MemoryRouter><RegisterOnWhatsApp href={fromServer} /></MemoryRouter>);
    await settle();
    expect(screen.getByRole("link", { name: "Register on WhatsApp" })).toHaveAttribute("href", fromServer);
  });

  it("no server link: the button opens the config number", async () => {
    setConfig("bot");
    render(<MemoryRouter><RegisterOnWhatsApp href={null} /></MemoryRouter>);
    await settle();
    expect(screen.getByRole("link", { name: "Register on WhatsApp" }))
      .toHaveAttribute("href", `${WA}${BOT}?text=${encodeURIComponent("/register")}`);
  });

  it.each(["none", "fails"] as const)("no server link and config %s: no button", async (mode) => {
    setConfig(mode);
    render(<MemoryRouter><RegisterOnWhatsApp href={null} /></MemoryRouter>);
    await settle();
    expect(screen.queryByRole("link", { name: "Register on WhatsApp" })).toBeNull();
    expect(waLinks()).toEqual([]);
    // the message itself still shows
    expect(screen.getByTestId("register-on-whatsapp")).toBeInTheDocument();
  });
});

describe("a dead set-up link: Get a new link", () => {
  const LINK_ID = ["0b6b8f9e", "1c2d", "4e5f", "8a9b", "0c1d2e3f4a5b"].join("-");
  const open = () =>
    render(
      <MemoryRouter initialEntries={[`/portal/setup/${LINK_ID}`]}>
        <Routes><Route path="/portal/setup/:token" element={<PortalSetup />} /></Routes>
      </MemoryRouter>,
    );
  const expired = () => Object.assign(new Error("x"), { response: { status: 400, data: { code: "LINK_EXPIRED" } } });

  it("no server link: the config number, /portal typed", async () => {
    setConfig("bot");
    h.setupSignIn.mockRejectedValue(expired());
    open();
    expect(await screen.findByRole("link", { name: "Get a new link" }))
      .toHaveAttribute("href", `${WA}${BOT}?text=${encodeURIComponent("/portal")}`);
  });

  it("no server link and no config number: no WhatsApp button, Log in still there", async () => {
    setConfig("none");
    h.setupSignIn.mockRejectedValue(expired());
    open();
    expect(await screen.findByRole("heading", { name: "Link expired" })).toBeInTheDocument();
    await settle();
    expect(screen.queryByRole("link", { name: "Get a new link" })).toBeNull();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });
});
