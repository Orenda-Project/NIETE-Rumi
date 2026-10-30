import { useState } from "react";
import { useLang } from "../../../teacher/i18n";
import { coachip } from "../api";
import { t } from "../text";
import { useDecode } from "../useCoachip";

/**
 * fix-r5 s6 (b), GO_PACKAGE v5 §0.4 b (qa-coach 103742, COS-deputy 103956; the operator's ruling 1, "each coach for
 * their own teachers"): the step card's "Show name (switched on by your programme)". Drawn only when useDecode() is true.
 * A tap asks R16 for that one code (the server checks the code is this coach's own and writes one audit row per show);
 * the name lives in this card's memory only, "Hide name" forgets it, and a second show asks again. Any error (a 404 for
 * a code that is not theirs, the switch gone) shows no name and says it could not be shown. Below the card's actions,
 * so the primary stays where it was (inside the 704 px fold).
 */
export default function ShowName({ codeId }: { codeId: string }) {
  const lang = useLang();
  const on = useDecode();
  const [state, setState] = useState<{ kind: "hidden" | "asking" | "failed" } | { kind: "shown"; name: string }>({ kind: "hidden" });
  if (!on) return null;
  const show = () => {
    if (state.kind === "asking") return;
    setState({ kind: "asking" });
    coachip.teacherName(codeId).then(
      (r) => setState(typeof r?.name === "string" && r.name.trim() ? { kind: "shown", name: r.name } : { kind: "failed" }),
      () => setState({ kind: "failed" }),
    );
  };
  const link = "flex min-h-[44px] items-center px-1 text-[15px] font-semibold text-cp-green-ink outline-none focus-visible:ring-[3px] focus-visible:ring-cp-green";
  if (state.kind === "shown") {
    return (
      <div data-testid="decode" className="flex flex-wrap items-center gap-x-3 border-t border-cp-hairline pt-2">
        <bdi data-testid="decode-name" className="text-[17px] font-semibold leading-[1.4] text-cp-ink">{state.name}</bdi>
        <button type="button" data-testid="decode-hide" onClick={() => setState({ kind: "hidden" })} className={link}>
          {t("decode.hide", lang)}
        </button>
      </div>
    );
  }
  return (
    <div data-testid="decode" className="flex flex-col border-t border-cp-hairline pt-1">
      <button type="button" data-testid="decode-show" onClick={show} disabled={state.kind === "asking"}
        aria-busy={state.kind === "asking" ? "true" : undefined} className={`${link} text-start`}>
        {t("decode.show", lang)}
      </button>
      {state.kind === "failed" && (
        <p data-testid="decode-failed" role="status" className="text-[13px] leading-[1.45] text-cp-ink-3">{t("e.failed_load", lang)}</p>
      )}
    </div>
  );
}
