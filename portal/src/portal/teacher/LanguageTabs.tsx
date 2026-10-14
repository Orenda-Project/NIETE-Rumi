import { StatusChip, Tabs } from "./ui";
import { TEACHER_FRAME } from "./copy";
import { useCopy } from "./i18n";
import { useLanguageSwitch } from "./useLanguageSwitch";

/**
 * The ONE English | اردو toggle of the teacher app: the kit Tabs, each word in its own language, the language she is on
 * picked. Picking the other saves through the one writer (useLanguageSwitch → PUT /me/language → setUserLanguage) and
 * only then switches the page; picking the one she is on writes nothing. More's Language row and the top of Home
 * (operator, 2026-10-14: design doc option B) both draw it from here, so they never drift apart.
 */
export function LanguageToggle({ lang }: { lang: ReturnType<typeof useLanguageSwitch> }) {
  const C = useCopy(TEACHER_FRAME);
  // `lang.target` is the language she is NOT on, so the picked one is the other of the two.
  const current = lang.target === "ur" ? "en" : "ur";
  return (
    <Tabs
      label={C.more.language}
      value={current}
      tabs={[{ key: "en", label: C.more.switchTo.en }, { key: "ur", label: C.more.switchTo.ur }]}
      onChange={(key) => { if (key !== current) void lang.toggle(); }}
    />
  );
}

/**
 * The toggle on its own (Home's band): full width, with "Not saved" under it when the server refused the change, so
 * the page stays as it was and says so. Nothing spins while it saves.
 */
export function LanguageTabs({ testId }: { testId?: string }) {
  const C = useCopy(TEACHER_FRAME);
  const lang = useLanguageSwitch();
  return (
    <div data-testid={testId} className="flex flex-col items-start gap-2">
      <div className="w-full"><LanguageToggle lang={lang} /></div>
      {lang.status === "failed" && <StatusChip text={C.more.notSaved} tone="error" />}
    </div>
  );
}
