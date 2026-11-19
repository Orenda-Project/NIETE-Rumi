import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "i18next";

/**
 * bd-9652yj (queue #166) — the coach app's way back to WhatsApp.
 *
 * Every Observe screen of the COACH app (ObservePage, routes.coachGate) carries a slim strip under the title: "Having
 * trouble? Continue on WhatsApp". When the screen fails (it will not load, the microphone is refused, the observation
 * could not be sent) the strip becomes a full green button and the failure is logged once (app_funnel.page_error).
 * A tap logs app_funnel.trouble_tap, asks the server for a short code (POST /coach/handoff), then opens this tier's bot
 * with "Continue my visit on WhatsApp (code V4KQ7)" typed, in the app's language. No code (the server or Redis is not
 * there) → the same line without one: the bot still runs /observe. The bot is the one the server names for its tier;
 * when the server cannot be asked, the portal's own WHATSAPP_NUMBER (staging's portal has no per-tier number).
 * Recording (a bare screen): no strip unless something failed, so one stray tap cannot leave a recording.
 */
const TIER_BOT = "923025502255";
vi.mock("../../services/api", () => ({ coach: { handoff: vi.fn() } }));
vi.mock("@/lib/runtime", async (orig) => ({ ...(await orig<typeof import("@/lib/runtime")>()), getApiBaseUrl: () => "/api/portal", browserEnv: () => "browser" }));
import { coach } from "../../services/api";
import ContinueOnWhatsApp from "./ContinueOnWhatsApp";
import { screenOf, askHandoff } from "./trouble";
import { WHATSAPP_NUMBER, WHATSAPP_URL_PICKER } from "@/lib/whatsapp";

const API = coach as unknown as { handoff: ReturnType<typeof vi.fn> };
const VISIT = "0d8a6d1c-1111-4c1c-9a1a-000000000002";
let fetchMock: ReturnType<typeof vi.fn>;
let opened: string[];

function renderAt(path: string, trouble: "load" | "upload" | "send" | "mic" | null = null, bare = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<ContinueOnWhatsApp trouble={trouble} bare={bare} open={(u) => opened.push(u)} />} />
      </Routes>
    </MemoryRouter>,
  );
}
const sent = () => fetchMock.mock.calls
  .filter((c) => String(c[0]).endsWith("/funnel/coach-trouble"))
  .map((c) => JSON.parse(String((c[1] as RequestInit).body)));

beforeEach(async () => {
  vi.clearAllMocks();
  opened = [];
  fetchMock = vi.fn(async () => ({ status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  API.handoff.mockResolvedValue({ success: true, code: "V4KQ7", bot: TIER_BOT });
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("where she is", () => {
  it("screenOf reads the Observe screen and the visit from the path", () => {
    expect(screenOf("/portal/coach/observe")).toEqual({ screen: "observe", visitId: null });
    expect(screenOf("/portal/coach/observe/pick")).toEqual({ screen: "pick", visitId: null });
    expect(screenOf(`/portal/coach/visit/${VISIT}`)).toEqual({ screen: "visit", visitId: VISIT });
    for (const s of ["record", "attach", "check", "sending"] as const) {
      expect(screenOf(`/portal/coach/visit/${VISIT}/${s}`)).toEqual({ screen: s, visitId: VISIT });
    }
    expect(screenOf("/portal/coach/visit/not-a-uuid/record")).toEqual({ screen: "record", visitId: null });
    expect(screenOf("/portal/teacher")).toEqual({ screen: "observe", visitId: null });
  });

  it("askHandoff: the server's code and its tier's bot; the portal's own number when the server cannot be asked", async () => {
    expect(await askHandoff("record", VISIT)).toEqual({ code: "V4KQ7", bot: TIER_BOT });
    expect(API.handoff).toHaveBeenCalledWith({ screen: "record", visitId: VISIT });
    API.handoff.mockRejectedValueOnce(new Error("Network Error"));
    expect(await askHandoff("record", VISIT)).toEqual({ code: null, bot: WHATSAPP_NUMBER });
    API.handoff.mockResolvedValueOnce({ success: true, code: "bad!", bot: null });
    expect(await askHandoff("record", VISIT)).toEqual({ code: null, bot: WHATSAPP_NUMBER });
    API.handoff.mockImplementationOnce(() => new Promise(() => {}));
    expect(await askHandoff("record", VISIT, { timeoutMs: 20 })).toEqual({ code: null, bot: WHATSAPP_NUMBER });
  });
});

describe("the slim strip", () => {
  it("shows under the title: Having trouble? Continue on WhatsApp", () => {
    renderAt(`/portal/coach/visit/${VISIT}`);
    const strip = screen.getByTestId("continue-on-whatsapp");
    expect(strip).toHaveTextContent("Having trouble?");
    expect(strip).toHaveTextContent("Continue on WhatsApp");
    expect(strip.getAttribute("data-mode")).toBe("strip");
    expect(sent()).toEqual([]); // nothing failed: nothing logged
  });

  it("a tap: logs the tap, asks for the code, opens the bot with the line typed", async () => {
    renderAt(`/portal/coach/visit/${VISIT}/record`);
    fireEvent.click(screen.getByTestId("continue-on-whatsapp"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(sent()).toEqual([expect.objectContaining({ t: "tap", screen: "record", kind: "strip" })]);
    expect(API.handoff).toHaveBeenCalledWith({ screen: "record", visitId: VISIT });
    expect(opened[0]).toBe(`${WHATSAPP_URL_PICKER}${TIER_BOT}?text=${encodeURIComponent("Continue my visit on WhatsApp (code V4KQ7)")}`);
  });

  it("in Urdu, the line is Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    renderAt(`/portal/coach/visit/${VISIT}`);
    expect(screen.getByTestId("continue-on-whatsapp")).toHaveTextContent(/واٹس\sایپ پر کریں/);
    fireEvent.click(screen.getByTestId("continue-on-whatsapp"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(decodeURIComponent(opened[0].split("?text=")[1])).toBe("میرا دورہ واٹس\u00A0ایپ پر جاری رکھیں (کوڈ V4KQ7)");
  });

  it("no code from the server: the line without one, still the chat", async () => {
    API.handoff.mockResolvedValue({ success: true, code: null, bot: TIER_BOT });
    renderAt("/portal/coach/observe");
    fireEvent.click(screen.getByTestId("continue-on-whatsapp"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(decodeURIComponent(opened[0].split("?text=")[1])).toBe("Continue my visit on WhatsApp");
  });

  it("the server cannot be asked (offline): the portal's own number, the line without a code", async () => {
    API.handoff.mockRejectedValue(new Error("Network Error"));
    renderAt(`/portal/coach/visit/${VISIT}`);
    fireEvent.click(screen.getByTestId("continue-on-whatsapp"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toBe(`${WHATSAPP_URL_PICKER}${WHATSAPP_NUMBER}?text=${encodeURIComponent("Continue my visit on WhatsApp")}`);
  });

  it("a recording screen (bare) shows no strip while nothing failed", () => {
    renderAt(`/portal/coach/visit/${VISIT}/record`, null, true);
    expect(screen.queryByTestId("continue-on-whatsapp")).toBeNull();
  });
});

describe("when the screen fails", () => {
  it("the strip becomes a full green button, and the failure is logged once", async () => {
    const { rerender } = renderAt(`/portal/coach/visit/${VISIT}/sending`, "send");
    const button = screen.getByTestId("continue-on-whatsapp");
    expect(button.getAttribute("data-mode")).toBe("button");
    expect(button).toHaveTextContent("Continue on WhatsApp");
    await waitFor(() => expect(sent()).toEqual([expect.objectContaining({ t: "error", screen: "sending", kind: "send" })]));
    rerender(
      <MemoryRouter initialEntries={[`/portal/coach/visit/${VISIT}/sending`]}>
        <Routes><Route path="*" element={<ContinueOnWhatsApp trouble="send" open={(u) => opened.push(u)} />} /></Routes>
      </MemoryRouter>,
    );
    expect(sent()).toHaveLength(1);
  });

  it("a recording screen that failed (microphone) shows the button even though it is bare", () => {
    renderAt(`/portal/coach/visit/${VISIT}/record`, "mic", true);
    expect(screen.getByTestId("continue-on-whatsapp").getAttribute("data-mode")).toBe("button");
  });

  it("its tap carries the failure as the kind", async () => {
    renderAt(`/portal/coach/visit/${VISIT}`, "load");
    fireEvent.click(screen.getByTestId("continue-on-whatsapp"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(sent().find((b) => b.t === "tap")).toEqual(expect.objectContaining({ screen: "visit", kind: "load" }));
  });
});
