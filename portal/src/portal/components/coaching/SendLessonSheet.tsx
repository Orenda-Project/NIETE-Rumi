import { useRef, useState } from 'react';
import { AlertTriangle, Upload } from 'lucide-react';
import BottomSheet from './BottomSheet';
import RecordIcon from './RecordIcon';
import { acceptFor, checkFile } from '../../lib/coachingUpload';

/**
 * bd-5rz1v.7 — the "Send a lesson" sheet behind SendLessonButton: the two ways
 * to send a lesson, one tap each.
 *
 *   Record Live Lecture   red; only where the microphone can work (canRecord)
 *   Upload Recording      the phone's own picker, opened from this tap — a
 *                         picker opened later, on the next page, can be refused
 *                         for want of a fresh tap. A file that is not a
 *                         recording is refused here, before anything moves.
 *
 * Shared by the teacher's Coaching page and the coach's Observations page; the
 * caller decides what each way does.
 */

const SEND_SHEET_COPY = {
  title: 'Send a lesson',
  record: 'Record Live Lecture',
  recordSub: 'Start when your class starts',
  upload: 'Upload Recording',
  uploadSub: 'One already on your phone',
  cancel: 'Cancel',
  notAudio: 'That is not a recording. Choose a sound file from your phone.',
  tooLarge: 'That recording is too large to send.',
};

const SendLessonSheet = ({ canRecord, onRecord, onFile, onClose, copy = {} }: {
  canRecord: boolean;
  onRecord: () => void;
  /** Called only with a file that passed the recording rules. */
  onFile: (file: File) => void;
  onClose: () => void;
  copy?: Partial<typeof SEND_SHEET_COPY>;
}) => {
  const c = { ...SEND_SHEET_COPY, ...copy };
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const problem = checkFile(file, 'audio');
    if (problem) { setError(problem === 'too_large' ? c.tooLarge : c.notAudio); return; }
    onFile(file);
  };

  return (
    <BottomSheet label={c.title} onClose={onClose}>
      <div className="text-[22px] font-bold">{c.title}</div>
      {canRecord && (
        <button type="button" onClick={onRecord}
          className="flex items-center gap-3.5 rounded-2xl border-[3px] border-[#d32f2f] bg-[#d32f2f] p-3.5 text-left text-white">
          <RecordIcon size={56} onRed />
          <span className="flex flex-col">
            <span className="text-[19px] font-bold">{c.record}</span>
            <span className="text-sm text-[#fde3e1]">{c.recordSub}</span>
          </span>
        </button>
      )}
      <button type="button" onClick={() => input.current?.click()}
        className="flex items-center gap-3.5 rounded-2xl border-2 border-primary bg-white p-3.5 text-left text-primary">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-[#eef0f4]">
          <Upload className="h-[26px] w-[26px]" aria-hidden="true" />
        </span>
        <span className="flex flex-col">
          <span className="text-[19px] font-bold">{c.upload}</span>
          <span className="text-sm text-[#5b6170]">{c.uploadSub}</span>
        </span>
      </button>
      <input ref={input} data-testid="send-audio-input" type="file" accept={`${acceptFor('audio')},audio/*`} className="hidden"
        onChange={(e) => { chosen(e.target.files?.[0]); e.target.value = ''; }} />
      {error && (
        <div className="flex gap-2.5 rounded-xl bg-[#fff6e0] px-3.5 py-3 text-[15px] leading-snug text-[#7a5600]">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      <button type="button" onClick={onClose}
        className="h-12 rounded-xl border border-[#d6d9de] bg-white text-[17px] font-semibold text-[#5b6170]">{c.cancel}</button>
    </BottomSheet>
  );
};

export default SendLessonSheet;
