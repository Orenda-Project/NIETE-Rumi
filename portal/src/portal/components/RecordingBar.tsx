import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useRecordingClock, type RecordingSession } from '../lib/recordingSession';
import { clockText } from '../lib/clockText';

/**
 * bd-5rz1v.10 — the bar that follows the teacher round the portal while her
 * lesson is recording (design: NIETE Portal Coaching v1 mockups, Change 2,
 * phones 2 and 3), and the small "Recording continues" chip used on the record
 * screen and in the lesson plan viewer.
 *
 *   ●  Recording · 12:34                      [ Return › ]
 *
 * No sentences (operator, 2026-10-03): teachers read labels, numbers and
 * buttons, not explanations. Dark so it reads as "something running", not as
 * page content. Phone: docked just above the bottom menu. Desktop: a compact
 * card in the bottom corner (bottom-left in Urdu). The whole bar is one button
 * (56px tall); Return opens the recording screen on the live session. Not shown
 * on that screen itself — PortalLayout decides.
 *
 * ALL of the bar's and the chip's look is in BAR_STYLE / CHIP_STYLE below, so a
 * restyle (the design system may change) is an edit to those two objects.
 */

export const BAR_STYLE = {
  /** Where it sits: above the phone menu, or in the desktop corner. */
  dock: 'fixed inset-x-0 z-40 px-2.5 md:inset-x-auto md:bottom-6 md:end-6 md:w-[360px] md:px-0',
  dockAboveMenu: 'bottom-[72px]',
  dockNoMenu: 'bottom-3',
  bar: 'flex min-h-[56px] w-full items-center gap-3 rounded-[14px] bg-[#1f2429] py-2 pe-2 ps-4 text-start text-white shadow-[0_6px_16px_rgba(0,0,0,0.22)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#ffd54f]',
  dotLive: 'h-3 w-3 shrink-0 rounded-full bg-[#e53935] motion-safe:animate-pulse',
  dotPaused: 'h-3 w-3 shrink-0 rounded-sm bg-[#9aa0aa]',
  label: 'min-w-0 flex-1 truncate text-[17px] font-bold tabular-nums',
  labelWarn: 'text-[#ffd27a]',
  ret: 'inline-flex h-10 shrink-0 items-center gap-0.5 rounded-full bg-[#9be3bd] pe-2.5 ps-4 text-[16px] font-bold text-[#1f2429]',
};

export const CHIP_STYLE = {
  chip: 'inline-flex items-center gap-1.5 rounded-full bg-[#fdecea] px-3 py-1 text-[13px] font-semibold text-[#c62828]',
  dot: 'h-2 w-2 shrink-0 rounded-full bg-[#e53935] motion-safe:animate-pulse',
};

const COPY = {
  recording: 'Recording',
  paused: 'Paused',
  ret: 'Return',
  continues: 'Recording continues',
};

/** "● Recording continues" — said, not explained, wherever she leaves the record screen. */
export const RecordingContinuesChip = () => (
  <span className={CHIP_STYLE.chip}>
    <span aria-hidden="true" className={CHIP_STYLE.dot} />
    {COPY.continues}
  </span>
);

const RecordingBar = ({ session, aboveMenu = true }: { session: RecordingSession; aboveMenu?: boolean }) => {
  const navigate = useNavigate();
  const ms = useRecordingClock(session);

  return (
    <div className={`${BAR_STYLE.dock} ${aboveMenu ? BAR_STYLE.dockAboveMenu : BAR_STYLE.dockNoMenu}`}>
      <button
        type="button"
        data-testid="recording-bar"
        onClick={() => { if (session.returnTo) navigate(session.returnTo); }}
        className={BAR_STYLE.bar}
      >
        <span aria-hidden="true" className={session.paused ? BAR_STYLE.dotPaused : BAR_STYLE.dotLive} />
        {/* The screen went off while recording: the time turns amber, the record screen says why. */}
        <span className={`${BAR_STYLE.label} ${session.screenWentOff ? BAR_STYLE.labelWarn : ''}`}>
          {session.paused ? COPY.paused : COPY.recording} · {clockText(ms)}
        </span>
        <span className={BAR_STYLE.ret}>
          {COPY.ret}
          <ChevronRight className="h-5 w-5 rtl:rotate-180" strokeWidth={2.6} aria-hidden="true" />
        </span>
      </button>
    </div>
  );
};

export default RecordingBar;
