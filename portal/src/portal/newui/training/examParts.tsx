import { Award, Check, Download, PenLine } from 'lucide-react';
import { Chip } from '../Chip';
import { List, Row } from '../List';
import { shortDate } from '../range';
import { TRAINING_COPY } from '../copy';
import { certificateUrl, downloadCertificate } from './certificateFile';

/**
 * bd-5rz1v.25 — pieces the exam screens share: the certificate as a card, a written answer's box
 * with the server's character floor, and a written answer read back with its score and feedback.
 */

/** The certificate a pass issued: a card with its level, its code and its date; a tap downloads it. */
export function CertificateCard({ certificate }: { certificate: { certificate_code: string; level_name: string; issued_at?: string | null } }) {
  const day = certificate.issued_at ? shortDate(certificate.issued_at.slice(0, 10)) : null;
  return (
    <div data-testid="training-certificate-card">
      <List>
        <Row
          icon={Award}
          tile="done"
          title={certificate.level_name}
          chips={(
            <>
              <Chip tone="done">{certificate.certificate_code}</Chip>
              {day ? <Chip>{day}</Chip> : null}
            </>
          )}
          end={Download}
          onClick={() => downloadCertificate(certificateUrl(certificate.certificate_code))}
          ariaLabel={TRAINING_COPY.download}
        />
      </List>
    </div>
  );
}

/** A written answer: the box, and the server's character floor as a chip (amber until reached). */
export function WrittenField({ value, floor, onChange, disabled }: { value: string; floor: number; onChange: (v: string) => void; disabled?: boolean }) {
  const n = value.trim().length;
  return (
    <div className="flex flex-col gap-2">
      <textarea
        dir="auto"
        aria-label={TRAINING_COPY.writtenAnswer}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        className="min-h-[180px] w-full rounded-2xl border-2 border-nu-surface-line bg-nu-surface-card p-3 text-[15px] leading-relaxed text-nu-surface-text outline-none focus-visible:border-nu-select focus-visible:ring-[3px] focus-visible:ring-nu-focus"
      />
      {floor > 0 ? (
        <span className="flex">
          <Chip tone={n >= floor ? 'done' : 'waiting'} icon={n >= floor ? Check : PenLine}>{TRAINING_COPY.of(n, floor)}</Chip>
        </span>
      ) : null}
    </div>
  );
}

/** One question and her answer, read back (data): the question, the answer, a score chip, the feedback. */
export function WrittenAnswer({ question, answer, score, feedback }: { question: string; answer: string; score?: string | null; feedback?: string | null }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-2xl border-[1.5px] border-nu-surface-line bg-nu-surface-card p-3">
      <p dir="auto" className="whitespace-pre-line text-[15px] font-bold text-nu-surface-text">{question}</p>
      <p dir="auto" className="whitespace-pre-wrap text-[15px] text-nu-surface-text">{answer}</p>
      {score ? <span className="flex flex-wrap gap-[5px]"><Chip>{score}</Chip></span> : null}
      {feedback ? <p dir="auto" className="text-sm text-nu-surface-muted">{feedback}</p> : null}
    </li>
  );
}
