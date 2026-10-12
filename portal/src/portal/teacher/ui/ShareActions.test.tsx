import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import i18n from "i18next";
import { ShareActions, clockOf, type ShareResult } from "./ShareActions";

/**
 * bd-fmf24g.30 — ShareActions (Blueprint: ShareActions). Send on WhatsApp: default · sending · sent ✓ + time · failed +
 * Try again · unavailable. Open in another app: per environment (WhatsApp's browser, Android or iPhone: Copy link, never a
 * navigation — bd-fmf24g.53; Chrome / the app: hidden for a page, the file for a file).
 */
const classes = (el: Element) => (el.getAttribute("class") || "").split(/\s+/);
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

beforeEach(async () => {
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Send on WhatsApp", () => {
  it("is WhatsApp green with white text, 64px, full width, with the glyph", () => {
    render(<ShareActions onSend={async () => ({ status: "sent" })} />);
    const b = screen.getByRole("button", { name: /Send on WhatsApp/ });
    expect(b).toHaveStyle({ backgroundColor: "#09883F" });
    expect(classes(b)).toEqual(expect.arrayContaining(["min-h-[64px]", "w-full", "text-white"]));
    expect(b.querySelector("svg path")?.getAttribute("d")).toMatch(/^M17\.472/);
  });

  it("while available is false or unknown it is grey, locked and says why; a tap does nothing", () => {
    const onSend = vi.fn(async (): Promise<ShareResult> => ({ status: "sent" }));
    for (const available of [false, null] as const) {
      const { unmount } = render(<ShareActions onSend={onSend} available={available} />);
      const b = screen.getByTestId("share-send");
      expect(b).toBeDisabled();
      expect(b).toHaveTextContent("Send on WhatsApp");
      expect(b).toHaveTextContent("Not available yet");
      fireEvent.click(b);
      unmount();
    }
    expect(onSend).not.toHaveBeenCalled();
  });

  it("one press is one send: sending is disabled and a second tap is ignored", async () => {
    const d = deferred<ShareResult>();
    const onSend = vi.fn(() => d.promise);
    render(<ShareActions onSend={onSend} />);
    const b = screen.getByTestId("share-send");
    fireEvent.click(b);
    fireEvent.click(screen.getByTestId("share-send"));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("share-send")).toBeDisabled();
    expect(screen.getByTestId("share-send")).toHaveTextContent("Sending…");
    await act(async () => { d.resolve({ status: "sent", at: "2026-10-10T10:42:00.000Z" }); });
    expect(screen.getByTestId("share-send")).toHaveTextContent("Sent on WhatsApp");
  });

  it("sent shows the time (Pakistan) and a quiet Send again that sends once more", async () => {
    const onSend = vi.fn(async (): Promise<ShareResult> => ({ status: "sent", at: "2026-10-10T10:42:00.000Z" }));
    render(<ShareActions onSend={onSend} />);
    fireEvent.click(screen.getByTestId("share-send"));
    await act(async () => {});
    expect(screen.getByTestId("share-send")).toHaveTextContent("3:42 PM");
    expect(screen.getByTestId("share-send")).toBeDisabled();
    fireEvent.click(screen.getByTestId("share-send-again"));
    await act(async () => {});
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it("failed: the whole button is Try again, and it retries", async () => {
    const onSend = vi.fn<() => Promise<ShareResult>>().mockResolvedValueOnce({ status: "failed" }).mockResolvedValueOnce({ status: "sent" });
    render(<ShareActions onSend={onSend} />);
    fireEvent.click(screen.getByTestId("share-send"));
    await act(async () => {});
    const b = screen.getByTestId("share-send");
    expect(b).toHaveTextContent("Try again");
    expect(b).toHaveTextContent("Couldn't send");
    fireEvent.click(b);
    await act(async () => {});
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("share-send")).toHaveTextContent("Sent on WhatsApp");
  });

  it("a send that throws is failed, never sent; the server saying unavailable locks it", async () => {
    const { unmount } = render(<ShareActions onSend={async () => { throw new Error("x"); }} />);
    fireEvent.click(screen.getByTestId("share-send"));
    await act(async () => {});
    expect(screen.getByTestId("share-send")).toHaveTextContent("Try again");
    unmount();
    render(<ShareActions onSend={async () => ({ status: "unavailable" })} />);
    fireEvent.click(screen.getByTestId("share-send"));
    await act(async () => {});
    expect(screen.getByTestId("share-send")).toBeDisabled();
    expect(screen.getByTestId("share-send")).toHaveTextContent("Not available yet");
  });

  it("'Send to <name>' for the coach's page", () => {
    render(<ShareActions onSend={async () => ({ status: "sent" })} sendTo="Ayesha" />);
    expect(screen.getByRole("button", { name: "Send to Ayesha" })).toBeInTheDocument();
  });
});

describe("Open in another app: by environment", () => {
  const page = { page: true } as const;
  it("a PAGE is hidden while the hand-off link area does not exist (it would land on a sign-in page)", () => {
    render(<ShareActions open={page} env="android-iab" />);
    expect(screen.queryByTestId("share-open")).toBeNull();
  });
  it("a page, hand-off on: WhatsApp's browser (Android and iPhone) shows Copy link; Chrome and the app hide it", () => {
    for (const env of ["android-iab", "ios-iab"] as const) {
      const r = render(<ShareActions open={page} env={env} pageHandoff />);
      expect(screen.getByTestId("share-open")).toHaveTextContent("Copy link");
      r.unmount();
    }
    for (const env of ["browser", "native"] as const) {
      const r = render(<ShareActions open={page} env={env} pageHandoff />);
      expect(r.container.firstChild).toBeNull();
      r.unmount();
    }
  });

  // bd-fmf24g.59 — the operator's phone test (sandbox hand-off page, bd-fmf24g.58): an intent with action VIEW and the
  // file's type, and NO browser_fallback_url, opened a PDF app (view + download) without crashing WhatsApp. The crash on
  // a teacher's phone (bd-fmf24g.53) was WhatsApp's browser loading the fallback PDF link itself, so there is none: when
  // no app takes the intent, nothing loads inside WhatsApp. Copy link stays underneath as the way out.
  const PDF = "https://digital-coach-audio.example.r2.cloudflarestorage.com/lp/grade_2_english_ch3_seg3.pdf?X-Amz-Credential=a%2Fb&X-Amz-Signature=1";
  function stubLocation() {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { get href() { return "https://portal.niete.edu.pk/portal/teacher/lessons/view"; }, set href(v: string) { assign(v); } } });
    return assign;
  }

  it("Android WhatsApp browser: Open hands the PDF to a PDF app (intent, action VIEW, type application/pdf, no fallback)", async () => {
    const assign = stubLocation();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<ShareActions open={{ fileUrl: async () => PDF }} env="android-iab" />);
    expect(screen.getByTestId("share-open")).toHaveTextContent("Open in another app");
    fireEvent.click(screen.getByTestId("share-open"));
    await act(async () => {});
    expect(open).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
    const to = assign.mock.calls[0][0] as string;
    expect(to.startsWith("intent://digital-coach-audio.example.r2.cloudflarestorage.com/lp/grade_2_english_ch3_seg3.pdf?X-Amz-Credential=a%2Fb&X-Amz-Signature=1#Intent;")).toBe(true);
    expect(to).toContain(";scheme=https;");
    expect(to).toContain(";action=android.intent.action.VIEW;");
    expect(to).toContain(";type=application/pdf;");
    expect(to).not.toContain("browser_fallback_url"); // never a link WhatsApp's own browser would load
    expect(to.endsWith(";end")).toBe(true);
  });

  it("Android WhatsApp browser: a report image goes to an image app (type image/png)", async () => {
    const assign = stubLocation();
    render(<ShareActions open={{ fileUrl: "https://files.example/u/s1_report.png?sig=1" }} env="android-iab" />);
    fireEvent.click(screen.getByTestId("share-open"));
    await act(async () => {});
    expect(assign.mock.calls[0][0]).toContain(";type=image/png;");
  });

  it("Android WhatsApp browser: Copy link sits under Open as the way out; it copies and says Paste in browser", async () => {
    const assign = stubLocation();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ShareActions open={{ fileUrl: async () => PDF }} env="android-iab" />);
    fireEvent.click(screen.getByTestId("share-copy"));
    await act(async () => {});
    expect(assign).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(PDF);
    expect(screen.getByTestId("share-copy")).toHaveTextContent("Link copied");
    expect(screen.getByTestId("share-copy")).toHaveTextContent("Paste in browser");
  });

  it("Android WhatsApp browser: a copy that fails says so and stays Copy link", async () => {
    stubLocation();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    // (jsdom has no document.execCommand, so the old-way fallback fails too, as a locked-down web view would.)
    render(<ShareActions open={{ fileUrl: "https://files.example/p.pdf" }} env="android-iab" />);
    fireEvent.click(screen.getByTestId("share-copy"));
    await act(async () => {});
    expect(screen.getByTestId("share-copy")).toHaveTextContent("Copy link");
    expect(screen.getByTestId("share-copy")).toHaveTextContent("Couldn't open it");
  });

  it("iPhone: Copy link copies the target, then says what to do next", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ShareActions open={{ fileUrl: "https://files.example/p.pdf" }} env="ios-iab" />);
    fireEvent.click(screen.getByTestId("share-open"));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith("https://files.example/p.pdf");
    expect(screen.getByTestId("share-open")).toHaveTextContent("Link copied");
    expect(screen.getByTestId("share-open")).toHaveTextContent("Open in Safari");
  });

  it("a FILE in Chrome or in the app opens normally (window.open), no intent", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    for (const env of ["browser", "native"] as const) {
      const r = render(<ShareActions open={{ fileUrl: async () => "https://files.example/p.pdf" }} env={env} />);
      fireEvent.click(screen.getByTestId("share-open"));
      await act(async () => {});
      r.unmount();
    }
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[0][0]).toBe("https://files.example/p.pdf");
  });

  it("renders nothing with no Send and nothing to open", () => {
    const { container } = render(<ShareActions env="browser" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("helpers", () => {
  it("clockOf is Pakistan time, 12-hour, with the kit's AM/PM words", () => {
    expect(clockOf("2026-10-10T10:42:00.000Z", "AM", "PM")).toBe("3:42 PM");
    expect(clockOf("2026-10-10T19:05:00.000Z", "صبح", "شام")).toBe("12:05 صبح");
    expect(clockOf("nope", "AM", "PM")).toBeNull();
    expect(clockOf(undefined, "AM", "PM")).toBeNull();
  });
});
