/**
 * bd-s0ccn5.2.4 — "Download PDF" on the plan page: the plan's text and pictures as a pre-rendered PDF (no sound).
 *
 * Shown only when GET /plan/:id/pdf answers with an https link, so a plan whose PDF was never rendered (or a failed
 * probe) shows nothing. A tap asks for a FRESH link (the server's expires in minutes; the tab may have been open
 * longer) and navigates to it: the bucket answers as an attachment, so the page stays and the file downloads.
 * Asks only for a link: no open is logged, nothing is written.
 */
import { useEffect, useState } from 'react';
import { flnApi } from '../api';
import { flnStrings, type FlnLang } from '../strings';
import { Chrome } from './text';

const linkOf = (r: { url?: unknown } | null): string | null =>
  r && typeof r.url === 'string' && /^https:\/\//i.test(r.url) ? r.url : null;

export function DownloadPdf({ planId, lang }: { planId: number | string; lang: FlnLang }) {
  const s = flnStrings(lang).download;
  const rtl = lang === 'ur';
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setShown(false);
    flnApi.pdf(planId).then((r) => { if (live) setShown(!!linkOf(r)); }, () => undefined);
    return () => { live = false; };
  }, [planId]);

  if (!shown) return null;
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    let url: string | null = null;
    try { url = linkOf(await flnApi.pdf(planId)); } catch { url = null; }
    setBusy(false);
    if (url) window.location.assign(url);
    else setFailed(true);
  };
  return (
    <div className="fln-pdf-dl">
      <button type="button" className="fln-btn fln-pdf-dl-btn" onClick={download} disabled={busy} aria-label={s.label}>
        <span aria-hidden="true">⬇ </span><Chrome text={s.label} rtl={rtl} />
      </button>
      {failed ? <p className="fln-plan-msg" role="status"><Chrome text={s.failed} rtl={rtl} /></p> : null}
    </div>
  );
}
