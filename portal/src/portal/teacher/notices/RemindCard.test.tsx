import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import i18n from "i18next";

/**
 * The teacher Home's "Evening reminder" card (switch portal_push_remind): drawn only on a plain browser that can
 * push (not the NIETE app, not an in-app browser, PushManager present) AND when the server says {portal:true}.
 * "Send a test now" only with state.test. Turn on: permission in the tap → /sw.js → subscribe → POST subscribe.
 * Mocked at the network and browser boundaries only.
 */
vi.mock("../../services/api", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const native = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/runtime", () => ({ isNativeApp: () => native.on }));

import api from "../../services/api";
import { RemindCard, IAB_RX } from "./RemindCard";
import { REMIND_COPY, REMIND_COPY_UR } from "../remind/copy";

const http = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const WA = "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 WhatsApp/2.24";
let ua = CHROME;
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });

function withPush(on: boolean) {
  const w = window as unknown as Record<string, unknown>;
  if (on) w.PushManager = function PushManager() {};
  else delete w.PushManager;
}

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
  native.on = false;
  ua = CHROME;
  vi.spyOn(window.navigator, "userAgent", "get").mockImplementation(() => ua);
  withPush(true);
  http.get.mockReset();
  http.post.mockReset();
  http.get.mockResolvedValue({ data: { portal: true, test: false } });
  http.post.mockResolvedValue({ data: { ok: 1 } });
});
afterEach(() => {
  vi.restoreAllMocks();
  withPush(false);
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  delete (window as unknown as Record<string, unknown>).Notification;
});

function browser(permission: NotificationPermission = "granted", existing = false) {
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/xyz", toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/xyz", keys: { p256dh: "p", auth: "a" } }), unsubscribe: vi.fn(async () => true) };
  const pushManager = { subscribe: vi.fn(async () => sub), getSubscription: vi.fn(async () => (existing ? sub : null)) };
  const reg = { pushManager };
  const sw = { register: vi.fn(async () => reg), ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg) };
  Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true });
  const requestPermission = vi.fn(async () => permission);
  (window as unknown as Record<string, unknown>).Notification = { requestPermission, permission: "default" };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ key: "ZmFrZS12YXBpZC1rZXk" }), { status: 200, headers: { "content-type": "application/json" } }));
  return { sub, pushManager, sw, requestPermission, fetchMock };
}

describe("RemindCard: when it is drawn", () => {
  it("is drawn on a plain browser with PushManager when the server says portal:true", async () => {
    render(<RemindCard />);
    await flush();
    expect(http.get).toHaveBeenCalledWith("/push/state");
    expect(screen.getByText(REMIND_COPY.title)).toBeTruthy();
    expect(screen.getByText(REMIND_COPY.body)).toBeTruthy();
    expect(screen.getByRole("button", { name: REMIND_COPY.turnOn })).toBeTruthy();
    expect(screen.queryByRole("button", { name: REMIND_COPY.test })).toBeNull();
  });

  it("draws nothing inside the NIETE app, and never asks the server", async () => {
    native.on = true;
    const { container } = render(<RemindCard />);
    await flush();
    expect(container.innerHTML).toBe("");
    expect(http.get).not.toHaveBeenCalled();
  });

  it.each([
    ["WhatsApp", WA],
    ["WhatsApp for Android (WA4A)", `${CHROME} WA4A/2.24`],
    ["Facebook", `${CHROME} [FBAN/FB4A;FBAV/450.0;]`],
    ["Instagram", `${CHROME} Instagram 300.0`],
    ["an Android WebView", "Mozilla/5.0 (Linux; Android 14; K; wv) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36"],
  ])("draws nothing in %s's in-app browser", async (_name, agent) => {
    ua = agent;
    expect(IAB_RX.test(agent)).toBe(true);
    const { container } = render(<RemindCard />);
    await flush();
    expect(container.innerHTML).toBe("");
    expect(http.get).not.toHaveBeenCalled();
  });

  it("draws nothing without PushManager", async () => {
    withPush(false);
    const { container } = render(<RemindCard />);
    await flush();
    expect(container.innerHTML).toBe("");
    expect(http.get).not.toHaveBeenCalled();
  });

  it("draws nothing while the switch is off (the server's 404) or the answer is not portal:true", async () => {
    http.get.mockRejectedValueOnce(Object.assign(new Error("404"), { response: { status: 404 } }));
    const a = render(<RemindCard />);
    await flush();
    expect(a.container.innerHTML).toBe("");
    a.unmount();
    http.get.mockResolvedValueOnce({ data: { portal: false, test: true } });
    const b = render(<RemindCard />);
    await flush();
    expect(b.container.innerHTML).toBe("");
  });

  it("a phone already subscribed shows Turn off; 'Send a test now' only with state.test", async () => {
    browser("granted", true);
    const a = render(<RemindCard />);
    await flush();
    expect(screen.getByRole("button", { name: REMIND_COPY.turnOff })).toBeTruthy();
    expect(screen.queryByRole("button", { name: REMIND_COPY.test })).toBeNull();
    a.unmount();
    http.get.mockResolvedValue({ data: { portal: true, test: true } });
    render(<RemindCard />);
    await flush();
    expect(screen.getByRole("button", { name: REMIND_COPY.test })).toBeTruthy();
  });

  it("speaks Urdu when the page is in Urdu", async () => {
    await act(async () => { await i18n.changeLanguage("ur"); });
    browser("granted", true);
    http.get.mockResolvedValue({ data: { portal: true, test: true } });
    render(<RemindCard />);
    await flush();
    expect(screen.getByText(REMIND_COPY_UR.title)).toBeTruthy();
    expect(screen.getByText(REMIND_COPY_UR.body)).toBeTruthy();
    expect(screen.getByRole("button", { name: REMIND_COPY_UR.turnOff })).toBeTruthy();
    expect(screen.getByRole("button", { name: REMIND_COPY_UR.test })).toBeTruthy();
  });
});

describe("RemindCard: turning it on and off", () => {
  it("Turn on: permission → register /sw.js at / → subscribe with the key → POST subscribe {sub, lang}; then Turn off", async () => {
    const b = browser();
    render(<RemindCard />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: REMIND_COPY.turnOn }));
    await flush();
    expect(b.requestPermission).toHaveBeenCalled();
    expect(b.sw.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(b.fetchMock).toHaveBeenCalledWith("/api/wqpush/key", expect.anything());
    const opts = (b.pushManager.subscribe.mock.calls[0] as unknown as [PushSubscriptionOptionsInit])[0];
    expect(opts.userVisibleOnly).toBe(true);
    expect(opts.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(http.post).toHaveBeenCalledWith("/push/subscribe", { sub: b.sub.toJSON(), lang: "en" });
    fireEvent.click(await screen.findByRole("button", { name: REMIND_COPY.turnOff }));
    await flush();
    expect(http.post).toHaveBeenCalledWith("/push/unsubscribe", { endpoint: b.sub.endpoint });
    expect(b.sub.unsubscribe).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: REMIND_COPY.turnOn })).toBeTruthy();
  });

  it("a refused permission subscribes nothing and stays off", async () => {
    const b = browser("denied");
    render(<RemindCard />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: REMIND_COPY.turnOn }));
    await flush();
    expect(b.sw.register).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: REMIND_COPY.turnOn })).toBeTruthy();
  });

  it("Send a test now posts the subscription's endpoint", async () => {
    http.get.mockResolvedValue({ data: { portal: true, test: true } });
    const b = browser();
    render(<RemindCard />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: REMIND_COPY.turnOn }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: REMIND_COPY.test }));
    await flush();
    expect(http.post).toHaveBeenCalledWith("/push/test", { endpoint: b.sub.endpoint });
  });
});
