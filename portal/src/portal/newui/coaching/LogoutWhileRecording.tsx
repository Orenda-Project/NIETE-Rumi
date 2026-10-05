import { useEffect, useState } from 'react';
import { LogOut, Mic, Pause } from 'lucide-react';
import { clockText } from '../../lib/clockText';
import { COACHING_COPY } from '../copy';
import { Sheet } from '../Sheet';
import { Chip } from '../Chip';
import { BottomButton } from '../BottomButton';

/**
 * bd-5rz1v.26.4 — "Stop recording?" in the kit: what Logout asks while a lesson records, with
 * portal_new_ui on (bd-5rz1v.10 asked it first, in the old look, PR #1524).
 *
 *   Stop recording?              the Sheet's title
 *   ● Recording   12:34          the red Recording chip (amber Paused when paused) and the time,
 *                                still running while she decides
 *   [ Keep recording ]           primary green: nothing changes, she stays signed in
 *   [ Stop & log out ]           the outline button with red words: the lesson is finished and
 *                                KEPT on the phone (Coaching offers it under Continue after she
 *                                signs in again), then logout
 *
 * Close, Escape, Android Back and a tap on the dim are Keep recording. The session owns the
 * question (lib/recordingSession, askBeforeLogout) and renders this; anything that logs out asks
 * through useLogoutGuard or newui/useGuardedLogout. It reads the session through props, not the
 * session's own hooks, so the session can render it without importing itself back.
 */
export interface LogoutWhileRecordingProps {
  open: boolean;
  paused: boolean;
  /** The time recorded so far, now (the session's elapsedMs). */
  elapsedMs: () => number;
  onKeep: () => void;
  onStop: () => void;
}

export function LogoutWhileRecording({ open, paused, elapsedMs, onKeep, onStop }: LogoutWhileRecordingProps) {
  const [ms, setMs] = useState(() => elapsedMs());

  useEffect(() => {
    if (!open) return undefined;
    setMs(elapsedMs());
    if (paused) return undefined;
    const tick = setInterval(() => setMs(elapsedMs()), 500);
    return () => clearInterval(tick);
  }, [open, paused, elapsedMs]);

  return (
    <Sheet open={open} title={COACHING_COPY.stopRecordingTitle} onClose={onKeep} testId="recording-logout-sheet">
      <div className="flex flex-col items-center gap-2 py-2">
        {paused
          ? <Chip tone="waiting" icon={Pause}>{COACHING_COPY.paused}</Chip>
          : <Chip tone="recording">{COACHING_COPY.recording}</Chip>}
        <div
          data-testid="recording-logout-clock"
          aria-live="off"
          className="text-[40px] font-extrabold leading-none tabular-nums text-nu-surface-text"
        >
          {clockText(ms)}
        </div>
      </div>
      <BottomButton icon={Mic} onClick={onKeep}>{COACHING_COPY.keepRecording}</BottomButton>
      <BottomButton tone="dangerOutline" icon={LogOut} iconFlips onClick={onStop}>{COACHING_COPY.stopAndLogout}</BottomButton>
    </Sheet>
  );
}
