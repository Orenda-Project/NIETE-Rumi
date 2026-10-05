import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { EditFields } from '../../services/api';

type Props = {
  fields: EditFields; rtl: boolean; error: string | null; busy: boolean;
  onDone: (edit: Record<string, unknown>) => void; onCancel: () => void;
};

/**
 * The boxes for one question, pre-filled from the bot's fieldsFor(). It knows
 * which boxes a shape has — that is drawing, not a rule — and sends back exactly
 * the keys applyEdit reads. Whether the values are acceptable is the bot's call.
 */
const QuestionFields = ({ fields, rtl, error, busy, onDone, onCancel }: Props) => {
  const [question, setQuestion] = useState(fields.question);
  const [marks, setMarks] = useState(fields.marks);
  const [answer, setAnswer] = useState(fields.answer);
  const [lines, setLines] = useState(fields.lines);
  const [slots, setSlots] = useState<string[]>(fields.slots || []);
  const [correct, setCorrect] = useState(fields.correct ?? 'none');
  const [pairs, setPairs] = useState(fields.pairs || []);
  const [passage, setPassage] = useState(fields.passage ?? '');

  const done = () => {
    // question only when changed: the bot refuses '' and a passage parent often has none
    const edit: Record<string, unknown> = { marks };
    if (question !== fields.question) edit.question = question;
    if (fields.shape === 'options') {
      edit.slots = slots;
      if (fields.msq) edit.answer = answer; else edit.correct = correct;
    } else if (fields.shape === 'columns') {
      edit.pairs = pairs;
    } else if (fields.shape === 'words') {
      edit.slots = slots; edit.answer = answer;
    } else if (fields.shape === 'passage') {
      edit.passage = passage; edit.answer = answer;
    } else if (fields.shape === 'comprehension') {
      edit.passage = passage;
    } else {
      edit.answer = answer;
      if (fields.show_lines) { edit.lines = lines; edit.linesDefault = fields.lines_default; }
    }
    onDone(edit);
  };

  const slotBox = (label: string, i: number) => (
    <Input aria-label={label} value={slots[i] ?? ''} onChange={(e) => setSlots(slots.map((s, j) => (j === i ? e.target.value : s)))} />
  );

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} className="space-y-3">
      {(fields.shape === 'passage' || fields.shape === 'comprehension') && (
        <div><Label htmlFor="qf-passage">Passage</Label>
          <Textarea id="qf-passage" aria-label="Passage" value={passage} onChange={(e) => setPassage(e.target.value)} rows={5} /></div>
      )}
      <div><Label htmlFor="qf-question">Question</Label>
        <Textarea id="qf-question" aria-label="Question" value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} /></div>

      {fields.shape === 'options' && (
        <fieldset className="space-y-2">
          {slots.map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              {!fields.msq && (
                <input type="radio" name="qf-correct" aria-label={`Option ${i + 1} is correct`}
                  checked={correct === String(i)} onChange={() => setCorrect(String(i))} />
              )}
              {slotBox(`Option ${i + 1}`, i)}
            </div>
          ))}
        </fieldset>
      )}

      {fields.shape === 'words' && <div className="grid grid-cols-2 gap-2">{slots.map((_, i) => <div key={i}>{slotBox(`Word ${i + 1}`, i)}</div>)}</div>}

      {fields.shape === 'columns' && (
        <div className="space-y-2">
          {pairs.map((p, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <Input aria-label={`Pair ${i + 1} left`} value={p.left} onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)))} />
              <Input aria-label={`Pair ${i + 1} right`} value={p.right} onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)))} />
            </div>
          ))}
        </div>
      )}

      {(fields.shape === 'standard' || fields.shape === 'passage' || fields.shape === 'words' || (fields.shape === 'options' && fields.msq)) && (
        <div><Label htmlFor="qf-answer">Answer</Label>
          <Textarea id="qf-answer" aria-label="Answer" value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} /></div>
      )}

      <div className="flex gap-3">
        <div className="w-24"><Label htmlFor="qf-marks">Marks</Label>
          <Input id="qf-marks" aria-label="Marks" inputMode="numeric" value={marks} onChange={(e) => setMarks(e.target.value)} /></div>
        {fields.shape === 'standard' && fields.show_lines && (
          <div className="w-28"><Label htmlFor="qf-lines">Answer lines</Label>
            <select id="qf-lines" aria-label="Answer lines" className="h-10 w-full rounded-md border px-2" value={lines} onChange={(e) => setLines(e.target.value)}>
              {fields.lines_options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select></div>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2" dir="ltr">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={done} disabled={busy}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Done</Button>
      </div>
    </div>
  );
};

export default QuestionFields;
