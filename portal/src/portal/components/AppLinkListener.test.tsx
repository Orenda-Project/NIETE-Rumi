import { render, act, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type UrlOpenHandler = (event: { url: string }) => void;

const runtime = vi.hoisted(() => ({
  native: true,
  plugin: true,
  origin: "https://portal.example.org" as string | null,
}));

const appPlugin = vi.hoisted(() => {
  const state: { handler: UrlOpenHandler | null; remove: ReturnType<typeof vi.fn> } = {
    handler: null,
    remove: vi.fn(),
  };
  const addListener = vi.fn(async (_event: string, handler: UrlOpenHandler) => {
    state.handler = handler;
    return { remove: state.remove };
  });
  return { state, addListener };
});

vi.mock("@/lib/runtime", () => ({
  isNativeApp: () => runtime.native,
  isNativePluginAvailable: (name: string) => runtime.plugin && name === "App",
  getPortalOrigin: () => runtime.origin,
}));

vi.mock("@capacitor/app", () => ({ App: { addListener: appPlugin.addListener } }));

import AppLinkListener from "./AppLinkListener";

let currentPath = "";
function WhereAmI() {
  const location = useLocation();
  currentPath = location.pathname + location.search + location.hash;
  return null;
}

function mount(initial = "/") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AppLinkListener />
      <WhereAmI />
    </MemoryRouter>
  );
}

// The listener attaches after a dynamic import resolves.
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function open(url: string) {
  await act(async () => { appPlugin.state.handler?.({ url }); });
}

beforeEach(() => {
  runtime.native = true;
  runtime.plugin = true;
  runtime.origin = "https://portal.example.org";
  appPlugin.state.handler = null;
  appPlugin.state.remove.mockClear();
  appPlugin.addListener.mockClear();
  currentPath = "";
});

afterEach(() => cleanup());

describe("AppLinkListener", () => {
  it("opens a portal link on its page (cold start: the app booted at /)", async () => {
    mount("/");
    await settle();
    expect(appPlugin.addListener).toHaveBeenCalledWith("appUrlOpen", expect.any(Function));
    await open("https://portal.example.org/portal/dashboard");
    expect(currentPath).toBe("/portal/dashboard");
  });

  it("opens a link while the app is already on another page (warm start)", async () => {
    mount("/portal/curriculum");
    await settle();
    await open("https://portal.example.org/portal/login");
    expect(currentPath).toBe("/portal/login");
  });

  it("ignores links that are not our portal", async () => {
    mount("/portal/curriculum");
    await settle();
    await open("https://evil.example.com/portal/dashboard");
    await open("https://portal.example.org/api/portal/me");
    expect(currentPath).toBe("/portal/curriculum");
  });

  it("ignores every link while the portal origin is unknown", async () => {
    runtime.origin = null;
    mount("/portal/curriculum");
    await settle();
    await open("https://portal.example.org/portal/dashboard");
    expect(currentPath).toBe("/portal/curriculum");
  });

  it("does nothing in a browser (not the native app)", async () => {
    runtime.native = false;
    mount("/");
    await settle();
    expect(appPlugin.addListener).not.toHaveBeenCalled();
  });

  it("does nothing on an older app build without the plugin (OTA bundle on an old APK)", async () => {
    runtime.plugin = false;
    mount("/");
    await settle();
    expect(appPlugin.addListener).not.toHaveBeenCalled();
  });

  it("removes its listener on unmount", async () => {
    const view = mount("/");
    await settle();
    view.unmount();
    expect(appPlugin.state.remove).toHaveBeenCalled();
  });
});
