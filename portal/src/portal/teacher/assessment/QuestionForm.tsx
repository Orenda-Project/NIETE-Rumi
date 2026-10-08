import type { ReactNode } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AddKind, EditFields } from '../../services/api';
import { FOCUS } from '../ui/styles';
import { ASSESSMENT } from './copy';
import { useCopy } from '../i18n';
import { showAnswerBox, showCorrect, type FormValues } from './editForm';

/**
 * bd-fmf24g.6 — the boxes for one question (v28 canvas AssessEditQuestion), in the v2 look: 56px+ fields,
 * the paper's own direction (an Urdu paper writes right to left). An existing question draws the boxes
 * its shape has (`fields`); a new one, the boxes its type's layout needs (`kind`). What they send is
 * ./editForm's.
 */

const BOX = 'w-full rounded-2xl border-[1.5px] border-[#d1d5db] bg-white px-3.5 py-3 text-[16px] leading-relaxed text-[#1d2025] focus:border-[#33374a] focus:outline-none';

function Field({ label, htmlFor, children }: { label: ReactNode; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="mx-1 mt-1 text-[15px] font-semibold text-[#374151]">{label}</label>
      {children}
    </div>
  );
}

function Text({ id, value, onChange, rows = 3, label }: { id?: string; value: string; onChange: (v: string) => void; rows?: number; label?: string }) {
  return <textarea id={id} aria-label={label} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={cn(BOX, 'min-h-[96px] resize-none')} />;
}

function Line({ id, value, onChange, label, numeric }: { id?: string; value: string; onChange: (v: string) => void; label?: string; numeric?: boolean }) {
  return (
    <input
      id={id}
      aria-label={label}
      value={value}
      inputMode={numeric ? 'numeric' : undefined}
      onChange={(e) => onChange(e.target.value)}
      className={cn(BOX, 'min-h-[56px]')}
    />
  );
}

function Tick({ on, onPress, label, round }: { on: boolean; onPress: () => void; label: string; round?: boolean }) {
  return (
    <button
      type="button"
      role={round ? 'radio' : 'checkbox'}
      aria-checked={on}
      aria-label={label}
      onClick={onPress}
      className={cn('flex h-14 w-14 shrink-0 items-center justify-center', FOCUS)}
    >
      <span className={cn('flex h-7 w-7 items-center justify-center border-2 text-white', round ? 'rounded-full' : 'rounded-[8px]', on ? 'border-[#2f7a52] bg-[#2f7a52]' : 'border-[#c7cad6] bg-white')}>
        {on && <Check className="h-4 w-4" strokeWidth={3.2} aria-hidden="true" />}
      </span>
    </button>
  );
}

export function QuestionForm({
  values, onChange, fields, kind, rtl, slotCap = 6,
}: {
  values: FormValues;
  onChange: (v: FormValues) => void;
  /** An existing question's boxes (its shape). */
  fields?: EditFields;
  /** A new question's type (its layout). */
  kind?: AddKind;
  rtl: boolean;
  slotCap?: number;
}) {
  const C = useCopy(ASSESSMENT);
  const set = (patch: Partial<FormValues>) => onChange({ ...values, ...patch });
  const shape = fields ? fields.shape : kind?.layout ?? 'standard';
  const tickOne = fields ? showCorrect(fields) : !!kind && kind.layout === 'options' && !kind.msq;
  const tickMany = !!kind && kind.layout === 'options' && !!kind.msq;
  const meanings = !!kind?.meanings && shape === 'words';
  const answerBox = fields
    ? (shape === 'standard' || shape === 'passage' || shape === 'words' || showAnswerBox(fields))
    : (shape === 'standard' || (shape === 'words' && !meanings));
  const optionalQuestion = !!kind && (shape === 'columns' || shape === 'words' || shape === 'comprehension');
  const setSlot = (i: number, v: string) => set({ slots: values.slots.map((s, j) => (j === i ? v : s)) });

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="flex flex-col gap-3">
      {(shape === 'passage' || shape === 'comprehension') && (
        <Field label={C.passage} htmlFor="aq-passage"><Text id="aq-passage" rows={5} value={values.passage} onChange={(v) => set({ passage: v })} /></Field>
      )}

      <Field label={optionalQuestion ? C.instruction : C.question} htmlFor="aq-question">
        <Text id="aq-question" value={values.question} onChange={(v) => set({ question: v })} />
      </Field>

      {shape === 'options' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mx-1 mb-1.5 text-[15px] font-semibold text-[#374151]">{C.options}</legend>
          {values.slots.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              {tickOne && <Tick round on={values.correct === String(i)} onPress={() => set({ correct: String(i) })} label={C.correctN(i + 1)} />}
              {tickMany && (
                <Tick
                  on={values.correctMany.includes(String(i))}
                  onPress={() => set({
                    correctMany: values.correctMany.includes(String(i))
                      ? values.correctMany.filter((x) => x !== String(i)) : [...values.correctMany, String(i)],
                  })}
                  label={C.correctN(i + 1)}
                />
              )}
              <div className="min-w-0 flex-1"><Line value={s} onChange={(v) => setSlot(i, v)} label={C.optionN(i + 1)} /></div>
            </div>
          ))}
        </fieldset>
      )}

      {shape === 'words' && !meanings && (
        <div className="flex flex-col gap-2">
          {values.slots.map((s, i) => <Line key={i} value={s} onChange={(v) => setSlot(i, v)} label={C.wordN(i + 1)} />)}
        </div>
      )}
      {meanings && (
        <div className="flex flex-col gap-2">
          {values.slots.map((s, i) => (
            <div key={i} className="flex gap-2">
              <div className="min-w-0 flex-1"><Line value={s} onChange={(v) => setSlot(i, v)} label={C.wordN(i + 1)} /></div>
              <div className="min-w-0 flex-1">
                <Line value={values.meanings[i] ?? ''} onChange={(v) => set({ meanings: values.meanings.map((m, j) => (j === i ? v : m)) })} label={C.meaningN(i + 1)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {shape === 'columns' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mx-1 mb-1.5 text-[15px] font-semibold text-[#374151]">{C.pairs}</legend>
          {values.pairs.map((p, i) => (
            <div key={i} className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Line value={p.left} onChange={(v) => set({ pairs: values.pairs.map((x, j) => (j === i ? { ...x, left: v } : x)) })} label={C.pairA(i + 1)} />
              </div>
              <div className="min-w-0 flex-1">
                <Line value={p.right} onChange={(v) => set({ pairs: values.pairs.map((x, j) => (j === i ? { ...x, right: v } : x)) })} label={C.pairB(i + 1)} />
              </div>
            </div>
          ))}
        </fieldset>
      )}

      {kind && shape === 'comprehension' && (
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mx-1 mb-1.5 text-[15px] font-semibold text-[#374151]">{C.parts}</legend>
          {values.subs.map((p, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-2xl border border-[#e5e7eb] bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold text-[#6b7280]">{C.partN(i + 1)}</span>
                {values.subs.length > 1 && (
                  <button type="button" aria-label={C.removePart(i + 1)} onClick={() => set({ subs: values.subs.filter((_, j) => j !== i) })}
                    className={cn('flex h-14 w-14 items-center justify-center text-[#6b7280]', FOCUS)}>
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                )}
              </div>
              <Line value={p.question} label={C.question} onChange={(v) => set({ subs: values.subs.map((x, j) => (j === i ? { ...x, question: v } : x)) })} />
              <Line value={p.answer} label={C.answer} onChange={(v) => set({ subs: values.subs.map((x, j) => (j === i ? { ...x, answer: v } : x)) })} />
              <Line numeric value={p.marks} label={C.marksLabel} onChange={(v) => set({ subs: values.subs.map((x, j) => (j === i ? { ...x, marks: v } : x)) })} />
            </div>
          ))}
          {values.subs.length < slotCap && (
            <button type="button" onClick={() => set({ subs: [...values.subs, { question: '', answer: '', marks: '' }] })}
              className={cn('flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-[#c7cad6] bg-white text-[16px] font-semibold text-[#33374a]', FOCUS)}>
              <Plus className="h-5 w-5" aria-hidden="true" />
              {C.addPart}
            </button>
          )}
        </fieldset>
      )}

      {answerBox && (
        <Field label={C.answer} htmlFor="aq-answer"><Text id="aq-answer" rows={2} value={values.answer} onChange={(v) => set({ answer: v })} /></Field>
      )}

      {!(kind && shape === 'comprehension') && (
        <div className="flex gap-3">
          <div className="w-32"><Field label={C.marksLabel} htmlFor="aq-marks"><Line id="aq-marks" numeric value={values.marks} onChange={(v) => set({ marks: v })} /></Field></div>
          {fields && fields.shape === 'standard' && fields.show_lines && (
            <div className="w-36">
              <Field label={C.lines} htmlFor="aq-lines">
                <select id="aq-lines" value={values.lines} onChange={(e) => set({ lines: e.target.value })} className={cn(BOX, 'min-h-[56px]')}>
                  {fields.lines_options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                </select>
              </Field>
            </div>
          )}
          {kind && shape === 'standard' && (
            <div className="w-32"><Field label={C.lines} htmlFor="aq-lines"><Line id="aq-lines" numeric value={values.lines} onChange={(v) => set({ lines: v })} /></Field></div>
          )}
        </div>
      )}
    </div>
  );
}
