/**
 * LevelCertificateRow — "Receive Certificate", the last row of the course list.
 *
 * bd-60152. A teacher on a per-module-assessed level (I-SAPS) never sits a
 * level exam, so nothing on this page ever told her the level was finished or
 * handed her the certificate she had earned. The level-exam card — the usual
 * place that happens — is hidden for exactly those vendors, because announcing
 * the absence of an exam reads as something broken.
 *
 * This row is the affordance that replaces it: visibly locked until the work
 * is done, and on tap either naming what is still outstanding or minting the
 * certificate.
 *
 * THE DECISION IS NOT MADE HERE. The button always asks the server, which asks
 * the bot's shared guard (bd-60145): all units complete AND every active
 * per-module exam passed. A teacher could otherwise be told she is eligible by
 * one surface and refused by another. The locked/unlocked appearance is a
 * HINT computed from counts; the server is the answer.
 */

import { useState, useEffect, useCallback } from 'react';
import { Award, Lock, Loader2, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';

/** One weighted stream of the level composite. */
type GradeComponent = { pct: number; bar: number; weight: number; passed: boolean };

type CertState = {
  state: 'issued' | 'locked';
  certificate: { certificate_code: string; issued_at?: string } | null;
  units_total: number;
  units_done: number;
  exams_total?: number;
  exams_done?: number;
  /**
   * bd-60163 — the weighted composite, when the level is assessed that way.
   * null on a level with another rule (Beacon House capstone, Oxbridge) or
   * when the bot could not be reached; the row then falls back to the session
   * counts and says nothing it cannot stand behind.
   */
  grade?: {
    is_passed: boolean;
    composite_pct: number;
    failed_components: string[];
    components: Record<string, GradeComponent>;
  } | null;
};

/** What a teacher calls each stream. The keys are the API's. */
const COMPONENT_LABEL: Record<string, string> = {
  formative: 'Session questions',
  mcq: 'Module exam questions',
  crq: 'Written answers',
};

export default function LevelCertificateRow({
  levelId,
  onIssued,
}: {
  levelId: number;
  /** Fired once a certificate is minted, so the page can refresh level state. */
  onIssued?: () => void;
}) {
  const [info, setInfo] = useState<CertState | null>(null);
  const [claiming, setClaiming] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/training/level/${levelId}/certificate`);
      setInfo(data as CertState);
    } catch {
      setInfo(null);   // stay silent rather than render a wrong state
    }
  }, [levelId]);

  useEffect(() => { void load(); }, [load]);

  const claim = useCallback(async () => {
    setClaiming(true);
    try {
      const { data } = await api.post(`/training/level/${levelId}/certificate`);
      if (data.issued) {
        toast({
          title: 'Certificate issued',
          description: `Your certificate is ready${data.certificate?.certificate_code ? ` — ${data.certificate.certificate_code}` : ''}.`,
        });
        await load();
        onIssued?.();
        return;
      }
      // Refused: say WHICH bar she is under and by how much — not just "not
      // yet". The composite is three independent bars, so "you are short" is
      // useless: she needs to know whether to re-sit an exam or go back to the
      // sessions. Re-takes are unlimited, so this is actionable every time.
      const g = data.grade;
      if (g && Array.isArray(g.failed_components) && g.failed_components.length > 0) {
        const parts = g.failed_components.map((k) => {
          const c = g.components?.[k];
          const label = COMPONENT_LABEL[k] || k;
          return c ? `${label} ${Math.round(c.pct)}% (needs ${c.bar}%)` : label;
        });
        toast({
          title: 'Not quite there yet',
          description: `Still below the mark: ${parts.join(', ')}. You can retake these as many times as you need.`,
        });
        return;
      }
      // No composite for this level — fall back to the session counts.
      const unitsLeft = Math.max(0, (data.units_total || 0) - (data.units_done || 0));
      const examsLeft = Math.max(0, (data.exams_total || 0) - (data.exams_done || 0));
      const parts: string[] = [];
      if (unitsLeft > 0) parts.push(`${unitsLeft} session${unitsLeft === 1 ? '' : 's'}`);
      if (examsLeft > 0) parts.push(`${examsLeft} module exam${examsLeft === 1 ? '' : 's'}`);
      toast({
        title: 'Please complete your training first',
        description: parts.length
          ? `Still to finish: ${parts.join(' and ')}.`
          : 'Finish every module in this level to receive your certificate.',
      });
    } catch {
      toast({
        title: 'Could not issue the certificate',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setClaiming(false);
    }
  }, [levelId, load, onIssued, toast]);

  if (!info) return null;

  // Already held — offer it rather than asking for it again.
  if (info.state === 'issued' && info.certificate) {
    return (
      <a
        href={`/api/portal/training/certificates/${info.certificate.certificate_code}/download`}
        className="w-full text-left rounded-lg px-3 py-2.5 mb-0.5 flex items-center gap-2.5 transition-colors hover:bg-muted/50 ring-1 ring-green-600/30 bg-green-600/5"
        data-testid="level-certificate-download"
      >
        <Award className="w-4 h-4 text-green-700 shrink-0" />
        <span className="flex-1 text-[15px] font-semibold text-foreground">Your certificate</span>
        <Download className="w-4 h-4 text-green-700 shrink-0" />
      </a>
    );
  }

  // The composite is the real gate when the level has one; the session counts
  // are only the hint for levels that do not. Either way the SERVER decides on
  // tap — this just styles the row.
  const ready = info.grade
    ? info.grade.is_passed === true
    : (info.units_total > 0
      && info.units_done >= info.units_total
      && (info.exams_total || 0) <= (info.exams_done || 0));

  return (
    <button
      type="button"
      onClick={claim}
      disabled={claiming}
      data-testid="level-certificate-claim"
      className={`w-full text-left rounded-lg px-3 py-2.5 mb-0.5 flex items-center gap-2.5 transition-colors ${
        ready ? 'ring-1 ring-primary/30 bg-primary/5 hover:bg-primary/10' : 'opacity-60 hover:bg-muted/50'
      }`}
    >
      {claiming
        ? <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        : ready
          ? <Award className="w-4 h-4 text-primary shrink-0" />
          : <Lock className="w-4 h-4 text-muted-foreground shrink-0" />}
      <span className={`flex-1 text-[15px] ${ready ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
        Receive Certificate
      </span>
      {!ready && info.grade && (
        <span className="text-sm text-muted-foreground shrink-0" data-testid="level-composite-pct">
          {Math.round(info.grade.composite_pct)}%
        </span>
      )}
      {!ready && !info.grade && info.units_total > 0 && (
        <span className="text-sm text-muted-foreground shrink-0">
          {info.units_done}/{info.units_total}
        </span>
      )}
    </button>
  );
}
