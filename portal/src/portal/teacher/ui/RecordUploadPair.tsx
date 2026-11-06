import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
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
  className?: string;
}

export function RecordUploadPair({ recordTo, onRecord, uploadTo, onUpload, actions, copy, compact = false, className }: RecordUploadPairProps) {
  const words = { ...useKitCopy(), ...copy };
  const art = compact ? 'h-11 w-11' : 'h-[84px] w-[84px]';
  return (
    <PairBox compact={compact} className={className}>
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
