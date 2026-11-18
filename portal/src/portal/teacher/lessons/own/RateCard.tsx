import { useState } from 'react';
import { RatingScale } from '../../ui';
import { CARD, FOCUS, PRIMARY_WIDE } from '../../ui/styles';
import { useCopy } from '../../i18n';
import { RATE } from './rateCopy';
import { rateOwnPlan } from './api';

/**
 * bd-snkn32.11 (queue #134 C) — on her own plan in the viewer: "How good was this plan?" (1-5, one tap) and an optional
 * "What was confusing?" (300 characters), then Send. Saved → a thank-you line; a failure → "try again", her words kept.
 * Shown only for her own plan (the viewer has state.own only when Preparing opened her plan), never a shelf plan.
 */
const NOTE_MAX = 300;
const SCALE = ['1', '2', '3', '4', '5'] as const;

export function RateCard({ ownId }: { ownId: string }) {
  const C = useCopy(RATE);
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle');
  if (state === 'saved') {
    return <p data-testid="own-rate-thanks" className="text-[15px] font-semibold text-[#2f7a50]">{C.thanks}</p>;
  }
  async function send() {
    if (!rating || busy) return;
    setBusy(true);
    const ok = await rateOwnPlan(ownId, rating, note.trim());
    setBusy(false);
    setState(ok ? 'saved' : 'failed');
  }
  const levels = C.levels as Record<string, string>;
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} data-testid="own-rate">
      <h2 className="text-[16px] font-semibold text-[#1d2025]">{C.question}</h2>
      <RatingScale name={C.scaleName} value={rating ? String(rating) : null} options={SCALE.map((id) => ({ id, label: levels[id] }))} onChange={(k) => setRating(Number(k))} />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-[#4b5563]">{C.confusing} · {C.optional}</span>
        <textarea
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          className={`min-h-[56px] rounded-2xl border border-[#e5e7eb] bg-white px-4 py-3 text-[16px] ${FOCUS}`}
          data-testid="own-rate-note"
        />
      </label>
      {state === 'failed' ? <p role="alert" className="text-[15px] font-semibold text-[#c8331f]">{C.failed}</p> : null}
      <button type="button" disabled={!rating || busy} onClick={() => { void send(); }} data-testid="own-rate-send"
        className={`${PRIMARY_WIDE} disabled:opacity-50 ${FOCUS}`}>
        {C.send}
      </button>
    </section>
  );
}
