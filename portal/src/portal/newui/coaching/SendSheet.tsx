import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Mic, Upload } from 'lucide-react';
import { acceptFor, checkFile } from '../../lib/coachingUpload';
import { COACHING_COPY } from '../copy';
import { Sheet } from '../Sheet';
import { List, Row } from '../List';
import { Chip } from '../Chip';
import { BottomButton } from '../BottomButton';

/**
 * bd-5rz1v.26 — "Send a lesson", the sheet behind Coaching's one button (today's SendLessonSheet,
 * rebuilt from the kit). Two big rows and Cancel:
 *
 *   Record live lecture   the mic in the recording red — the one place red means recording, not
 *                         an error (DESIGN.md). Only where the microphone can work (`canRecord`:
 *                         an app build older than MIC_APP_BUILD cannot).
 *   Upload recording      opens the phone's picker FROM THIS TAP: a picker opened later, on the
 *                         next page, can be refused for want of a fresh tap. A file that is not
 *                         a recording is refused here, before anything moves, in two words.
 *
 * The caller decides what each way does (Coaching hands the file to the record page).
 */
export function SendSheet({ open, canRecord, onRecord, onFile, onClose }: {
  open: boolean;
  canRecord: boolean;
  onRecord: () => void;
  /** Called only with a file that passed the recording rules. */
  onFile: (file: File) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<'wrong_type' | 'too_large' | null>(null);

  // A sheet opened again starts clean.
  useEffect(() => { if (open) setProblem(null); }, [open]);

  const chosen = (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    const p = checkFile(file, 'audio');
    if (p) { setProblem(p); return; }
    onFile(file);
  };

  return (
    <Sheet open={open} title={COACHING_COPY.send} onClose={onClose} testId="coaching-send-sheet">
      <List label={COACHING_COPY.send}>
        {canRecord ? (
          <Row title={COACHING_COPY.record} icon={Mic} tile="recording" onClick={onRecord} testId="coaching-send-record" />
        ) : null}
        <Row title={COACHING_COPY.upload} icon={Upload} onClick={() => input.current?.click()} testId="coaching-send-upload" />
      </List>
      <input
        ref={input}
        hidden
        type="file"
        data-testid="send-audio-input"
        accept={`${acceptFor('audio')},audio/*`}
        onChange={(e) => { chosen(e.target.files?.[0]); e.target.value = ''; }}
      />
      {problem ? (
        <div className="flex justify-center">
          <Chip tone="error" icon={CircleAlert}>{problem === 'too_large' ? COACHING_COPY.tooLarge : COACHING_COPY.notAudio}</Chip>
        </div>
      ) : null}
      <BottomButton tone="outline" onClick={onClose}>{COACHING_COPY.cancel}</BottomButton>
    </Sheet>
  );
}
