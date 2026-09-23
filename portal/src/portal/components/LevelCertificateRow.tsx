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
 * the bot's shared guard (bd-60145): on a level with per-module exams, every
 * active one passed — and nothing else (operator, 2026-09-23: no chaining
 * between units or modules; the certificate waits only on the module exams). A teacher could otherwise be told she is eligible by
 * one surface and refused by another. The locked/unlocked appearance is a
 * HINT computed from counts; the server is the answer.
 */

import { useState, useEffect, useCallback } from 'react';
import { Award, Lock, Loader2, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import api from '../services/api';

type CertState = {
  state: 'issued' | 'locked';
  certificate: { certificate_code: string; issued_at?: string } | null;
  units_total: number;
  units_done: number;
  exams_total?: number;
  exams_done?: number;
  /** Retired with the composite (2026-09-23); the server now sends null. */
  grade?: unknown;
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
      // Refused: say WHAT is outstanding. On a module-exam level that is the
      // exams and only the exams — units no longer gate anything there.
      const examsTotal = data.exams_total || 0;
      const examsLeft = Math.max(0, examsTotal - (data.exams_done || 0));
      const parts: string[] = [];
      if (examsTotal > 0) {
        if (examsLeft > 0) parts.push(`${examsLeft} module exam${examsLeft === 1 ? '' : 's'}`);
      } else {
        const unitsLeft = Math.max(0, (data.units_total || 0) - (data.units_done || 0));
        if (unitsLeft > 0) parts.push(`${unitsLeft} session${unitsLeft === 1 ? '' : 's'}`);
      }
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

  const examsTotal = info.exams_total || 0;
  const examsDone = Math.min(examsTotal, info.exams_done || 0);

  // A level with per-module exams: the card with its progress bar. Ready means
  // every exam passed — units are not counted (operator, 2026-09-23). This is
  // only the styling; the SERVER decides on tap.
  if (examsTotal > 0) {
    const ready = examsDone >= examsTotal;
    return (
      <div
        className={`mt-2 mx-1.5 mb-1.5 rounded-xl p-3 ${
          ready ? 'ring-1 ring-primary/30 bg-primary/5' : 'border border-dashed'
        }`}
        data-testid="level-certificate-card"
      >
        <div className="flex items-center gap-2">
          {ready
            ? <Award className="w-4 h-4 text-primary shrink-0" />
            : <Lock className="w-4 h-4 text-muted-foreground shrink-0" />}
          <span className="text-[15px] font-semibold text-foreground">Level certificate</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Issued once all {examsTotal} module exams are passed. Units can be taken in any order.
        </p>
        <div
          className="h-1.5 rounded-full bg-muted overflow-hidden mt-2.5 mb-1"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={examsTotal}
          aria-valuenow={examsDone}
          aria-label="Module exams passed"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${Math.round((examsDone / examsTotal) * 100)}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground" data-testid="level-certificate-progress">
          {examsDone} of {examsTotal} module exams passed
        </p>
        <button
          type="button"
          onClick={claim}
          disabled={claiming}
          data-testid="level-certificate-claim"
          data-ready={ready ? 'true' : 'false'}
          className={`mt-2.5 w-full inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            ready
              ? 'bg-primary text-primary-foreground hover:opacity-90'
              : 'bg-muted text-muted-foreground hover:bg-muted/70'
          }`}
        >
          {claiming && <Loader2 className="w-4 h-4 animate-spin" />}
          Receive certificate
        </button>
      </div>
    );
  }

  // No module exams (Beacon House, Oxbridge): the one-line row and its session
  // counts, unchanged.
  const ready = info.units_total > 0 && info.units_done >= info.units_total;

  return (
    <button
      type="button"
      onClick={claim}
      disabled={claiming}
      data-testid="level-certificate-claim"
      data-ready={ready ? 'true' : 'false'}
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
      {!ready && info.units_total > 0 && (
        <span className="text-sm text-muted-foreground shrink-0">
          {info.units_done}/{info.units_total}
        </span>
      )}
    </button>
  );
}
