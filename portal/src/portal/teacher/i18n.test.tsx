import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import i18n from "i18next";

/**
 * bd-fmf24g.13 — the teacher v2 language layer.
 *
 *   bilingual(en, ur)   one copy module, both languages; `ur` must have exactly en's shape (tsc refuses a
 *                       missing or extra key), and untranslated() lists any key whose Urdu is empty or
 *                       still the English — no silent English fallback (language-protocol §6.3)
 *   useLang/useCopy     the page's language (i18n), and that language's words; a switch re-renders
 *   useFollowPreferredLanguage
 *                       v2 screens follow her stored preferred_language (GET /me/language) even when she
 *                       did not lock it (language-protocol Rule 20; operator decision, provisional) — read
 *                       only, never written (setUserLanguage is the one writer); a language outside the
 *                       offer is ignored; asked once per page load
 */

const get = vi.hoisted(() => vi.fn());
const set = vi.hoisted(() => vi.fn());
vi.mock("../services/api", () => ({ language: { get, set }, default: {} }));

import {
  bilingual, untranslated, useCopy, useLang, useFollowPreferredLanguage, resetLanguageFollow, copyIn,
} from "./i18n";

const SAMPLE = bilingual(
  { open: "Open", grade: (g: number) => `Grade ${g}`, nested: { close: "Close" }, months: ["Jan", "Feb"] as readonly string[] },
  { open: "کھولیں", grade: (g: number) => `جماعت ${g}`, nested: { close: "بند کریں" }, months: ["جنوری", "فروری"] },
);

beforeEach(async () => {
  vi.clearAllMocks();
  resetLanguageFollow();
  if (!i18n.isInitialized) await i18n.init({ lng: "en", resources: {} });
  await i18n.changeLanguage("en");
});

describe("bilingual + untranslated", () => {
  it("a complete Urdu has nothing untranslated", () => {
    expect(untranslated(SAMPLE)).toEqual([]);
  });

  it("empty, missing or still-English Urdu is listed, by path", () => {
    const broken = { en: SAMPLE.en, ur: { ...SAMPLE.ur, open: "Open", nested: { close: "" }, grade: (g: number) => `Grade ${g}` } } as typeof SAMPLE;
    expect(untranslated(broken).sort()).toEqual(["grade", "nested.close", "open"]);
  });

  it("words that ARE the same in both languages can be allowed by path", () => {
    const same = bilingual({ brand: "NIETE", dash: "—" }, { brand: "NIETE", dash: "—" });
    expect(untranslated(same)).toEqual(["brand", "dash"]);
    expect(untranslated(same, ["brand", "dash"])).toEqual([]);
  });

  it("copyIn picks a language's words", () => {
    expect(copyIn(SAMPLE, "ur").open).toBe("کھولیں");
    expect(copyIn(SAMPLE, "en").grade(4)).toBe("Grade 4");
  });
});

describe("useLang / useCopy", () => {
  it("follow the page's language, and re-render on a switch", async () => {
    const { result } = renderHook(() => ({ lang: useLang(), C: useCopy(SAMPLE) }));
    expect(result.current.lang).toBe("en");
    expect(result.current.C.open).toBe("Open");
    await act(async () => { await i18n.changeLanguage("ur"); });
    expect(result.current.lang).toBe("ur");
    expect(result.current.C.open).toBe("کھولیں");
    expect(result.current.C.grade(4)).toBe("جماعت 4");
  });

  it("a language outside the offer reads as English", async () => {
    await act(async () => { await i18n.changeLanguage("sw"); });
    const { result } = renderHook(() => useCopy(SAMPLE));
    expect(result.current.open).toBe("Open");
  });
});

describe("useFollowPreferredLanguage", () => {
  it("follows her stored Urdu even when she did not lock it — read, never written", async () => {
    get.mockResolvedValue({ language: "ur", locked: false });
    renderHook(() => useFollowPreferredLanguage(true));
    await waitFor(() => expect(i18n.language).toBe("ur"));
    expect(set).not.toHaveBeenCalled();
  });

  it("follows English back too", async () => {
    await i18n.changeLanguage("ur");
    get.mockResolvedValue({ language: "en", locked: true });
    renderHook(() => useFollowPreferredLanguage(true));
    await waitFor(() => expect(i18n.language).toBe("en"));
  });

  it("a language outside the offer is ignored", async () => {
    get.mockResolvedValue({ language: "sw", locked: true });
    renderHook(() => useFollowPreferredLanguage(true));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(i18n.language).toBe("en");
  });

  it("asked once per page load, not on every page", async () => {
    get.mockResolvedValue({ language: "ur", locked: false });
    renderHook(() => useFollowPreferredLanguage(true));
    renderHook(() => useFollowPreferredLanguage(true));
    await waitFor(() => expect(i18n.language).toBe("ur"));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("not before she is known (ready=false): nothing asked", () => {
    renderHook(() => useFollowPreferredLanguage(false));
    expect(get).not.toHaveBeenCalled();
  });

  it("a failed read changes nothing", async () => {
    get.mockRejectedValue(new Error("down"));
    renderHook(() => useFollowPreferredLanguage(true));
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(i18n.language).toBe("en");
  });
});

describe("the build refuses an incomplete Urdu (tsc reads these; an unused @ts-expect-error fails it)", () => {
  it("missing key, extra key, wrong function signature", () => {
    // @ts-expect-error — `close` is missing from the Urdu
    bilingual({ open: "Open", close: "Close" }, { open: "کھولیں" });
    // @ts-expect-error — `extra` is not an English key
    bilingual({ open: "Open" }, { open: "کھولیں", extra: "اضافی" });
    // @ts-expect-error — the Urdu function takes a string where the English takes a number
    bilingual({ grade: (g: number) => `Grade ${g}` }, { grade: (g: string) => `جماعت ${g}` });
    expect(true).toBe(true);
  });
});
