import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { ChildTestBlockStatus, ChildTestCard } from "../../types/childTest";
import type { ChildTestCopy } from "../../lib/childTest/copy";
import { draftFrom, missingFields, toCoachMarks, type Draft, type DraftItem } from "../../lib/childTest/checkDraft";

/**
 * bd-s1oo0.7 — the check, as on WhatsApp but as a web form: "What Rumi heard".
 * Counts pre-filled, words Rumi heard wrong as ticked chips, verdicts as three
 * buttons; anything Rumi was not sure of is EMPTY with Rumi's guess shown as a
 * hint. Nothing saves until every item has an answer. The AI's marks are never
 * changed — the coach's are stored next to them (the bot lists every change).
 */

type Props = {
  card: ChildTestCard;
  status: ChildTestBlockStatus;
  copy: ChildTestCopy;
  onSubmit: (coachMarks: Record<string, unknown>) => Promise<void>;
};

const VERDICTS: { value: string; key: "correct" | "wrong" | "noAnswer" }[] = [
  { value: "correct", key: "correct" },
  { value: "wrong", key: "wrong" },
  { value: "none", key: "noAnswer" },
];

function hintText(copy: ChildTestCopy, hint: string | null) {
  if (!hint) return null;
  const words: Record<string, string> = { correct: copy.correct, wrong: copy.wrong, none: copy.noAnswer, blank: copy.noAnswer };
  return copy.rumiThinks(words[hint] || hint);
}

function VerdictRow({ item, copy, dir, missing, onPick, blankWord }: {
  item: DraftItem; copy: ChildTestCopy; dir: "rtl" | "ltr"; missing: boolean; onPick: (v: string) => void; blankWord?: string;
}) {
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${missing || item.unsure ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"}`} data-testid={`verdict-${item.id}`}>
      <p dir={dir} className="text-lg text-slate-900">{item.label}</p>
      {item.unsure && <p className="text-xs font-medium text-amber-800" data-testid={`unsure-${item.id}`}>{copy.rumiUnsure}</p>}
      {item.hint && <p className="text-xs text-slate-500">{hintText(copy, item.hint)}</p>}
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={item.label}>
        {VERDICTS.map((v) => {
          const value = blankWord && v.value === "none" ? blankWord : v.value;
          const on = item.verdict === value;
          return (
            <button
              key={v.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(value)}
              className={`rounded-lg py-2 text-base border ${on ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-800 border-slate-300"}`}
            >
              {copy[v.key]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, missing, testId, note }: { label: string; value: number | null; onChange: (n: number | null) => void; missing: boolean; testId: string; note?: string | null }) {
  return (
    <label className={`block rounded-xl border p-3 ${missing || note ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <span className="block text-sm text-slate-600 mb-1">{label}</span>
      {note && <span className="block text-xs font-medium text-amber-800 mb-1" data-testid={`${testId}-unsure`}>{note}</span>}
      <input
        data-testid={testId}
        type="number"
        inputMode="numeric"
        min={0}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))))}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-3xl font-semibold tabular-nums"
      />
    </label>
  );
}

export default function CheckForm({ card, status, copy, onSubmit }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(status.prefill, card));
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = useMemo(() => new Set(missingFields(draft)), [draft]);
  const dir = card.block === "urdu" ? "rtl" : "ltr";

  const update = (fn: (d: Draft) => void) => setDraft((d) => {
    const next = structuredCloneSafe(d);
    fn(next);
    return next;
  });

  const pick = (section: keyof Draft["items"], id: string) => (v: string) =>
    update((d) => { const it = d.items[section].find((x) => x.id === id); if (it) it.verdict = v; });

  const save = async () => {
    setTried(true);
    setError(null);
    if (missing.size > 0) {
      setError(copy.fillAll);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(toCoachMarks(draft));
    } catch {
      setError(copy.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const section = (title: string, key: keyof Draft["items"], blankWord?: string) => (draft.items[key].length > 0 ? (
    <div className="space-y-2">
      <h4 className="font-semibold text-slate-800">{title}</h4>
      {draft.items[key].map((it) => (
        <VerdictRow key={it.id} item={it} copy={copy} dir={key === "numbers" || key === "written" ? "ltr" : dir}
          missing={tried && missing.has(`${key}.${it.id}`)} onPick={pick(key, it.id)} blankWord={blankWord} />
      ))}
    </div>
  ) : null);

  return (
    <div className="space-y-5" data-testid={`check-${card.block}`}>
      {(draft.storyUnsure || draft.fallbackUnsure || draft.quickSumsUnsure || Object.values(draft.items).some((l) => l.some((i) => i.unsure)) || draft.wordProblem?.unsure) && (
        <p className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900" data-testid="unsure-banner">{copy.rumiUnsureBanner}</p>
      )}
      {status.aiStatus === "failed" && (
        <p className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900">{copy.markFailed}</p>
      )}

      {card.block !== "maths" && (
        <>
          {draft.fallback ? (
            <div className="grid grid-cols-2 gap-3">
              <NumberField testId="fallback-letters" label={copy.fallbackLetters} value={draft.fallback.letters} missing={tried && missing.has("fallback.letters")} note={draft.fallbackUnsure ? copy.rumiUnsure : null}
                onChange={(n) => update((d) => { if (d.fallback) d.fallback.letters = n; })} />
              <NumberField testId="fallback-words" label={copy.fallbackWords} value={draft.fallback.words} missing={tried && missing.has("fallback.words")} note={draft.fallbackUnsure ? copy.rumiUnsure : null}
                onChange={(n) => update((d) => { if (d.fallback) d.fallback.words = n; })} />
            </div>
          ) : (
            <NumberField testId="words-correct" label={copy.wordsCorrect} value={draft.wordsCorrect} missing={tried && missing.has("story.words_correct")} note={draft.storyUnsure ? copy.rumiUnsure : null}
              onChange={(n) => update((d) => { d.wordsCorrect = n; })} />
          )}

          {draft.chips.some((c) => c.fromAi === "flagged") && (
            <ChipGroup title={copy.heardWrong} chips={draft.chips.filter((c) => c.fromAi === "flagged")} dir={dir}
              onToggle={(idx) => update((d) => { const c = d.chips.find((x) => x.idx === idx); if (c) c.wrong = !c.wrong; })} />
          )}
          {draft.chips.some((c) => c.fromAi === "uncertain") && (
            <ChipGroup title={copy.notSure} chips={draft.chips.filter((c) => c.fromAi === "uncertain")} dir={dir}
              onToggle={(idx) => update((d) => { const c = d.chips.find((x) => x.idx === idx); if (c) c.wrong = !c.wrong; })} />
          )}

          {section(copy.questions, "questions")}
          {section(copy.firstSounds, "first_sounds")}
          {section(copy.nonwords, "nonwords")}
        </>
      )}

      {card.block === "maths" && (
        <>
          {section(copy.numbers, "numbers")}
          <NumberField testId="quick-sums" label={copy.quickSumsCorrect} value={draft.quickSumsCorrect} missing={tried && missing.has("quick_sums.correct")} note={draft.quickSumsUnsure ? copy.rumiUnsure : null}
            onChange={(n) => update((d) => { d.quickSumsCorrect = n; })} />
          {section(copy.written, "written", "blank")}
          {draft.wordProblem && (
            <div className="space-y-2">
              <h4 className="font-semibold text-slate-800">{copy.wordProblem}</h4>
              <VerdictRow item={draft.wordProblem} copy={copy} dir="rtl" missing={tried && missing.has("word_problem")} blankWord="blank"
                onPick={(v) => update((d) => { if (d.wordProblem) d.wordProblem.verdict = v; })} />
            </div>
          )}
        </>
      )}

      {error && <p className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-900">{error}</p>}
      <button type="button" onClick={save} disabled={saving}
        className="w-full rounded-2xl py-4 text-xl font-semibold bg-emerald-600 text-white flex items-center justify-center gap-2 disabled:opacity-50">
        {saving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Check className="h-5 w-5" aria-hidden />}
        {copy.saveCheck}
      </button>
    </div>
  );
}

function ChipGroup({ title, chips, dir, onToggle }: { title: string; chips: Draft["chips"]; dir: "rtl" | "ltr"; onToggle: (idx: number) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">{title}</p>
      <div dir={dir} className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button key={c.idx} type="button" aria-pressed={c.wrong} onClick={() => onToggle(c.idx)} data-testid={`chip-${c.idx}`}
            className={`rounded-full px-4 py-2 text-lg border ${c.wrong ? "bg-red-600 text-white border-red-600 line-through" : "bg-white text-slate-800 border-slate-300"}`}>
            {c.word}
          </button>
        ))}
      </div>
    </div>
  );
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
