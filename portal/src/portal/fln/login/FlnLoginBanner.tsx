/**
 * bd-t7zk3t.12 — the sign-in page's banner when a shared plan link brought the user here (DESIGN v2 §4 L4, ruling 19):
 * bilingual by construction, because the receiver's language is unknown before sign-in — the plan's title in ITS
 * language (GET /api/portal/fln/title/:id, left out on any error) + "Sign in to open" + «کھولنے کے لیے سائن اِن
 * کریں», always both. Nothing at all unless `next=` is a safe /portal/fln/p/<id> path.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { safeNext } from '../lib/safeNext';
import { shareApi } from '../share/api';
import { shareStrings, type ShareLang } from '../share/strings.share';
import '../share/share.css';

const PLAN_PATH = /^\/portal\/fln\/p\/(\d{1,12})(?:[?#]|$)/;

export function planIdFromNext(search: string): string | null {
  const next = safeNext(new URLSearchParams(search).get('next'));
  const m = next ? PLAN_PATH.exec(next) : null;
  return m ? m[1] : null;
}

export default function FlnLoginBanner() {
  const { search } = useLocation();
  const id = planIdFromNext(search);
  const [title, setTitle] = useState<{ title: string; lang: ShareLang; dir: 'ltr' | 'rtl' } | null>(null);
  useEffect(() => {
    setTitle(null);
    if (!id) return undefined;
    let alive = true;
    void shareApi.title(id).then((r) => {
      if (alive && r.ok && r.data && typeof r.data.title === 'string') {
        setTitle({ title: r.data.title, lang: r.data.lang === 'ur' ? 'ur' : 'en', dir: r.data.dir === 'rtl' ? 'rtl' : 'ltr' });
      }
    });
    return () => { alive = false; };
  }, [id]);
  if (!id) return null;
  return (
    <div className="fln-root mb-5" data-testid="fln-login-banner">
      <div role="note" className="flex flex-col gap-1 rounded-[14px] border-2 border-[#47BA7D] bg-[#eef8f2] px-4 py-3 text-[#333748]">
        {title ? (
          <p data-testid="fln-login-banner-title" lang={title.lang} dir={title.dir} className="text-[17px] font-bold leading-snug">{title.title}</p>
        ) : null}
        <p lang="en" dir="ltr" className="text-[16px] font-semibold">{shareStrings('en').signInToOpen}</p>
        <p lang="ur" dir="rtl" className="text-[16px] font-semibold">{shareStrings('ur').signInToOpen}</p>
      </div>
    </div>
  );
}
