import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import i18n from "i18next";
import { language as languageApi } from "../services/api";

/**
 * bd-fmf24g.1 — More's Language row: the same behaviour as the new UI's pull-up menu
 * tile (newui/PullUpMenu.tsx useLanguageTile, bd-5rz1v.18), for the teacher v2 frame.
 *
 *   - NIETE is flat en/ur (language-protocol §1): the row names the language it switches TO.
 *   - ONE writer: PUT /me/language → the bot's setUserLanguage (validates, locks, busts the
 *     cache). The page changes language only after the server accepted it; a rejection leaves
 *     the page as it was and says "Not saved".
 *   - A locked choice the page is not showing is followed (read, never written); an unlocked
 *     value is a default, not her decision, and changes nothing.
 */
export type Lang = "ur" | "en";
const asLang = (code?: string | null): Lang => (String(code || "").toLowerCase().startsWith("ur") ? "ur" : "en");
const isOffered = (code: unknown): code is Lang => code === "ur" || code === "en";

function subscribe(onChange: () => void) {
  i18n.on("languageChanged", onChange);
  return () => { i18n.off("languageChanged", onChange); };
}
const currentLanguage = () => asLang(i18n.language);

export function useLanguageSwitch() {
  const page = useSyncExternalStore(subscribe, currentLanguage, currentLanguage);
  const [status, setStatus] = useState<"idle" | "saving" | "failed">("idle");
  const tapped = useRef(false);

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => languageApi.get())
      .then(({ language, locked }) => {
        if (!live || tapped.current || locked !== true || !isOffered(language)) return;
        if (language !== currentLanguage()) void i18n.changeLanguage(language);
      })
      .catch(() => { /* the row still works: the write is what matters */ });
    return () => { live = false; };
  }, []);

  const target: Lang = page === "ur" ? "en" : "ur";
  const toggle = useCallback(async () => {
    if (status === "saving") return;
    tapped.current = true;
    setStatus("saving");
    try {
      await languageApi.set(target);
      await i18n.changeLanguage(target);
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  }, [status, target]);

  return { target, status, toggle };
}
