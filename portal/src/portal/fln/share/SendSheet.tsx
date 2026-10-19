/**
 * "Send to teacher" (DESIGN v2 §4 L2a, primary): the plan card, the leader's own teachers, Send →
 * POST /api/portal/fln/send {plan, teachers} (PR-E). The bot then sends each chosen teacher THEIR OWN sign-in link to
 * the plan, so it opens inside WhatsApp's browser, signed in. Answers drawn (§7): Sent ✓ · n teachers; the partial
 * failure line (the rest are marked sent); the 429 rate-limit line; no teachers in scope. When the server routes are
 * not deployed (/teachers 404) the sheet says so in one calm line and offers Share link.
 */
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { FOCUS } from '../../teacher/ui/styles';
import { shareApi } from './api';
import { Fill } from './Fill';
import { PlanCard, type SharePlan } from './PlanCard';
import { BTN, WA_GREEN } from './ShareSheet';
import { Sheet } from './Sheet';
import TeacherPicker, { type PickerState } from './TeacherPicker';
import { MAX_RECIPIENTS, shareStrings, type ShareLang } from './strings.share';

type Outcome =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; sent: number; failed: number }
  | { kind: 'rate' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | { kind: 'signin' };

export default function SendSheet({ plan, lang, onClose, onShareLink }: {
  plan: SharePlan;
  lang: ShareLang;
  onClose: () => void;
  onShareLink: () => void;
}) {
  const S = shareStrings(lang);
  const [selected, setSelected] = useState<string[]>([]);
  const [picker, setPicker] = useState<PickerState>('loading');
  const [out, setOut] = useState<Outcome>({ kind: 'idle' });
  const busy = useRef(false);

  const send = useCallback(async () => {
    if (busy.current || selected.length === 0) return;
    busy.current = true;
    setOut({ kind: 'sending' });
    const r = await shareApi.send(plan.id, selected.slice(0, MAX_RECIPIENTS));
    busy.current = false;
    if (r.ok) {
      const failed = r.data.failed.filter((k) => selected.includes(k));
      setOut({ kind: 'done', sent: r.data.queued, failed: failed.length });
      // Keep only the ones that failed picked, so "Try again" resends exactly those.
      setSelected(failed);
    } else if (r.status === 429) setOut({ kind: 'rate' });
    else if (r.status === 404) setOut({ kind: 'unavailable' });
    // A lessons-scoped link session may read plans but not send (portal-link scope guard): say how, not "failed".
    else if (r.status === 403 && r.error === 'link_area_only') setOut({ kind: 'signin' });
    else setOut({ kind: 'error' });
  }, [plan.id, selected]);

  const unavailable = picker === 'unavailable' || out.kind === 'unavailable' || out.kind === 'signin';

  return (
    <Sheet lang={lang} title={S.sendToTeacher} onClose={onClose} testId="fln-send-sheet">
      <PlanCard plan={plan} lang={lang} />
      {unavailable ? (
        <div className="flex flex-col gap-3">
          <p className="text-[17px]">{out.kind === 'signin' ? S.sendNeedsSignIn : S.sendUnavailable}</p>
          <button type="button" onClick={onShareLink} className={cn(BTN, 'border-[#333748] bg-white text-[#333748]', FOCUS)}>{S.shareLink}</button>
        </div>
      ) : (
        <>
          <TeacherPicker lang={lang} selected={selected} onChange={setSelected} onState={setPicker} />
          <div role="status" aria-live="polite" className="flex flex-col gap-1 text-[16px] font-semibold">
            {out.kind === 'done' && out.sent > 0 ? (
              <p className="text-[#0B6B2E]">
                <Fill text={out.sent === 1 ? S.sentOne : S.sent} values={{ n: out.sent }} lang={lang} />
              </p>
            ) : null}
            {out.kind === 'done' && out.failed > 0 ? (
              <p className="text-[#7a271a]">
                <Fill text={out.failed === 1 ? S.sentPartialOne : S.sentPartial} values={{ n: out.failed }} lang={lang} />
              </p>
            ) : null}
            {out.kind === 'rate' ? <p className="text-[#7a271a]"><Fill text={S.rateLimited} values={{ n: MAX_RECIPIENTS }} lang={lang} /></p> : null}
            {out.kind === 'error' ? <p className="text-[#7a271a]">{S.sendFailed}</p> : null}
          </div>
          {picker === 'ready' || picker === 'empty' ? (
            <button
              type="button"
              onClick={send}
              disabled={selected.length === 0 || out.kind === 'sending'}
              aria-busy={out.kind === 'sending'}
              style={{ backgroundColor: WA_GREEN, borderColor: WA_GREEN }}
              className={cn(BTN, 'text-white disabled:cursor-not-allowed disabled:opacity-50', FOCUS)}
            >
              {out.kind === 'sending' ? S.sending : S.send}
            </button>
          ) : null}
        </>
      )}
    </Sheet>
  );
}
