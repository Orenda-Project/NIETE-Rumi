/**
 * bd-t7zk3t.11 — what every FLN page reads: who is looking (`/fln/me`, fetched by FlnGate on every mount, never
 * cached — the Share bar depends on it), the page language (`ui_lang`, her preferred_language), its direction and
 * that language's words. A plan's OWN text keeps the plan's language; this is the chrome's.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { FLN_DIR, flnStrings, type FlnLang } from './strings';
import type { FlnMe } from './types';

export interface FlnCtx {
  me: FlnMe;
  lang: FlnLang;
  dir: 'ltr' | 'rtl';
  s: ReturnType<typeof flnStrings>;
}

const Ctx = createContext<FlnCtx | null>(null);

/** The page language from /me: only `ur` is Urdu; anything else is English. */
export function langOfMe(me: Pick<FlnMe, 'ui_lang'> | null | undefined): FlnLang {
  return me?.ui_lang === 'ur' ? 'ur' : 'en';
}

export function FlnProvider({ me, children }: { me: FlnMe; children: ReactNode }) {
  const value = useMemo<FlnCtx>(() => {
    const lang = langOfMe(me);
    return { me, lang, dir: FLN_DIR[lang], s: flnStrings(lang) };
  }, [me]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFln(): FlnCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFln() outside <FlnGate>/<FlnProvider>');
  return v;
}
