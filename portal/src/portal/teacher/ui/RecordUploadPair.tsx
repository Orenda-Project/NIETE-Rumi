import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TeacherUiCopy } from './copy';
import { FOCUS, GRID } from './styles';
import { PairBox, PairSquare as Square, PLAIN_SQUARE, discClass } from './ChoicePair';
import { useKitCopy } from './useKitCopy';
import './recordPair.css';

/**
 * bd-4404s7.1 — RecordUploadPair: the two ways to give a recording, side by side in ONE box with no heading (the coach's Visit
 * and Debrief; the teacher's lesson viewer squares). Two 176px squares: Start recording (indigo, a beating red mark with two
 * spreading rings) and Upload recording (white, an upload icon on a grey disc). A `…To` makes a square a link, an `on…` a button.
 * `actions` are small 52px buttons under them (Reschedule; Cancel visit in red): colour is not the only signal, the words are.
 * The mark moves only when the phone allows motion. Canvas: Coach_Visit. Its squares and box are ChoicePair's (bd-rlxkkt.6).
 *
 * bd-ma9jiy.3 (queue #262; the operator 26 Nov ~11:10: "Since there is already a pending recording, the start recording
 * and upload recording should not be there. Instead, there should be the Continue recording button that looks similar to
 * the Start recording button but with a paused icon. With a text on top: Your recording was paused abruptly.") — `paused`:
 * a recording this phone kept, cut mid-way. The pair is then that line and ONE wide Continue recording square, Start
 * recording's indigo with a still red disc holding a pause mark; `actions` stay under it.
 */
export interface PairAction {
  key: string;
  label: string;
  icon?: ReactNode;
  to?: string;
  onPress?: () => void;
  danger?: boolean;
}

export interface RecordUploadPairProps {
  recordTo?: string;
  onRecord?: () => void;
  uploadTo?: string;
  onUpload?: () => void;
  actions?: readonly PairAction[];
  copy?: Partial<Pick<TeacherUiCopy, 'startRecording' | 'uploadRecording'>>;
  /** Two 88px buttons with the 44px art beside the words (a screen where more steps follow: Digital Coaching's one screen). */
  compact?: boolean;
  /** bd-ma9jiy.3 — a kept recording cut mid-way: only its line and Continue recording (a link or a button). */
  paused?: { to?: string; onPress?: () => void; testId?: string; /** bd-ma9jiy: which recording (its class, its time). */ label?: string };
  className?: string;
}

export function RecordUploadPair({ recordTo, onRecord, uploadTo, onUpload, actions, copy, compact = false, paused, className }: RecordUploadPairProps) {
  const words = { ...useKitCopy(), ...copy };
  const art = compact ? 'h-11 w-11' : 'h-[84px] w-[84px]';
  return (
    <PairBox compact={compact} className={className}>
      {paused ? (
        <>
          <p data-testid="paused-line" className="m-0 text-center text-[16px] font-semibold leading-snug text-[#b45309]">{words.pausedAbruptly}</p>
          {paused.label ? <p data-testid="paused-label" className="m-0 -mt-1 text-center text-[15px] leading-snug text-[#4b5563]">{paused.label}</p> : null}
          <div className={cn(GRID, 'grid-cols-1')}>
            <Square to={paused.to} onPress={paused.onPress} name={words.continueRecording} compact={compact} testId={paused.testId ?? 'continue-kept'} className="bg-[#33374a] text-white">
              <span aria-hidden="true" className={cn('relative flex shrink-0 items-center justify-center', art)}>
                <i className={cn('absolute rounded-full border-[2.5px] border-[rgba(255,77,61,0.6)]', compact ? 'inset-1.5' : 'inset-2.5')} />
                <span className={cn('flex items-center justify-center rounded-full bg-[#ff4d3d]', compact ? 'h-7 w-7' : 'h-12 w-12')}>
                  <Pause className={cn('fill-current text-white', compact ? 'h-4 w-4' : 'h-6 w-6')} strokeWidth={2.4} />
                </span>
              </span>
              <span aria-hidden="true">{words.continueRecording}</span>
            </Square>
          </div>
        </>
      ) : (
      <div className={cn(GRID, 'grid-cols-2 gap-3')}>
        <Square to={recordTo} onPress={onRecord} name={words.startRecording} compact={compact} className="bg-[#33374a] text-white">
          <span aria-hidden="true" className={cn('relative flex shrink-0 items-center justify-center', art)}>
            <i className={cn('rup-ring absolute rounded-full border-[2.5px] border-[rgba(255,77,61,0.6)]', compact ? 'inset-1.5' : 'inset-2.5')} />
            <i className={cn('rup-ring rup-ring2 absolute rounded-full border-[2.5px] border-[rgba(255,77,61,0.6)]', compact ? 'inset-1.5' : 'inset-2.5')} />
            <i className={cn('rup-core rounded-full bg-[#ff4d3d]', compact ? 'h-4 w-4 shadow-[0_0_0_4px_rgba(255,77,61,0.25)]' : 'h-8 w-8 shadow-[0_0_0_8px_rgba(255,77,61,0.25)]')} />
          </span>
          <span aria-hidden="true">{words.startRecording}</span>
        </Square>
        <Square to={uploadTo} onPress={onUpload} name={words.uploadRecording} compact={compact} className={PLAIN_SQUARE}>
          <span aria-hidden="true" className={discClass(compact)}>
            <Upload className={compact ? 'h-5 w-5' : 'h-8 w-8'} strokeWidth={2.2} />
          </span>
          <span aria-hidden="true">{words.uploadRecording}</span>
        </Square>
      </div>
      )}
      {actions && actions.length ? (
        <div className="flex gap-2.5">
          {actions.map((a) => {
            const cls = cn(
              'flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-2xl border border-[#e5e7eb] bg-white text-[15px] font-semibold',
              a.danger ? 'text-[#c8331f]' : 'text-[#1d2025]',
              FOCUS,
            );
            return a.to
              ? <Link key={a.key} to={a.to} className={cls}>{a.icon}{a.label}</Link>
              : <button key={a.key} type="button" onClick={a.onPress} className={cls}>{a.icon}{a.label}</button>;
          })}
        </div>
      ) : null}
    </PairBox>
  );
}
