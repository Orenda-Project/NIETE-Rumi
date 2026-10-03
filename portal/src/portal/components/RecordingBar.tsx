import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useRecordingClock, type RecordingSession } from '../lib/recordingSession';
import { clockText } from '../lib/clockText';

/**
 * bd-5rz1v.10 — the bar that follows the teacher round the portal while her
 * lesson is recording (design: NIETE Portal Coaching v1 mockups, Change 2,
 * phones 2 and 3).
 *
 *   ● Recording · 12:34                    Return ›
 *     Your lesson is still recording
 *
 * Dark (#1f2429) so it reads as "something running", not as page content.
 * Phone: docked just above the bottom menu. Desktop: a compact card in the
 * bottom corner (bottom-right; bottom-left in Urdu). The whole bar is one
 * button (56px tall), and Return opens the recording screen on the live
 * session. Not shown on that screen itself — PortalLayout decides.
 */

const COPY = {
  recording: 'Recording',
  paused: 'Paused',
  still: 'Your lesson is still recording',
  pausedSub: 'Your lesson is paused',
  wentOff: 'The screen went off. Part may be silent.',
  ret: 'Return',
};

const RecordingBar = ({ session, aboveMenu = true }: { session: RecordingSession; aboveMenu?: boolean }) => {
  const navigate = useNavigate();
  const ms = useRecordingClock(session);
  const sub = session.screenWentOff ? COPY.wentOff : session.paused ? COPY.pausedSub : COPY.still;

  return (
    <div
      className={`fixed inset-x-0 z-40 px-2.5 md:inset-x-auto md:bottom-6 md:end-6 md:w-[380px] md:px-0 ${aboveMenu ? 'bottom-[72px]' : 'bottom-3'}`}
    >
      <button
        type="button"
        data-testid="recording-bar"
        onClick={() => { if (session.returnTo) navigate(session.returnTo); }}
        className="flex min-h-[56px] w-full items-center gap-3 rounded-[14px] bg-[#1f2429] py-2.5 pe-3 ps-3.5 text-start text-white shadow-[0_6px_16px_rgba(0,0,0,0.22)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#ffd54f]"
      >
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 shrink-0 ${session.paused ? 'rounded-sm bg-[#9aa0aa]' : 'rounded-full bg-[#e53935] motion-safe:animate-pulse'}`}
        />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="text-[15px] font-bold tabular-nums">
            {session.paused ? COPY.paused : COPY.recording} · {clockText(ms)}
          </span>
          <span className={`truncate text-[13px] ${session.screenWentOff ? 'text-[#ffd27a]' : 'text-[#c9d1d9]'}`}>{sub}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[15px] font-bold text-[#9be3bd]">
          {COPY.ret}
          <ChevronRight className="h-4 w-4 rtl:rotate-180" strokeWidth={2.6} aria-hidden="true" />
        </span>
      </button>
    </div>
  );
};

export default RecordingBar;
