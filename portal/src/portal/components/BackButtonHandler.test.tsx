import { render, act, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BackHandler = (event: { canGoBack: boolean }) => void;

const runtime = vi.hoisted(() => ({ native: true, plugin: true }));

const appPlugin = vi.hoisted(() => {
  const state: { handler: BackHandler | null; remove: ReturnType<typeof vi.fn> } = {
    handler: null,
    remove: vi.fn(),
  };
  return {
    state,
    addListener: vi.fn(async (_event: string, handler: BackHandler) => {
      state.handler = handler;
      return { remove: state.remove };
    }),
    toggleBackButtonHandler: vi.fn(async (_opts: { enabled: boolean }) => {}),
    minimizeApp: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/runtime", () => ({
  isNativeApp: () => runtime.native,
  isNativePluginAvailable: (name: string) => runtime.plugin && name === "App",
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: appPlugin.addListener,
    toggleBackButtonHandler: appPlugin.toggleBackButtonHandler,
    minimizeApp: appPlugin.minimizeApp,
  },
}));

import BackButtonHandler from "./BackButtonHandler";

let currentPath = "";
function WhereAmI() {
  const location = useLocation();
  currentPath = location.pathname;
  return null;
}

function mount(entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <BackButtonHandler />
      <WhereAmI />
    </MemoryRouter>
  );
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function pressBack(canGoBack: boolean) {
  await act(async () => { appPlugin.state.handler?.({ canGoBack }); });
}

beforeEach(() => {
  runtime.native = true;
  runtime.plugin = true;
  appPlugin.state.handler = null;
  appPlugin.state.remove.mockClear();
  appPlugin.addListener.mockClear();
  appPlugin.toggleBackButtonHandler.mockClear();
  appPlugin.minimizeApp.mockClear();
  currentPath = "";
  document.body.innerHTML = "";
});

afterEach(() => cleanup());

describe("BackButtonHandler", () => {
  it("listens for the back key and switches the plugin's handler on", async () => {
    mount(["/portal/dashboard"]);
    await settle();
    expect(appPlugin.addListener).toHaveBeenCalledWith("backButton", expect.any(Function));
    expect(appPlugin.toggleBackButtonHandler).toHaveBeenCalledWith({ enabled: true });
  });

  it("goes to the previous page from an inner page", async () => {
    mount(["/portal/dashboard", "/portal/curriculum"]);
    await settle();
    await pressBack(true);
    expect(currentPath).toBe("/portal/dashboard");
    expect(appPlugin.minimizeApp).not.toHaveBeenCalled();
  });

  it("leaves the app from the dashboard, even with history behind it", async () => {
    mount(["/portal/login", "/portal/dashboard"]);
    await settle();
    await pressBack(true);
    expect(appPlugin.minimizeApp).toHaveBeenCalledTimes(1);
    expect(currentPath).toBe("/portal/dashboard");
  });

  it("leaves the app from an inner page with nothing behind it (arrived from a link)", async () => {
    mount(["/portal/curriculum"]);
    await settle();
    await pressBack(false);
    expect(appPlugin.minimizeApp).toHaveBeenCalledTimes(1);
    expect(currentPath).toBe("/portal/curriculum");
  });

  it("closes an open dialog first (sends Escape) and does not navigate or leave", async () => {
    mount(["/portal/dashboard", "/portal/curriculum"]);
    await settle();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    const escapes: string[] = [];
    const onKey = (e: KeyboardEvent) => { escapes.push(e.key); };
    document.addEventListener("keydown", onKey);
    await pressBack(true);
    document.removeEventListener("keydown", onKey);
    expect(escapes).toEqual(["Escape"]);
    expect(currentPath).toBe("/portal/curriculum");
    expect(appPlugin.minimizeApp).not.toHaveBeenCalled();
  });

  it("does nothing in a browser (not the native app)", async () => {
    runtime.native = false;
    mount(["/portal/dashboard"]);
    await settle();
    expect(appPlugin.addListener).not.toHaveBeenCalled();
    expect(appPlugin.toggleBackButtonHandler).not.toHaveBeenCalled();
  });

  it("does nothing on an older app build without the plugin (OTA bundle on an old APK)", async () => {
    runtime.plugin = false;
    mount(["/portal/dashboard"]);
    await settle();
    expect(appPlugin.addListener).not.toHaveBeenCalled();
    expect(appPlugin.toggleBackButtonHandler).not.toHaveBeenCalled();
  });

  it("switches the handler back off and removes its listener on unmount", async () => {
    const view = mount(["/portal/dashboard"]);
    await settle();
    view.unmount();
    expect(appPlugin.state.remove).toHaveBeenCalled();
    expect(appPlugin.toggleBackButtonHandler).toHaveBeenLastCalledWith({ enabled: false });
  });
});
