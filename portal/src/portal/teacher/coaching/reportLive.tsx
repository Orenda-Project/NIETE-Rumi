import { Mic, Send, Square, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AudioPlayer } from '../../newui/AudioPlayer';
import { VoiceNote } from '../ui';
import { CARD, FOCUS } from '../ui/styles';
import { useCopy } from '../i18n';
import { COACHING } from './copy';
import { SectionHeading } from './parts';
import type { DcReport } from './useDcReport';

/**
 * The one question of a DC observation and her answer, shared by the report page (ReportPage) and the one screen
 * (NewObservation); its state is useDcReport's.
 *
 *   <Reflection>      the question (the Digital Coach's voice note, its words only when it could not be voiced) and her
 *                     answer box: a mic where Send is while the box is empty; then what the coach said back.
 */

/** The one question and her answer, then what the coach said back (until the report is ready). */
export function Reflection({ r }: { r: DcReport }) {
  const C = useCopy(COACHING);
  const { asked, askedAudio, voice, clipUrl, answer, setAnswer, sending, sent, sentAudio, sendError, ready } = r;
  return (
    <>
      {asked ? (
        <>
          <SectionHeading>{C.stepReflection}</SectionHeading>
          <section aria-label={C.stepReflection} className="flex flex-col gap-3 overflow-hidden rounded-[18px] border border-[#e5e7eb] bg-[#eceef1] p-2.5">
            {/* bd-czmyoh — ICT feedback row 6: the question comes as the Digital Coach's voice note, as on WhatsApp;
                the words show only when it could not be voiced (WhatsApp's own fallback). */}
            {askedAudio ? (
              <VoiceNote from={C.title} avatar="dc" duration="" time="" src={askedAudio} copy={C.audio} className="max-w-[320px]" />
            ) : (
              <div className="max-w-[290px] rounded-[18px] rounded-es-md border border-[#e5e7eb] bg-white px-3.5 pb-2 pt-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
                <div className="mb-1 text-[12px] font-bold text-[#c2410c]">{C.title}</div>
                <p className="m-0 text-[17px] font-medium leading-[1.5]">{asked.question}</p>
              </div>
            )}
            {voice.state === 'recording' ? (
              <div className="flex items-center gap-3 bg-white p-2.5">
                <span className="h-3 w-3 shrink-0 rounded-full bg-[#c8331f] motion-safe:animate-pulse" aria-hidden="true" />
                <span className="flex-1 text-[16px] font-semibold">{C.recording}</span>
                <span className="text-[16px] tabular-nums text-[#6b7280]" dir="ltr">{clock(voice.elapsedMs)}</span>
                <button
                  type="button"
                  aria-label={C.stop}
                  onClick={voice.stop}
                  className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#c8331f] text-white', FOCUS)}
                >
                  <Square className="h-[20px] w-[20px] fill-current" aria-hidden="true" />
                </button>
              </div>
            ) : voice.state === 'recorded' && clipUrl ? (
              <div className="flex items-center gap-2 bg-white p-2.5">
                <div className="min-w-0 flex-1"><AudioPlayer src={clipUrl} label={C.yourAnswer} copy={C.audio} /></div>
                <button
                  type="button"
                  aria-label={C.removeRecording}
                  disabled={sending}
                  onClick={voice.discard}
                  className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#e5e7eb] bg-white text-[#33374a] disabled:text-[#9ca3af]', FOCUS)}
                >
                  <Trash2 className="h-[22px] w-[22px]" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={C.send}
                  disabled={sending}
                  onClick={() => { void r.sendVoice(); }}
                  className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#33374a] text-white disabled:bg-[#d1d5db] disabled:text-[#6b7280]', FOCUS)}
                >
                  <Send className="h-[22px] w-[22px] rtl:-scale-x-100" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="flex items-end gap-2 bg-white p-2.5">
                {/* bd-phk3v4 — dir=auto: the cursor starts on the left, and Urdu she types runs right to left (row 8). */}
                <textarea
                  dir="auto"
                  aria-label={C.yourAnswer}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={2}
                  className={cn('min-h-14 flex-1 resize-none rounded-[22px] border-[1.5px] border-[#d1d5db] px-4 py-3 text-[16px]', FOCUS)}
                />
                {voice.available && !answer.trim() ? (
                  <button
                    type="button"
                    aria-label={C.recordAnswer}
                    onClick={() => { void voice.start(); }}
                    className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#33374a] text-white', FOCUS)}
                  >
                    <Mic className="h-[22px] w-[22px]" aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={C.send}
                    disabled={sending || !answer.trim()}
                    onClick={() => { void r.sendAnswer(); }}
                    className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#33374a] text-white disabled:bg-[#d1d5db] disabled:text-[#6b7280]', FOCUS)}
                  >
                    <Send className="h-[22px] w-[22px] rtl:-scale-x-100" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
            {voice.state === 'blocked' ? <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{C.micBlocked}</p> : null}
            {sendError ? <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{C.couldNotSend}</p> : null}
          </section>
        </>
      ) : null}

      {sent && !ready ? (
        sentAudio ? (
          <section aria-live="polite">
            <VoiceNote from={C.title} avatar="dc" duration="" time="" src={sentAudio} copy={C.audio} className="max-w-[320px]" />
          </section>
        ) : (
          <section aria-live="polite" className={cn(CARD, 'px-4 py-3 text-[15px] leading-[1.45]')}>{sent}</section>
        )
      ) : null}
    </>
  );
}

/** m:ss for the recording's running clock (bd-eygg2f). */
function clock(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
