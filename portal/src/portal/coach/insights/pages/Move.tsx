import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useLang, type Lang } from "../../../teacher/i18n";
import InsightsGate from "../InsightsGate";
import { useLoad } from "../useLoad";
import { coachip } from "../api";
import { insightsPaths } from "../paths";
import { InsightsPage, MetaLine } from "../components/Frame";
import { Section as CpSection } from "../../../coachip-ui/Section";
import { Surface } from "../../../coachip-ui/Surface";
import { Button } from "../../../coachip-ui/Button";
import { StateBlock, NoteCard } from "../components/StateBlock";
import { CodeText, DateText, LibraryText } from "../count";
import { RingCount } from "../../../coachip-ui/Count";
import { digits, LRI, PDI, todayKarachi } from "../format";
import { COPY } from "../copy";
import { pick, t, tx } from "../text";
import type { MoveDetail } from "../types";

/**
 * bd-sex15q.15 — S5, the move (`/w/:wId/move?school=`, R9). The intervention exactly as the library wrote it: every
 * library field goes through <LibraryText> untouched, the client only frames it with COPY. The pairing W → I is the
 * server's (LIBRARY_RULES §2), never this file's.
 *
 *   check line   read from `check_by_default.rule` ("visit" or "14_days"), never worked out from a visit date here.
 *   evidence     the citation as text, never a link (API R9: a library url is never passed through).
 *   FLN          the existing send page with NO recipient and no query string (c-api finding 10:09Z).
 *   Set button   needs a teacher `code_id` the S5 payload does not carry, so setting a step lives on S2 (G1).
 *
 * R6 fix cycle 1 (FIX_R6 A2, design-qa 224143): the app bar names the weakness (the coach keeps the thread from S2), the
 * number row comes first (S2's card ring), then ONE MOVE whose lead is the intervention's title in full, the teacher's
 * step under it, and "Try this tomorrow" carries the screen's one action: play the moment on S2, where the step is set.
 */

/** The FLN send page: no code, no recipient, no query (a pre-selection would be a decode path). */
export const FLN_SEND = "/portal/fln/send";

/**
 * A material title in Urdu: every Latin-script run ("NIETE", «Five step lesson plan», an English title standing in for an
 * empty name_ur) sits in LRI…PDI (COPY §0.3; red-2 18:08Z, fix-r5 5e). English is untouched; the words stay the library's.
 */
export function isolateLatin(title: string, lang: Lang): string {
  if (lang !== "ur") return title;
  return title.replace(/[A-Za-z][A-Za-z0-9'’.,:/&-]*(?:\s+[A-Za-z0-9][A-Za-z0-9'’.,:/&-]*)*/g, (run) => `${LRI}${run}${PDI}`);
}

/** Whole calendar days from `from` to `to` (both ISO days). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** R6 (bd-sex15q.46): a block is a flat hairline section with a small-caps label (coachip-ui Section), never a boxed card. */
function Section({ title, testId, first = false, children }: { title: ReactNode; testId?: string; first?: boolean; children: ReactNode }) {
  return (
    <CpSection label={title} testId={testId} first={first}>
      <div className="flex flex-col gap-3">{children}</div>
    </CpSection>
  );
}

const body = "text-[15px] leading-[1.5] text-cp-ink";
/** The 12 px small-caps label inside a section (a second label under the first, as on Facts). */
const subLabel = "cp-label text-[12px] font-bold uppercase leading-snug tracking-[0.08em] text-cp-ink-3";
/** The FLN send: the secondary button (navy outline), wrapping, since the library's title can be long. */
const secondaryWrap = "cp-press flex min-h-[44px] items-center justify-center rounded-[12px] border-2 border-cp-navy bg-white px-4 py-2.5 text-center text-[14px] font-semibold leading-snug text-cp-navy outline-none [overflow-wrap:anywhere] focus-visible:ring-[3px] focus-visible:ring-cp-navy focus-visible:ring-offset-2";

function CheckRule({ data, lang }: { data: MoveDetail; lang: Lang }) {
  const c = data.check_by_default;
  if (c.rule === "visit") {
    const on = c.visit?.date ?? c.date;
    return (
      <p data-testid="s5-check-rule" data-nonum="" className="border-t border-cp-hairline pt-3 text-[13px] leading-[1.45] text-cp-ink-3">
        {tx("s5.check.rule", lang, {
          date: <DateText iso={on} lang={lang} />,
          days: <span data-nonum="">{digits(daysBetween(todayKarachi(), on), lang)}</span>,
        })}
      </p>
    );
  }
  return (
    <p data-testid="s5-check-rule" data-nonum="" className="border-t border-cp-hairline pt-3 text-[13px] leading-[1.45] text-cp-ink-3">
      {tx("s5.check.rule.14", lang, { date: <DateText iso={c.date} lang={lang} /> })}
    </p>
  );
}

/**
 * fix-r5 s2 item 7a (qa-coach 073254): the library's debrief line, what the coach says tomorrow, inside COPY d.try_tomorrow.
 * The library text goes in verbatim; a line that already opens with the frame's own words is shown as it is, never framed
 * twice (the contract fixture carries the frame inside the text; INTERVENTIONS.json does not).
 */
function TryTomorrow({ script, lang, wId }: { script: string; lang: Lang; wId: string }) {
  const pre = COPY["d.try_tomorrow"][lang].split("{step}")[0].trim();
  const framed = Boolean(pre) && script.trimStart().startsWith(pre);
  return (
    <Surface testId="s5-try-tomorrow" className="mt-5">
      {script && (
        <p className="text-[17px] font-semibold leading-[1.45] text-cp-navy">
          {framed ? <LibraryText>{script}</LibraryText> : tx("d.try_tomorrow", lang, { step: <LibraryText>{script}</LibraryText> })}
        </p>
      )}
      <Button block to={`${insightsPaths.w(wId)}#moment`} testId="s5-play"><span>{t("s5.play", lang)}</span></Button>
    </Surface>
  );
}

/** The read sits INSIDE the gate, so with portal_coachip off no /coachip/* request fires (B7; red-2 18:08Z). */
export default function Move() {
  return (
    <InsightsGate>
      <MoveLoaded />
    </InsightsGate>
  );
}

function MoveLoaded() {
  const { wId = "" } = useParams();
  const [params] = useSearchParams();
  const school = params.get("school");
  const lang = useLang();
  const { data, error } = useLoad<MoveDetail>(() => coachip.move(wId, school), [wId, school]);
  const i = data?.i ?? null;
  const flnTitle = i?.materials.find((m) => m.kind === "fln")?.title ?? null;
  // a line still coming is null (the app bar holds its box, FIX_R6 A1); a line that will not come is undefined
  const coming = error ? undefined : null;

  return (
    <InsightsPage
      testId="insights-move"
      backTo={insightsPaths.w(wId)}
      title={data ? pick(data.w.short_name, lang) : coming}
      crumb={i ? tx("s5.chip", lang, { i_id: <CodeText lang={lang}>{i.i_id}</CodeText> }) : data ? undefined : coming}
      windows={data?.windows}
      screenWindow={data?.w.window.id ?? null}
      chips={data ? <MetaLine window={data.w.window} /> : coming}
    >
      {!data ? <StateBlock error={error} /> : (
        <>
          <section data-testid="s5-w" data-tone="notice" className="flex flex-col gap-2 pt-2">
            <RingCount count={data.w.count} lang={lang} size="card">
              <p className="text-[15px] leading-[1.45] text-cp-ink">{pick(data.w.sentence, lang)}</p>
            </RingCount>
          </section>

          {!i ? <NoteCard testId="s5-no-i">{t("s5.no_i", lang)}</NoteCard> : (
            <>
              {/* fix-r5 s2 item 7a (panel 094003): the step, then what the coach says tomorrow, then the rehearsal and the
                  moment; the facts; what to listen for and the check; "Why this works" folded; other moves */}
              <CpSection label={t("eyebrow.one_move", lang)} tone="green" testId="s5-step">
                <div className="flex flex-col gap-2">
                  <p data-testid="s5-lead" className="text-[17px] font-semibold leading-[1.45] text-cp-navy"><LibraryText>{pick(i.title, lang)}</LibraryText></p>
                  <LibraryText as="p" className={body}>{pick(i.teacher_action_step, lang)}</LibraryText>
                </div>
              </CpSection>

              <TryTomorrow script={pick(i.debrief_script, lang)} lang={lang} wId={wId} />

              <Section title={<span data-nonum="">{t("s5.rehearsal.title", lang)}</span>} testId="s5-rehearsal">
                <p className={body} data-nonum="">
                  {tx("d.rehearse.frame", lang, { script: <LibraryText>{pick(i.rehearsal_script, lang)}</LibraryText> })}
                </p>
              </Section>

              <Section title={t("s5.with.title", lang)} testId="s5-facts">
                <LibraryText as="p" className={body}>{pick(i.with_whom, lang)}</LibraryText>
                <h2 className={`pt-1 ${subLabel}`}>{t("s5.how_long.title", lang)}</h2>
                <LibraryText as="p" className={body}>{pick(i.duration, lang)}</LibraryText>
              </Section>

              {i.materials.some((m) => m.kind !== "none") && (
                <Section title={t("s5.materials.title", lang)} testId="s5-materials">
                  <ul className="flex flex-col divide-y divide-cp-hairline">
                    {i.materials.map((m, k) => {
                      if (m.kind === "none") return null;
                      if (m.kind === "fln") {
                        // with the send on, the send link below carries this title; never twice
                        if (data.fln?.can_send) return null;
                        return (
                          <li key={k} className="py-2">
                            <LibraryText className={body}>{isolateLatin(pick(m.title, lang), lang)}</LibraryText>
                          </li>
                        );
                      }
                      // vidrec: the minutes are not in the payload, so the title alone (s5.materials.video needs {n})
                      return (
                        <li key={k} data-kind={m.kind} className={`py-2 ${body}`}>
                          <LibraryText>{isolateLatin(pick(m.title, lang), lang)}</LibraryText>
                        </li>
                      );
                    })}
                  </ul>
                  {data.fln && (data.fln.can_send && flnTitle ? (
                    <Link to={FLN_SEND} data-testid="s5-fln" className={secondaryWrap}>
                      <LibraryText>{isolateLatin(pick(flnTitle, lang), lang)}</LibraryText>
                    </Link>
                  ) : !data.fln.can_send ? (
                    <p data-testid="s5-fln-off" className="text-[13px] leading-[1.45] text-cp-ink-3">{t("s5.fln.off", lang)}</p>
                  ) : null)}
                </Section>
              )}

              <Section title={t("s5.listen_for.title", lang)} testId="s5-listen-for">
                <LibraryText as="p" className={body}>{pick(i.listen_for, lang)}</LibraryText>
              </Section>

              <Section title={t("s5.check.title", lang)} testId="s5-check">
                <LibraryText as="p" className={body}>{pick(i.check_it_worked, lang)}</LibraryText>
                <CheckRule data={data} lang={lang} />
              </Section>

              {i.evidence.length > 0 && (
                <details data-testid="s5-evidence" className="group mt-5 border-t border-cp-hairline pt-3">
                  <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-[17px] font-semibold leading-[1.4] text-cp-ink outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">{t("s5.why.title", lang)}</span>
                    <ChevronRight size={20} strokeWidth={1.5} className="shrink-0 text-cp-ink-3 transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90" aria-hidden="true" />
                  </summary>
                  <ul className="flex flex-col gap-3 pb-1 pt-2">
                    {i.evidence.map((e, k) => (
                      <li key={k} className={`${body}`}>
                        <LibraryText as="p" className="text-[13px] font-semibold text-cp-ink-2">{e.source}</LibraryText>
                        <LibraryText as="p">{pick(e.claim, lang)}</LibraryText>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {data.alternatives.length > 0 && (
                <Section title={t("s5.alternatives.title", lang)} testId="s5-alternatives">
                  <ul className="flex flex-col divide-y divide-cp-hairline">
                    {data.alternatives.map((a) => (
                      <li key={a.i_id} data-i={a.i_id} className={`flex min-h-[44px] items-center py-2.5 ${body}`}>
                        <LibraryText>{pick(a.title, lang)}</LibraryText>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <p data-testid="s5-footer" className="mt-5 border-t border-cp-hairline pt-4 text-center text-[13px] leading-[1.45] text-cp-ink-3">{t("s5.footer", lang)}</p>
            </>
          )}
        </>
      )}
    </InsightsPage>
  );
}
