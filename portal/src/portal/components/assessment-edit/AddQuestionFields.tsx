import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { AddKind } from '../../services/api';

type Props = {
  kind: AddKind; slotCap: number; rtl: boolean; error: string | null; busy: boolean;
  onDone: (edit: Record<string, unknown>) => void; onCancel: () => void;
};
type Pair = { left: string; right: string };
type Sub = { question: string; answer: string; marks: string };

const SLOTS = 6;

/**
 * The boxes for a NEW question of one catalogue type. It draws the boxes the
 * type's layout needs and sends back exactly the keys the bot's buildAdded reads,
 * as typed (the bot trims, defaults blank marks/lines, and refuses what is wrong).
 */
const AddQuestionFields = ({ kind, slotCap, rtl, error, busy, onDone, onCancel }: Props) => {
  const layout = kind.layout;
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [marks, setMarks] = useState('');
  const [lines, setLines] = useState('');
  const [slots, setSlots] = useState<string[]>(() => Array.from({ length: SLOTS }, (_, i) => kind.presetOptions?.[i] ?? ''));
  const [meanings, setMeanings] = useState<string[]>(() => Array.from({ length: SLOTS }, () => ''));
  const [correct, setCorrect] = useState('');
  const [correctMany, setCorrectMany] = useState<string[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([{ left: '', right: '' }, { left: '', right: '' }]);
  const [passage, setPassage] = useState('');
  const [subs, setSubs] = useState<Sub[]>([{ question: '', answer: '', marks: '' }]);

  const done = () => {
    const edit: Record<string, unknown> = { question };
    if (layout === 'standard') { edit.answer = answer; edit.marks = marks; edit.lines = lines; }
    else {
      if (layout === 'options') {
        edit.slots = slots;
        if (kind.msq) edit.correctMany = correctMany; else edit.correct = correct;
      } else if (layout === 'columns') edit.pairs = pairs;
      else if (layout === 'words') {
        edit.slots = slots;
        if (kind.meanings) edit.meanings = meanings; else edit.answer = answer;
      }
      else { edit.passage = passage; edit.subs = subs; }
      if (layout !== 'comprehension') edit.marks = marks;
    }
    onDone(edit);
  };

  const setSlot = (i: number, v: string) => setSlots(slots.map((s, j) => (j === i ? v : s)));
  const setMeaning = (i: number, v: string) => setMeanings(meanings.map((s, j) => (j === i ? v : s)));
  const setPair = (i: number, k: keyof Pair, v: string) => setPairs(pairs.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const setSub = (i: number, k: keyof Sub, v: string) => setSubs(subs.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const toggleMany = (i: string) => setCorrectMany(correctMany.includes(i) ? correctMany.filter((x) => x !== i) : [...correctMany, i]);

  const optional = layout === 'columns' || layout === 'words' || layout === 'comprehension';

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="space-y-3">
      <div><Label>{optional ? 'Instruction (optional)' : 'Question'}</Label>
        <Textarea aria-label="Question" value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} /></div>

      {layout === 'comprehension' && (
        <div><Label>Passage</Label>
          <Textarea aria-label="Passage" value={passage} onChange={(e) => setPassage(e.target.value)} rows={5} /></div>
      )}

      {layout === 'options' && (
        <fieldset className="space-y-2">
          {slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              {kind.msq
                ? <input type="checkbox" aria-label={`Option ${i + 1} is correct`} checked={correctMany.includes(String(i))} onChange={() => toggleMany(String(i))} />
                : <input type="radio" name="aq-correct" aria-label={`Option ${i + 1} is correct`} checked={correct === String(i)} onChange={() => setCorrect(String(i))} />}
              <Input aria-label={`Option ${i + 1}`} value={s} onChange={(e) => setSlot(i, e.target.value)} />
            </div>
          ))}
        </fieldset>
      )}

      {layout === 'words' && kind.meanings && (
        <div className="space-y-2">
          {slots.map((s, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <Input aria-label={`Word ${i + 1}`} placeholder="Word" value={s} onChange={(e) => setSlot(i, e.target.value)} />
              <Input aria-label={`Meaning ${i + 1}`} placeholder="Meaning" value={meanings[i]} onChange={(e) => setMeaning(i, e.target.value)} />
            </div>
          ))}
        </div>
      )}

      {layout === 'words' && !kind.meanings && (
        <div className="grid grid-cols-2 gap-2">
          {slots.map((s, i) => <Input key={i} aria-label={`Word ${i + 1}`} value={s} onChange={(e) => setSlot(i, e.target.value)} />)}
        </div>
      )}

      {layout === 'columns' && (
        <div className="space-y-2">
          {pairs.map((p, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <Input aria-label={`Pair ${i + 1} left`} value={p.left} onChange={(e) => setPair(i, 'left', e.target.value)} />
              <Input aria-label={`Pair ${i + 1} right`} value={p.right} onChange={(e) => setPair(i, 'right', e.target.value)} />
            </div>
          ))}
          {pairs.length < slotCap && (
            <Button type="button" size="sm" variant="outline" onClick={() => setPairs([...pairs, { left: '', right: '' }])}>Add pair</Button>
          )}
        </div>
      )}

      {layout === 'comprehension' && (
        <div className="space-y-3">
          {subs.map((s, i) => (
            <div key={i} className="space-y-2 rounded-md border p-2">
              <Input aria-label={`Part ${i + 1} question`} placeholder={`Part ${i + 1} question`} value={s.question} onChange={(e) => setSub(i, 'question', e.target.value)} />
              <Input aria-label={`Part ${i + 1} answer`} placeholder="Answer" value={s.answer} onChange={(e) => setSub(i, 'answer', e.target.value)} />
              <div className="flex items-center gap-2">
                <Input className="w-24" aria-label={`Part ${i + 1} marks`} placeholder="1" inputMode="numeric" value={s.marks} onChange={(e) => setSub(i, 'marks', e.target.value)} />
                {subs.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" aria-label="Remove part" onClick={() => setSubs(subs.filter((_, j) => j !== i))}>Remove part</Button>
                )}
              </div>
            </div>
          ))}
          {subs.length < slotCap && (
            <Button type="button" size="sm" variant="outline" onClick={() => setSubs([...subs, { question: '', answer: '', marks: '' }])}>Add part</Button>
          )}
        </div>
      )}

      {(layout === 'standard' || (layout === 'words' && !kind.meanings)) && (
        <div><Label>{layout === 'words' ? 'Answer (optional)' : 'Answer'}</Label>
          <Textarea aria-label="Answer" value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} /></div>
      )}

      {layout !== 'comprehension' && (
        <div className="flex gap-3">
          <div className="w-24"><Label>Marks</Label>
            <Input aria-label="Marks" inputMode="numeric" placeholder={String(kind.marks)} value={marks} onChange={(e) => setMarks(e.target.value)} /></div>
          {layout === 'standard' && (
            <div className="w-28"><Label>Answer lines</Label>
              <Input aria-label="Answer lines" inputMode="numeric" placeholder={String(kind.lines)} value={lines} onChange={(e) => setLines(e.target.value)} /></div>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2" dir="ltr">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={done} disabled={busy}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Done</Button>
      </div>
    </div>
  );
};

export default AddQuestionFields;
