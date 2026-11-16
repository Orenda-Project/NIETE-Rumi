import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import TeacherPage from '../../TeacherPage';
import { useCopy } from '../../i18n';
import { FOCUS } from '../../ui/styles';
import { dataOf, useLoad } from '../../../newui/lessons/shared';
import { LoadState } from '../LoadState';
import { LESSONS_HOME } from '../paths';
import { SHELF, type ShelfCopy } from './copy';
import { decideOwn, fetchReviewQueue, reviewPdfUrl, useLpOwnReviewer, type ReviewPlan } from './api';

/** bd-snkn32.42 — the staff check before a teacher's plan is listed: /portal/teacher/lessons/check. */
export { LESSONS_CHECK } from './flag';

const BTN = cn('h-11 rounded-[12px] px-4 text-[14px] font-semibold', FOCUS);

/**
 * Only for staff listed in portal_lp_own_reviewers (features.lpOwnReviewer; the server says 404 to anyone else too).
 * Each plan the AI reviewer passed and no one has decided: its lesson, score, the checks rated below 3 and those not
 * checked at its grade, its PDF, and Approve / Reject (a rejection needs a reason). Never who made it.
 */
export function ReviewPage() {
  const on = useLpOwnReviewer();
  if (on === null) return null;
  if (!on) return <Navigate to={LESSONS_HOME} replace />;
  return <Queue />;
}

function Queue() {
  const C = useCopy(SHELF);
  const [queue, retry] = useLoad(fetchReviewQueue, 'own-review');
  const list = dataOf(queue) ?? [];
  return (
    <TeacherPage feature="lessons" title={C.reviewTitle} backTo={LESSONS_HOME}>
      <LoadState status={queue.status} empty={!list.length} onRetry={retry} />
      {queue.status === 'ok' && !list.length ? <p className="text-[14px] text-[#6b7280]">{C.reviewEmpty}</p> : null}
      <div className="flex flex-col gap-3" data-testid="own-review">
        {list.map((p) => <Card key={p.ownId} plan={p} C={C} />)}
      </div>
    </TeacherPage>
  );
}

function Card({ plan, C }: { plan: ReviewPlan; C: ShelfCopy }) {
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    setFailed(false);
    const ok = await decideOwn(plan.ownId, decision, decision === 'reject' ? reason.trim() : undefined);
    setBusy(false);
    if (ok) setDone(decision === 'approve' ? 'approved' : 'rejected');
    else setFailed(true);
  };
  const openPdf = async () => {
    const url = await reviewPdfUrl(plan.ownId);
    if (url) window.open(url, '_blank', 'noopener');
  };

  return (
    <article className="rounded-[16px] border border-[#e5e7eb] bg-white p-4" data-testid="own-review-card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="min-w-0 break-words text-[15px] font-semibold text-[#33374a]">{plan.lesson}</h2>
        <span className="shrink-0 text-[14px] font-semibold text-[#33374a]">{C.score(plan.score)}</span>
      </div>
      <p className="mt-1 text-[13px] text-[#6b7280]">{C.langs[plan.lang === 'ur' ? 'ur' : 'en']} · {C.bands[plan.band]}</p>
      <h3 className="mt-3 text-[13px] font-semibold text-[#33374a]">{plan.below.length ? C.below : C.noneBelow}</h3>
      {plan.below.length ? (
        <ul className="mt-1 list-disc ps-5 text-[13px] text-[#33374a]">
          {plan.below.map((b) => <li key={b.id}>{`${b.id} ${b.name}: ${b.rating}`}</li>)}
        </ul>
      ) : null}
      {plan.notAssessed.length ? <p className="mt-2 text-[13px] text-[#6b7280]">{`${C.notAssessed}: ${plan.notAssessed.join(', ')}`}</p> : null}
      <button type="button" onClick={() => { void openPdf(); }} className={cn(BTN, 'mt-3 border border-[#e5e7eb] bg-white text-[#33374a]')}>
        {C.openPdf}
      </button>
      {done ? (
        <p className="mt-3 text-[14px] font-semibold text-[#33374a]" role="status">{done === 'approved' ? C.approved : C.rejected}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rejecting ? (
            <>
              <label className="text-[13px] text-[#33374a]">
                {C.reason}
                <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-[12px] border border-[#e5e7eb] p-2 text-[14px]" />
              </label>
              <button type="button" disabled={busy || !reason.trim()} onClick={() => { void decide('reject'); }} className={cn(BTN, 'bg-[#b91c1c] text-white disabled:opacity-50')}>
                {C.sendReject}
              </button>
            </>
          ) : (
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => { void decide('approve'); }} className={cn(BTN, 'flex-1 bg-[#1f7a4d] text-white disabled:opacity-50')}>
                {C.approve}
              </button>
              <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={cn(BTN, 'flex-1 border border-[#e5e7eb] bg-white text-[#b91c1c]')}>
                {C.reject}
              </button>
            </div>
          )}
          {failed ? <p className="text-[13px] text-[#b91c1c]" role="alert">{C.failed}</p> : null}
        </div>
      )}
    </article>
  );
}
