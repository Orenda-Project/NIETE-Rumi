import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { canSave, extOf, recordingFilename, saveRecordingToPhone, type SaveEnv } from "./saveRecording";

const runtime = vi.hoisted(() => ({ env: "browser" as "browser" | "android-iab" | "ios-iab" | "native" }));
vi.mock("@/lib/runtime", async (orig) => ({ ...(await orig<typeof import("@/lib/runtime")>()), browserEnv: () => runtime.env }));

import { AudioCard } from "../teacher/ui/AudioCard";

/**
 * bd-ma9jiy (queue #262; the operator 25 Nov ~19:50: "the button to save the recording ... on the component where there's
 * a seek bar, and 10-second plus minus, 2x 4x speed") — Save to phone on the ONE recording player (AudioCard's full
 * player), the file named NIETE_OBS_… / NIETE_DBRF_… (his template, 24 Nov), working where she is: Chrome saves in place,
 * WhatsApp's browser on Android hands the attachment link to Chrome (open-file.html), the app opens it in the phone's
 * browser, an iPhone's WhatsApp copies the link. A phone-only copy can be saved only in a plain browser.
 */
const SIGNED = "https://acc.r2.cloudflarestorage.com/rumi-bucket/coach-observations/u1/obs-9.webm?X-Amz-Signature=abc";
const ATTACH = "https://acc.r2.cloudflarestorage.com/rumi-bucket/coach-observations/u1/obs-9.webm?attach=1";

function env(browser: SaveEnv["browser"]) {
  const e = {
    browser,
    getLink: vi.fn(async (_src: string, filename: string) => ({ url: ATTACH, filename })),
    follow: vi.fn(),
    go: vi.fn(),
    copy: vi.fn(async () => true),
    origin: () => "https://portal.niete.edu.pk",
  };
  return e;
}

beforeEach(() => { runtime.env = "browser"; vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 204 }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the file's name", () => {
  it("NIETE_OBS_3Eng_25Nov_1040.webm: kind, class, day, time — no names", () => {
    expect(recordingFilename({ kind: "obs", grade: 3, subject: "English", at: new Date(2026, 10, 25, 10, 40), ext: ".webm" })).toBe("NIETE_OBS_3Eng_25Nov_1040.webm");
    expect(recordingFilename({ kind: "dbrf", at: new Date(2026, 10, 25, 11, 5), ext: ".m4a" })).toBe("NIETE_DBRF_25Nov_1105.m4a");
    expect(recordingFilename({ kind: "obs", grade: "Grade 6", subject: "Mathematics", at: new Date(2026, 0, 2, 8, 0), ext: ".webm" })).toBe("NIETE_OBS_6Math_2Jan_0800.webm");
  });
  it("the extension from the link or the type", () => {
    expect(extOf(SIGNED)).toBe(".webm");
    expect(extOf("https://x/y/talk.m4a?sig=1")).toBe(".m4a");
    expect(extOf("blob:https://portal/1234", "audio/mp4")).toBe(".m4a");
    expect(extOf(null, null)).toBe(".webm");
  });
});

describe("where Save works", () => {
  it("a recording with us: everywhere; a phone-only copy: a plain browser only", () => {
    expect(canSave(SIGNED, "android-iab")).toBe(true);
    expect(canSave(SIGNED, "native")).toBe(true);
    expect(canSave("blob:https://portal/1", "browser")).toBe(true);
    expect(canSave("blob:https://portal/1", "android-iab")).toBe(false);
    expect(canSave("blob:https://portal/1", "native")).toBe(false);
    expect(canSave(null, "browser")).toBe(false);
  });

  it("Chrome: the attachment link is followed in place, under our name", async () => {
    const e = env("browser");
    expect(await saveRecordingToPhone({ src: SIGNED, filename: "NIETE_OBS_25Nov_1040.webm", kind: "obs", env: e })).toBe("download");
    expect(e.getLink).toHaveBeenCalledWith(SIGNED, "NIETE_OBS_25Nov_1040.webm");
    expect(e.follow).toHaveBeenCalledWith(ATTACH, "NIETE_OBS_25Nov_1040.webm");
  });

  it("WhatsApp's browser on Android: handed to the phone's browser through our open-file page (intent://)", async () => {
    const e = env("android-iab");
    expect(await saveRecordingToPhone({ src: SIGNED, filename: "NIETE_DBRF_25Nov_1130.webm", kind: "dbrf", env: e })).toBe("handoff");
    const to = e.go.mock.calls[0][0] as string;
    expect(to.startsWith("intent://portal.niete.edu.pk/open-file.html?f=")).toBe(true);
    expect(to.endsWith("#Intent;scheme=https;end")).toBe(true);
    expect(e.follow).not.toHaveBeenCalled();
  });

  it("the app: the link opens in the phone's browser; an iPhone's WhatsApp: the link is copied", async () => {
    const app = env("native");
    expect(await saveRecordingToPhone({ src: SIGNED, filename: "NIETE_OBS_x.webm", kind: "obs", env: app })).toBe("app_browser");
    expect(app.go).toHaveBeenCalledWith(ATTACH);
    const ios = env("ios-iab");
    expect(await saveRecordingToPhone({ src: SIGNED, filename: "NIETE_OBS_x.webm", kind: "obs", env: ios })).toBe("copied");
    expect(ios.copy).toHaveBeenCalledWith(ATTACH);
  });

  it("the server refuses the link: failed, never thrown, and told", async () => {
    const e = env("browser");
    e.getLink.mockRejectedValueOnce(new Error("link 403"));
    expect(await saveRecordingToPhone({ src: SIGNED, filename: "NIETE_OBS_x.webm", kind: "obs", env: e })).toBe("failed");
    const body = JSON.parse((globalThis.fetch as any).mock.calls.at(-1)[1].body);
    expect(body.ev[0]).toMatchObject({ k: "save_to_phone_failed", how: "failed" });
  });
});

describe("AudioCard: Save to phone sits under the seek bar, ±10 s and the speed", () => {
  it("a full player with `save` and a link: the button; without `save`: none", () => {
    const { unmount } = render(<AudioCard title="Class recording" src={SIGNED} controls save={{ kind: "obs", filename: "NIETE_OBS_x.webm" }} testId="p" />);
    expect(screen.getByRole("button", { name: "Save to phone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back 10 s/ })).toBeInTheDocument();
    unmount();
    render(<AudioCard title="Class recording" src={SIGNED} controls testId="p" />);
    expect(screen.queryByRole("button", { name: "Save to phone" })).toBeNull();
  });

  it("a phone-only copy inside WhatsApp's browser: no button (a WebView cannot save it)", () => {
    runtime.env = "android-iab";
    render(<AudioCard title="Your recording" src="blob:https://portal/1" controls save={{ kind: "dc", filename: "NIETE_OBS_x.webm" }} testId="p" />);
    expect(screen.queryByRole("button", { name: "Save to phone" })).toBeNull();
  });

  it("a press asks for the attachment link (the server re-signs only a live link)", async () => {
    (globalThis.fetch as any).mockImplementation(async (url: string) => (String(url).includes("/recording-file/link")
      ? { ok: true, status: 200, json: async () => ({ url: ATTACH, filename: "NIETE_OBS_x.webm" }) }
      : { ok: true, status: 204 }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<AudioCard title="Class recording" src={SIGNED} controls save={{ kind: "obs", filename: "NIETE_OBS_x.webm" }} testId="p" />);
    fireEvent.click(screen.getByRole("button", { name: "Save to phone" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const asked = (globalThis.fetch as any).mock.calls.find((c: unknown[]) => String(c[0]).includes("/recording-file/link"));
    expect(String(asked[0])).toContain("name=NIETE_OBS_x.webm");
    click.mockRestore();
  });
});
