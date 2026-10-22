/**
 * The signed-in gate for /portal/fln/* (SPEC v2 §3: there is no generic one; leaders pass, no
 * TeacherGate). On EVERY mount it asks GET /api/portal/fln/me with plain fetch (never cached: a shared school phone
 * changes hands, and the Share bar reads `share` from it):
 *
 *   401            → /portal/login?next=<path+search> (replace); the login page's safeNext (m-links) brings her back
 *   404 / lessons:false → "This lesson isn't available" + a link to the lessons home
 *   503 / network  → the calm "not available right now" line + Try again
 *   ok             → <div class="fln-root fln-app" lang dir> + the FLN context + the page
 *
 * While /me loads: a reserved-height skeleton (no layout jump when the page arrives).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FlnAuthError, flnApi } from './api';
import { FlnProvider } from './FlnContext';
import { FLN_DIR, flnStrings, type FlnLang } from './strings';
import type { FlnMe } from './types';
import { useLang } from '../teacher/i18n';
import { lessonsBack } from '../teacher/lessons/paths';
import './fln.css';

// bd-4joiqz — the one way back to the lesson plans (teacher/lessons/paths lessonsBack): a leader's tab too.
export const LESSONS_HOME = lessonsBack();

type GateState =
  | { k: 'loading' }
  | { k: 'off'; lang?: FlnLang }
  | { k: 'error' }
  | { k: 'ok'; me: FlnMe };

/** The root every FLN page sits in; lang/dir are the CHROME's. */
function Root({ lang, children }: { lang: FlnLang; children: ReactNode }) {
  return <div className="fln-root fln-app" lang={lang} dir={FLN_DIR[lang]}>{children}</div>;
}

/** "This lesson isn't available" + the way back to the lessons (DESIGN v2 §7). */
export function FlnNotAvailable({ lang, to = LESSONS_HOME }: { lang: FlnLang; to?: string }) {
  const s = flnStrings(lang);
  return (
    <div className="fln-page fln-state" data-fln-state="not-available">
      <p className="fln-state-line">{s.errors.notAvailable}</p>
      <Link className="fln-btn" to={to}>{s.errors.toList}</Link>
    </div>
  );
}

/** The calm "not available right now" line + Try again (503, 5xx, network). */
export function FlnUnavailable({ lang, onRetry }: { lang: FlnLang; onRetry: () => void }) {
  const s = flnStrings(lang);
  return (
    <div className="fln-page fln-state" data-fln-state="unavailable">
      <p className="fln-state-line">{s.errors.unavailable}</p>
      <button type="button" className="fln-btn" onClick={onRetry}>{s.errors.retry}</button>
    </div>
  );
}

export function FlnGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  // Before /me answers we do not know her FLN language: the teacher app's language stands in.
  const appLang = useLang();
  const [state, setState] = useState<GateState>({ k: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ k: 'loading' });
    flnApi.me().then(
      (me) => {
        if (!live) return;
        setState(me && me.lessons ? { k: 'ok', me } : { k: 'off', lang: me?.ui_lang === 'ur' ? 'ur' : me?.ui_lang === 'en' ? 'en' : undefined });
      },
      (err) => {
        if (!live) return;
        if (err instanceof FlnAuthError) {
          navigate(`/portal/login?next=${encodeURIComponent(pathname + search)}`, { replace: true });
          return;
        }
        setState({ k: 'error' });
      },
    );
    return () => { live = false; };
    // Every mount and every retry; not on in-app navigation between FLN pages (the gate stays mounted).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state.k === 'ok') {
    const lang: FlnLang = state.me.ui_lang === 'ur' ? 'ur' : 'en';
    return (
      <Root lang={lang}>
        <FlnProvider me={state.me}>{children}</FlnProvider>
      </Root>
    );
  }
  const lang: FlnLang = (state.k === 'off' && state.lang) || appLang;
  return (
    <Root lang={lang}>
      {state.k === 'loading' && (
        <div className="fln-page" data-fln-skeleton="gate" aria-busy="true">
          <span className="fln-sr">{flnStrings(appLang).errors.loading}</span>
          <div className="fln-skel fln-skel-top" />
          <div className="fln-skel fln-skel-block" />
          <div className="fln-skel fln-skel-block" />
        </div>
      )}
      {state.k === 'off' && <FlnNotAvailable lang={lang} />}
      {state.k === 'error' && <FlnUnavailable lang={lang} onRetry={retry} />}
    </Root>
  );
}

export default FlnGate;
