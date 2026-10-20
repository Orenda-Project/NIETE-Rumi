import { useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw, Share2 } from 'lucide-react';
import { childTestSa } from '../../services/api';
import type { AssessCopy, Lang } from '../../lib/assess/copy';
import type { Block } from '../../lib/assess/blocks';
import { qrMatrix, qrSvgPath } from '../../lib/assess/qr';
import AssessActions from './AssessActions';

/**
 * Opening a child's test on another phone: a one-hour token from the server, and
 * the link as a QR code for the other phone's camera. The link carries the
 * server's session id and the token, never a name (a photo of this screen must
 * not name the child); the coach says the name aloud, so the screen says only
 * "Child 3".
 */

const QR_PX = 264;

export function otherPhoneUrl(origin: string, s: string, grade: number, lang: Lang, block: Block, token: string): string {
  const q = new URLSearchParams({ s, form: `sa.coach.G${grade}.A.${lang}`, mode: 'proctored', lang, block, t: token });
  return `${origin}/sa/play.html?${q.toString()}`;
}

type Props = {
  copy: AssessCopy;
  serverId: string;
  childNo: number;
  grade: number;
  lang: Lang;
  block: Block;
  onDone: () => void;
};

export default function AssessOtherPhone({ copy, serverId, childNo, grade, lang, block, onDone }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    childTestSa.mintLink(serverId)
      .then((r) => { if (live) setToken(r.token); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [serverId, attempt]);

  const url = token ? otherPhoneUrl(window.location.origin, serverId, grade, lang, block, token) : null;
  const qr = useMemo(() => {
    if (!url) return null;
    try { return qrSvgPath(qrMatrix(url), 4); } catch { return null; }
  }, [url]);

  const copyLink = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* the QR still works */ }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = async () => {
    if (!url) return;
    try { await navigator.share({ url }); } catch { /* dismissed */ }
  };

  return (
    <div data-testid="assess-other-phone" className="space-y-4 text-center">
      <p className="text-3xl font-bold text-slate-900">{copy.childNo(childNo)}</p>
      {failed ? (
        <div className="space-y-3">
          <p className="text-slate-700">{copy.loadFailed}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mx-auto flex min-h-[48px] items-center gap-2 rounded-xl border px-4">
            <RefreshCw className="h-4 w-4" aria-hidden /> {copy.tryAgain}
          </button>
        </div>
      ) : !url ? <p className="text-slate-600">{copy.loading}</p> : (
        <>
          {qr && (
            <svg data-testid="assess-qr" role="img" aria-label={copy.scanHint} viewBox={`0 0 ${qr.size} ${qr.size}`} width={QR_PX} height={QR_PX}
              shapeRendering="crispEdges" className="mx-auto block max-w-full rounded-lg" style={{ background: '#fff' }}>
              <rect width={qr.size} height={qr.size} fill="#fff" />
              <path d={qr.d} fill="#000" />
            </svg>
          )}
          <p className="font-medium text-slate-900">{copy.scanHint}</p>
          <input data-testid="assess-link-url" readOnly value={url} dir="ltr" aria-label={copy.copyLink}
            onFocus={(e) => e.currentTarget.select()} className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs text-slate-700" />
          <div className="flex gap-2">
            <button type="button" onClick={copyLink} className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white">
              <Copy className="h-4 w-4" aria-hidden /> {copied ? copy.copied : copy.copyLink}
            </button>
            {canShare && (
              <button type="button" onClick={share} className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white">
                <Share2 className="h-4 w-4" aria-hidden /> {copy.share}
              </button>
            )}
          </div>
          <p className="text-sm text-slate-600">{copy.linkHour}</p>
        </>
      )}
      <AssessActions>
        <button type="button" disabled={!url} onClick={onDone}
          className="w-full min-h-[56px] rounded-2xl bg-emerald-600 text-xl font-semibold text-white disabled:opacity-60">{copy.linkDone}</button>
      </AssessActions>
    </div>
  );
}
