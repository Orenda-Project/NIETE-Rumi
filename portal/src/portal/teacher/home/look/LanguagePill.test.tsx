import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../services/api", () => ({ language: { get: vi.fn(), set: vi.fn() } }));
vi.mock("i18next", () => {
  const handlers: Array<() => void> = [];
  const i18n = {
    language: "en",
    on: (_e: string, h: () => void) => { handlers.push(h); },
    off: () => {},
    changeLanguage: vi.fn(async (lng: string) => { i18n.language = lng; handlers.forEach((h) => h()); }),
  };
  return { default: i18n };
});
import i18n from "i18next";
import { language } from "../../../services/api";
import { useLanguageSwitch } from "../../useLanguageSwitch";
import { LanguagePill } from "./LanguagePill";

/**
 * The look's language pill: one button naming the OTHER language, saving through the one writer (useLanguageSwitch →
 * PUT /me/language) and only then switching the page. Words are existing frame strings (more.switchTo, more.language).
 */
function Pill() {
  const lang = useLanguageSwitch();
  return <LanguagePill lang={lang} />;
}

describe("LanguagePill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (i18n as unknown as { language: string }).language = "en";
    vi.mocked(language.get).mockResolvedValue({ language: "en", locked: false });
    vi.mocked(language.set).mockResolvedValue(undefined);
  });

  it("names the other language, with a spoken label", () => {
    render(<Pill />);
    const pill = screen.getByTestId("home-look-lang");
    expect(pill.tagName).toBe("BUTTON");
    expect(pill.getAttribute("type")).toBe("button");
    expect(pill).toHaveTextContent("اردو");
    expect(pill.getAttribute("aria-label")).toBe("Language: اردو");
  });

  it("on an Urdu page it names English", () => {
    (i18n as unknown as { language: string }).language = "ur";
    render(<Pill />);
    const pill = screen.getByTestId("home-look-lang");
    expect(pill).toHaveTextContent("English");
    expect(pill.getAttribute("aria-label")).toBe("زبان: English");
  });

  it("is a 44 px target", () => {
    render(<Pill />);
    expect(screen.getByTestId("home-look-lang").className).toMatch(/min-h-\[44px\]/);
    expect(screen.getByTestId("home-look-lang").className).toMatch(/min-w-\[44px\]/);
  });

  it("one tap: one save to the other language, then the page switches", async () => {
    render(<Pill />);
    await userEvent.click(screen.getByTestId("home-look-lang"));
    await waitFor(() => expect(i18n.changeLanguage).toHaveBeenCalledWith("ur"));
    expect(language.set).toHaveBeenCalledTimes(1);
    expect(language.set).toHaveBeenCalledWith("ur");
  });

  it("is disabled while it saves (a second tap writes nothing)", async () => {
    vi.mocked(language.set).mockReturnValue(new Promise(() => {}));
    render(<Pill />);
    const pill = screen.getByTestId("home-look-lang");
    await userEvent.click(pill);
    await waitFor(() => expect(pill).toBeDisabled());
    await userEvent.click(pill);
    expect(language.set).toHaveBeenCalledTimes(1);
  });

});
