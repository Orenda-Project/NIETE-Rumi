import { Link } from 'react-router-dom';
import { Mic, Upload } from 'lucide-react';
import { entryCopy } from '../../../lib/coachObserve';

/**
 * bd-5rz1v.6 — the coach's entry to "send a lesson", in the operator's pick for
 * the teachers' button (Option B, variant B3, Colour-3 deep green): one card that
 * NAMES the goal and does not promise to record, and — on the next screen — the
 * two ways, the record one solid red.
 *
 * The words come from lib/coachObserve (one place, following the teachers' pick).
 */

/** The chalkboard of the B3 button. */
export const BoardIcon = ({ size = 54 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect x="5" y="8" width="54" height="36" rx="3" fill="#2f5d46" stroke="#9a6a35" strokeWidth="4" />
    <path d="M13 19h18M13 27h28M13 35h12" stroke="#e8f5ee" strokeWidth="3" strokeLinecap="round" />
    <circle cx="47" cy="33" r="5" fill="#ffd54f" />
    <path d="M20 44l-6 14M44 44l6 14" stroke="#9a6a35" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

/** The record icon for a red button: a white dot with a red microphone, and white ripples. */
export const RecordIconOnRed = ({ size = 56 }: { size?: number }) => {
  const core = Math.round(size * 0.64);
  return (
    <span aria-hidden="true" className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-full bg-[rgba(255,255,255,0.45)] animate-rec-wave motion-reduce:hidden" />
      <span className="absolute inset-0 rounded-full bg-[rgba(255,255,255,0.45)] animate-rec-wave [animation-delay:1s] motion-reduce:hidden" />
      <span className="relative inline-flex items-center justify-center rounded-full bg-white shadow-[0_0_0_5px_rgba(255,255,255,0.25)] animate-rec-core motion-reduce:animate-none"
        style={{ width: core, height: core }}>
        <Mic className="text-[#d32f2f]" style={{ width: core * 0.48, height: core * 0.48 }} strokeWidth={2.2} />
      </span>
    </span>
  );
};

/** The goal card on Observations. */
export const CoachObserveEntryCard = ({ to = '/portal/leader/observe/new' }: { to?: string }) => {
  const copy = entryCopy();
  return (
    <Link to={to} data-testid="coach-observe-entry"
      className="flex flex-col items-center gap-3 rounded-[20px] border-[3px] border-[#2e7d57] bg-[#2e7d57] px-5 py-6 text-center shadow-[0_4px_14px_rgba(46,125,87,0.25)]">
      <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-white"><BoardIcon /></span>
      <span className="text-2xl font-bold leading-tight text-white">{copy.title}</span>
      <span className="text-[15px] leading-snug text-[#d9f0e3]">{copy.sub}</span>
    </Link>
  );
};

/** The two ways, as the sheet offers them. `onRecord` is omitted where the microphone cannot work. */
export const WaysOptions = ({ onRecord, onFile }: { onRecord?: () => void; onFile: () => void }) => {
  const copy = entryCopy();
  return (
    <>
      {onRecord && (
        <button type="button" onClick={onRecord}
          className="flex items-center gap-4 rounded-2xl border-[3px] border-[#d32f2f] bg-[#d32f2f] p-3.5 text-left">
          <RecordIconOnRed size={56} />
          <span className="flex flex-col gap-0.5">
            <span className="text-[19px] font-bold text-white">{copy.rec}</span>
            <span className="text-sm text-[#fde3e1]">{copy.recSub}</span>
          </span>
        </button>
      )}
      <button type="button" onClick={onFile}
        className="flex items-center gap-4 rounded-2xl border-2 border-primary bg-white p-3.5 text-left text-primary">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-[#eef0f4]"><Upload className="h-7 w-7" aria-hidden="true" /></span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[19px] font-bold">{copy.file}</span>
          <span className="text-sm text-[#5b6170]">{copy.fileSub}</span>
        </span>
      </button>
    </>
  );
};
