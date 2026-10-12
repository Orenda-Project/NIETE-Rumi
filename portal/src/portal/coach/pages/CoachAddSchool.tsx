import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { ConfirmTray, HistoryRow, StatusChip } from "../../teacher/ui";
import { useCopy } from "../../teacher/i18n";
import { coach } from "../../services/api";
import type { SchoolHit } from "../types";
import { SearchBox, Loading } from "../ui";
import { PEOPLE } from "../people/copy";
import PeopleFrame from "../people/PeopleFrame";
import { EmptyRow } from "../people/rows";

/**
 * Add a school (Blueprint: Coach · Manage schools and teachers, boards Coach_AddSchool and Coach_AddSchoolConfirm):
 * the WhatsApp /observe "Add or remove a school" search, in the app.
 *
 * Search is right here (coaches may get a little search where buttons get complicated: every school in the district
 * is too many to tap through). Two letters at least; the server ranks an exact EMIS first. A school already on her
 * list says so and is information, not a row to tap. Tapping a school puts it in the URL (`?pick=`), so the phone's
 * Back closes the question, and opens the kit's ConfirmTray; Add school adds it (her teachers there come with it)
 * and opens that school's page with an Added notice.
 */
const SEARCH_MIN = 2;
const DEBOUNCE_MS = 250;

const CoachAddSchool = () => {
  const C = useCopy(PEOPLE);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const pick = params.get("pick") || "";
  const [hits, setHits] = useState<SchoolHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < SEARCH_MIN) { setHits(null); setSearching(false); return undefined; }
    const ticket = ++latest.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      coach.searchSchools(term)
        .then((r) => { if (ticket === latest.current) setHits(r.schools || []); })
        .catch(() => { if (ticket === latest.current) setHits([]); })
        .finally(() => { if (ticket === latest.current) setSearching(false); });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [q]);

  const setQuery = (v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set("q", v); else next.delete("q");
    next.delete("pick");
    setError(false);
    setParams(next, { replace: true });
  };
  const linkFor = (h: SchoolHit) => `/portal/coach/schools/add?${new URLSearchParams({ q, pick: h.schoolExtId }).toString()}`;
  const picked = pick ? (hits || []).find((h) => h.schoolExtId === pick && !h.alreadyMine) : undefined;
  const closePick = () => navigate(`/portal/coach/schools/add?${new URLSearchParams({ q }).toString()}`, { replace: true });

  const add = async () => {
    if (!picked || busy) return;
    setBusy(true); setError(false);
    try {
      const r = await coach.addSchool(picked.schoolExtId);
      const emis = r.emis || picked.emis || "";
      navigate(`/portal/coach/school/${encodeURIComponent(emis)}`, { replace: true, state: { notice: C.added, tellTeam: true } });
    } catch {
      setError(true); closePick();
    } finally { setBusy(false); }
  };

  return (
    <PeopleFrame title={C.addSchool} crumb={C.title} backTo="/portal/coach/people" feature="schools">
      <SearchBox value={q} onChange={setQuery} placeholder={C.searchSchool} />
      {error && <div className="flex" data-testid="add-error"><StatusChip text={C.saveFailed} tone="waiting" /></div>}
      {searching && !hits && <Loading />}
      {hits && hits.length === 0 && <EmptyRow icon={<Search className="h-5 w-5" />}>{C.noSchoolFound}</EmptyRow>}
      {hits && hits.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.08)]">
          {hits.map((h, i) => (
            <div key={h.schoolExtId} data-testid="school-hit">
              <HistoryRow lead="school" wrapTitle first={i === 0} title={h.name || C.dash} extra={C.emisN(h.emis || "")}
                chip={h.alreadyMine ? { text: C.onYourList, tone: "done" } : undefined}
                action={h.alreadyMine ? "none" : "chevron"} to={h.alreadyMine ? undefined : linkFor(h)} />
            </div>
          ))}
        </section>
      )}
      <ConfirmTray open={!!picked} title={picked?.name || C.dash} onClose={closePick}
        chips={picked?.emis ? [{ text: C.emisN(picked.emis), tone: "info" }] : undefined}
        line={C.lines.addSchool} confirmLabel={C.addSchoolBtn} confirmIcon={Plus} onConfirm={add}
        cancelLabel={C.back} closeLabel={C.back} />
    </PeopleFrame>
  );
};

export default CoachAddSchool;
