/**
 * BandPicker — the portal's way out of "no training assigned".
 *
 * bd-43487. The teacher picks the grade bands they teach; the server turns that
 * into program assignments (`POST /training/bands` → `applyBandSelection`), and
 * the training catalogue appears.
 *
 * WHY THIS COMPONENT EXISTS
 * -------------------------
 * `GET /training/levels` legitimately returns `[]` for a teacher with no active
 * row in `teacher_training_assignments`, and the training page rendered that as
 * an empty dropdown — no reason given, no way to fix it. On NIETE production
 * (2026-08-21) that was 666 of 9,534 teachers, and it is what the partner bug
 * sheet reports as "training levels are not visible to teacher in the portal".
 *
 * The WhatsApp bot already had this recovery. The portal's half of the API had
 * shipped too (bd-43478) — but nothing in `portal/src` ever called it, so the
 * fix existed and was unreachable. This is the missing caller.
 *
 * The 48-hour cooldown is the SERVER's rule, not this component's: we render
 * whatever `can_change` / `notice` the API returns rather than re-deriving it,
 * so the two can never disagree. A blocked save returns 429 and is surfaced
 * as-is.
 */

import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';

interface BandOption {
  id: string;
  title: string;
}

interface BandsResponse {
  options?: BandOption[];
  selected?: string[];
  can_change?: boolean;
  is_first_selection?: boolean;
  hours_remaining?: number;
  notice?: string | null;
}

interface BandPickerProps {
  /** Called after a save that actually changed something, so the caller can
   *  re-pull the catalogue. Without this the teacher saves and the page still
   *  looks empty. */
  onSaved: () => void;
  /** Heading above the options. Defaults to the first-time question; the edit
   *  entry point passes the operator's label instead. */
  heading?: string;
  /** Save-button label. The first-time flow promises the catalogue will appear;
   *  an edit just saves. */
  saveLabel?: string;
}

const BandPicker = ({
  onSaved,
  heading = 'Which grades do you teach?',
  saveLabel = 'Save and show my training',
}: BandPickerProps) => {
  const { toast } = useToast();
  const [options, setOptions] = useState<BandOption[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [canChange, setCanChange] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/training/bands');
        const d: BandsResponse = data || {};
        setOptions(d.options || []);
        setChosen(Array.isArray(d.selected) ? d.selected : []);
        setCanChange(d.can_change !== false);
        setNotice(d.notice ?? null);
      } catch {
        // The empty-state message above still stands on its own; only the
        // picker is unavailable.
        setOptions([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = useCallback((id: string) => {
    setChosen(prev => (prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]));
  }, []);

  const save = useCallback(async () => {
    if (!chosen.length) {
      toast({ title: 'Pick at least one', description: 'Choose the grades you teach.' });
      return;
    }
    setSaving(true);
    try {
      await api.post('/training/bands', { bands: chosen });
      toast({ title: 'Saved', description: 'Your training is being set up.' });
      onSaved();
    } catch (err: unknown) {
      // The server owns the cooldown rule; show what it said rather than a
      // guess of our own.
      const res = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
      toast({
        title: res?.status === 429 ? 'Too soon to change this' : 'Could not save',
        description: res?.data?.error || 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [chosen, onSaved, toast]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="band-picker-loading">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading the grade options…
      </div>
    );
  }

  if (!options.length) return null;

  return (
    <div data-testid="band-picker" className="mt-4">
      <p className="text-sm font-semibold mb-3">{heading}</p>

      <div className="flex flex-wrap gap-2 mb-4">
        {options.map(o => {
          const active = chosen.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              data-testid={`band-option-${o.id}`}
              aria-pressed={active}
              disabled={!canChange || saving}
              onClick={() => toggle(o.id)}
              className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-muted border-border'
              } ${!canChange || saving ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {o.title}
            </button>
          );
        })}
      </div>

      {notice && (
        <p className="text-xs text-muted-foreground mb-3" data-testid="band-notice">{notice}</p>
      )}

      <Button data-testid="band-save" onClick={save} disabled={!canChange || saving}>
        {saving ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
        ) : (
          <><GraduationCap className="w-4 h-4 mr-2" /> {saveLabel}</>
        )}
      </Button>
    </div>
  );
};

export default BandPicker;
