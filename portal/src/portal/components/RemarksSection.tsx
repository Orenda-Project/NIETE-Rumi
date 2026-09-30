import { ClipboardCheck } from 'lucide-react';
import type { RemarkReceived, SchoolRemarks } from '../types/portal';

/**
 * Principal Remarks — the last S of STEPS. Only SUBMITTED forms appear:
 * scores are written as the principal answers, so a part-finished form would
 * otherwise show a "result" nobody gave.
 *
 * A principal reads the reviews she wrote, averaged per area. A teacher reads
 * the reviews she RECEIVED, each one whole: the quarter, the comment, and the
 * 1-to-4 score for every area (operator, 2026-09-30).
 *
 * id="remarks" is where the principal's STEPS journey ends.
 */
const shell = 'bg-white rounded-lg p-6 shadow-sm border border-border mb-8 scroll-mt-20';

const Heading = () => (
  <div className="flex items-center gap-2 mb-6">
    <ClipboardCheck className="w-5 h-5 text-accent" />
    <h2 className="text-2xl font-light">Principal Remarks</h2>
  </div>
);

export const RemarksReceivedSection = ({ remarks }: { remarks: RemarkReceived[] }) => (
  <section id="remarks" className={shell}>
    <Heading />
    <p data-testid="remarks-help" className="text-muted-foreground text-sm mb-6">
      Your principal's quarterly review of your work, scored 1 to 4 in five areas.
    </p>
    {remarks.length === 0 ? (
      <p data-testid="remarks-empty" className="text-muted-foreground text-sm">
        No remark from your principal yet. Once your quarterly review is submitted, it will show here.
      </p>
    ) : (
      <div className="space-y-6">
        {remarks.map((r, i) => (
          <article key={`${r.submittedAt}-${i}`} data-testid={`remark-received-${i}`} className="p-4 bg-secondary rounded-lg">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="font-semibold">{r.cycleName || 'Quarterly review'}</h3>
              {r.submittedAt && (
                <span className="text-xs text-muted-foreground">
                  {new Date(r.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
            {r.comment && <p className="text-sm mb-4">“{r.comment}”</p>}
            <ul className="space-y-2">
              {r.areas.map((a) => (
                <li key={a.ordinal} className="flex items-center justify-between gap-3 text-sm">
                  <span>{a.name}</span>
                  <span className="font-bold text-accent whitespace-nowrap">{a.score}/4</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    )}
  </section>
);

const RemarksSection = ({ remarks }: { remarks: SchoolRemarks }) => (
  <section id="remarks" className={shell}>
    <Heading />
    <p data-testid="remarks-help" className="text-muted-foreground text-sm mb-6">
      The quarterly reviews you submitted yourself on WhatsApp, rated 1 to 4 across
      five areas. Only finished reviews are counted.
    </p>

    {remarks.submitted === 0 ? (
      <p data-testid="remarks-empty" className="text-muted-foreground text-sm">
        You haven't submitted any teacher evaluations yet this quarter. Send
        <strong> /remark</strong> on WhatsApp to start one.
      </p>
    ) : (
      <>
        <div className="flex items-center justify-between mb-6">
          <p className="text-muted-foreground text-sm">
            {remarks.submitted} evaluation{remarks.submitted === 1 ? '' : 's'} submitted
          </p>
          <div className="text-right">
            <span className="text-sm text-muted-foreground block">Average</span>
            <span data-testid="remarks-average" className="text-2xl font-bold text-accent">
              {remarks.averagePct}%
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {remarks.indicatorBreakdown.map((i) => (
            <div key={i.key} data-testid={`remark-${i.key}`} className="p-4 bg-secondary rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">{i.name}</h3>
                <span className="text-lg font-bold text-accent whitespace-nowrap">
                  {i.average}/4
                </span>
              </div>
              <div className="w-full bg-background rounded-full h-2">
                <div
                  className="bg-accent h-2 rounded-full transition-all"
                  style={{ width: `${i.percentage}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {remarks.focusIndicator && (
          <p className="text-sm text-muted-foreground mt-4">
            Lowest rated: <strong data-testid="remarks-focus">{remarks.focusIndicator}</strong>
          </p>
        )}
      </>
    )}
  </section>
);

export default RemarksSection;
