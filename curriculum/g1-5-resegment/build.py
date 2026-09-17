"""Stage B build: segmentation corpus -> the G1-5 matrix sheet.

    python3 build.py            # all four subjects
    python3 build.py English    # one subject (the others are left untouched)
"""
import glob
import os
import sys

import calfmt
import calover
import caltab
import covfmt
import corpuscheck
import covtab
import fde
import fdefmt
import fdetab
import flntab
import navtab
import reviewtab
import skillfmt
import skillmap
import skills
import sheetio
import stageb
import support
import tabs

# The corpus lives in `corpus/` beside this file and is NOT committed: its
# licence is restricted-educational-internal, so page-truth, the pipeline
# intermediates and any rendered output stay local (see ../.gitignore). Point
# the env vars elsewhere to build from a corpus kept outside the repo.
HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.environ.get("CORPUS_DIR", os.path.join(HERE, "corpus"))

FDE_DIR = os.environ.get("FDE_DIR", os.path.join(CORPUS, "fde"))

SKILLSMAP_JSON = os.environ.get("SKILLSMAP_JSON",
                                os.path.join(CORPUS, "skillsmap.json"))

SEG_DIR = os.environ.get("SEG_DIR", os.path.join(CORPUS, "seg"))

SUBJECT_TABS = {"English": "English G1–5", "Urdu": "Urdu G1–5",
                "Maths": "Maths G1–5", "Science": "Science G4–5"}

TAB_ORDER = ["Navigation", "Teaching Calendar", "Calendar (overview)",
             "FDE Syllabus", "English G1–5",
             "Urdu G1–5", "Maths G1–5", "Science G4–5",
             "Coverage Map", "Coverage — gaps", "FLN Coverage",
             "Skills Map",
             "All Segments + SLOs", "Skill Taxonomy", "Pipeline Stages",
             "Samples Review", "QA Checklist"]

NAV_LABEL_TO_TAB = {v: v for v in SUBJECT_TABS.values()}
NAV_LABEL_TO_TAB.update({t: t for t in ("All Segments + SLOs", "Skill Taxonomy",
                                        "Pipeline Stages", "Navigation",
                                        "Teaching Calendar", "FDE Syllabus",
                                        "Calendar (overview)",
                                        "Coverage Map", "Coverage — gaps",
                                        "FLN Coverage", "Skills Map",
                                        "Samples Review",
                                        "QA Checklist")})


def send(svc, requests, size=200):
    """Batch formatting requests; Sheets rejects very large single payloads."""
    for i in range(0, len(requests), size):
        svc.spreadsheets().batchUpdate(
            spreadsheetId=sheetio.SHEET_ID,
            body={"requests": requests[i:i + size]}).execute()


def load_corpus():
    corpuscheck.require(SEG_DIR, FDE_DIR, SKILLSMAP_JSON)
    by_subject, runs, books, breaks = {}, [], [], {}
    for path in sorted(glob.glob(os.path.join(SEG_DIR, "grade_*.json"))):
        stem, grade, subject, meta, segments = stageb.load_book(path)
        rec = fde.load(FDE_DIR, stem)
        syllabus = set(rec["chapters"]) if rec else None
        rows, st = stageb.build_rows(stem, grade, subject, segments, syllabus)
        by_subject.setdefault(subject, []).append((grade, rows, st))
        runs.append((grade, subject, segments, syllabus))
        books.append((grade, subject, st, rows, rec))
        for w in (rec["weeks"] if rec else []):
            if w["kind"] == "break":
                breaks.setdefault(w["title"], []).append(stem)
    for subject in by_subject:
        by_subject[subject].sort(key=lambda t: t[0])
    order = {"English": 0, "Urdu": 1, "Maths": 2, "Science": 3}
    runs.sort(key=lambda t: (t[0], order[t[1]]))
    return by_subject, runs, books, breaks


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    # `books` is shadowed twice below, so the whole-corpus list keeps its
    # own name. It is the only list that carries the FDE record per book.
    corpus, runs, all_books, breaks = load_corpus()

    subject_stats, all_rows = [], []
    for subject in ("English", "Urdu", "Maths", "Science"):
        books = corpus.get(subject, [])
        days = sum(b[2]["days"] for b in books)
        rows_n = sum(b[2]["rows"] for b in books)
        subject_stats.append((subject, {
            "days": days, "tails": rows_n - days,
            "introduces": sum(b[2]["introduces"] for b in books),
            "overlapping": sum(b[2]["overlapping"] for b in books)}))
        for _, rows, _ in books:
            all_rows.extend(rows)
    total = {k: sum(s[1][k] for s in subject_stats)
             for k in ("days", "tails", "introduces", "overlapping")}

    payload = {}
    for subject, title in SUBJECT_TABS.items():
        if only and subject != only:
            continue
        books = [(g, r) for g, r, _ in corpus.get(subject, [])]
        payload[title] = tabs.subject_tab(subject, books)

    svc = sheetio.client()
    titles = list(payload)
    if not only:
        titles = TAB_ORDER
    cols = {t: len(v[0][0]) for t, v in payload.items()}
    cal_rows, cal_plan = caltab.build(runs)
    over_rows, over_plan = calover.build(cal_plan["stats"])
    cov_rows, cov_plan = covtab.build(corpus)
    gap_rows, gap_plan = covtab.gaps_build(corpus)
    fln_rows, fln_plan = flntab.build(cal_rows, cal_plan)
    map_rows, map_plan = skillmap.build(skillmap.load(SKILLSMAP_JSON),
                                       cal_plan["onsets"])
    fde_rows, fde_plan = fdetab.build(all_books, breaks)
    rev_rows, rev_plan = reviewtab.samples_review()
    qa_rows, qa_plan = reviewtab.qa_checklist()
    cols.update({"All Segments + SLOs": 15, "FDE Syllabus": 10,
                 "Navigation": navtab.N_COLS,
                 "Samples Review": rev_plan["n_cols"],
                 "QA Checklist": qa_plan["n_cols"],
                 "Skill Taxonomy": 7, "Pipeline Stages": 6,
                 "Teaching Calendar": cal_plan["n_cols"],
                 "Calendar (overview)": over_plan["n_cols"],
                 "Coverage Map": cov_plan["n_cols"],
                 "Coverage — gaps": gap_plan["n_cols"],
                 "FLN Coverage": fln_plan["n_cols"],
                 "Skills Map": map_plan["n_cols"]})
    heights = {t: len(v[0]) + 2 for t, v in payload.items()}
    heights.update({"Teaching Calendar": len(cal_rows),
                    "Calendar (overview)": len(over_rows),
                    "Coverage Map": len(cov_rows),
                    "Coverage — gaps": len(gap_rows),
                    "FLN Coverage": len(fln_rows) + 2,
                    "Skills Map": len(map_rows),
                    "FDE Syllabus": len(fde_rows),
                    "Samples Review": len(rev_rows),
                    "QA Checklist": len(qa_rows),
                    "All Segments + SLOs": len(all_rows) + 12})
    ids = sheetio.reset_tabs(svc, titles, cols, heights)

    sizes = {}                 # real size per tab, quoted by the index
    for title, (values, grade_rows, chapter_rows, omitted) in payload.items():
        subject = next(s for s, t in SUBJECT_TABS.items() if t == title)
        # The two-row title band shifts every row index down by head.
        n_days = sum(1 for v in values[1:] if str(v[0]).startswith("Day"))
        values, head = sheetio.titled(
            values, f"{title.upper()}  ·  {n_days} teaching days",
            tabs.standfirst(subject))
        sheetio.write_values(svc, title, values)
        sheetio.format_grid(
            svc, ids[title], len(values), len(values[0]),
            freeze_cols=2, head_row=head,
            banner_rows=[r + head for r in grade_rows],
            sub_banner_rows=[r + head for r in chapter_rows],
            flag_col=tabs.flag_column(subject), widths=tabs.widths(subject),
            notes=tabs.pending_notes(subject), groups=tabs.groups(subject))
        send(svc, skills.chip_requests(ids[title], values,
                                       tabs.skill_column(subject),
                                       first_row=head + 1))
        send(svc, fdefmt.omitted_requests(ids[title],
                                          [r + head for r in omitted],
                                          len(values[0])))
        sizes[title] = (len(values), len(values[0]))
        # The same number the Navigation index quotes: rows WRITTEN,
        # title row included, so the two never disagree.
        print(f"{title}: {len(values)} rows x {len(values[0])} cols")

    if only:
        return

    sheetio.write_values(svc, "FDE Syllabus", fde_rows)
    fdefmt.format_fde(svc, ids["FDE Syllabus"], fde_rows, fde_plan)
    print(f"FDE Syllabus: {len(fde_rows)} rows")

    sheetio.write_values(svc, "Teaching Calendar", cal_rows)
    calfmt.format_calendar(svc, sheetio, ids["Teaching Calendar"],
                           cal_rows, cal_plan)
    print(f"Teaching Calendar: {len(cal_rows)} rows x {cal_plan['n_cols']} cols")

    sheetio.write_values(svc, "Calendar (overview)", over_rows)
    calfmt.format_overview(svc, sheetio, ids["Calendar (overview)"],
                           over_rows, over_plan)
    print(f"Calendar (overview): {len(over_rows)} rows")

    sheetio.write_values(svc, "Coverage Map", cov_rows)
    covfmt.format_coverage(svc, sheetio, ids["Coverage Map"],
                           cov_rows, cov_plan)
    print(f"Coverage Map: {len(cov_rows)} rows x {cov_plan['n_cols']} cols")

    sheetio.write_values(svc, "Coverage — gaps", gap_rows)
    covfmt.format_coverage(svc, sheetio, ids["Coverage — gaps"],
                           gap_rows, gap_plan)
    print(f"Coverage — gaps: {len(gap_rows)} rows")

    fln, fln_head = sheetio.titled(fln_rows, flntab.TITLE, flntab.STANDFIRST,
                                   at=3)          # first unfrozen column
    sheetio.write_values(svc, "FLN Coverage", fln)
    sheetio.format_grid(svc, ids["FLN Coverage"], len(fln), fln_plan["n_cols"],
                        freeze_cols=3, head_row=fln_head, band=True,
                        banner_rows=[r + fln_head
                                     for r in fln_plan["grade_rows"]],
                        sub_banner_rows=[r + fln_head
                                         for r in fln_plan["total_rows"]],
                        widths=fln_plan["widths"])
    print(f"FLN Coverage: {len(fln)} rows x {fln_plan['n_cols']} cols")

    sheetio.write_values(svc, "Skills Map", map_rows)
    skillfmt.format_skillmap(svc, sheetio, ids["Skills Map"],
                             map_rows, map_plan)
    print(f"Skills Map: {len(map_rows)} rows x {map_plan['n_cols']} cols")

    flat, head = sheetio.titled(
        support.all_segments(all_rows),
        "ALL SEGMENTS + SLOs",
        "Every teaching day of all four subjects in one flat table — the tab "
        "to filter and sort. One row per day; no banner rows, so the filter "
        "behaves.")
    sheetio.write_values(svc, "All Segments + SLOs", flat)
    sheetio.format_grid(svc, ids["All Segments + SLOs"], len(flat), 15,
                        freeze_cols=2, head_row=head, flag_col=14, band=True,
                        # Every column that can hold a long value is sized
                        # here. A column left to the default is the bug this
                        # replaces: Chapter title and Supporting SLOs wrapped
                        # inside a narrow default and dragged a chapter-tail
                        # row — which lists every SLO code of the chapter —
                        # to twenty lines tall.
                        widths={4: 230, 7: 320, 11: 320, 12: 300, 14: 260})
    send(svc, skills.chip_requests(ids["All Segments + SLOs"], flat, 8,
                                   first_row=head + 1))

    tax, head = sheetio.titled(
        support.skill_taxonomy(
            all_rows, sum(b[2]["cpa_conflicts"] for b in all_books)),
        "SKILL TAXONOMY",
        "One Skill type column for all four subjects, CPA included rather "
        "than run in parallel. Same colour, same kind of cognitive work, "
        "whichever subject you are reading.")
    sheetio.write_values(svc, "Skill Taxonomy", tax)
    sheetio.format_grid(svc, ids["Skill Taxonomy"], len(tax), 7, freeze_cols=2,
                        head_row=head, band=True,
                        widths={0: 70, 1: 210, 4: 90, 5: 520, 6: 260})
    send(svc, skills.chip_requests(ids["Skill Taxonomy"], tax, 1,
                                   first_row=head + 1))

    pipe, head = sheetio.titled(
        support.pipeline_tab(), "PIPELINE STAGES",
        "The seven stages a teaching day passes through, and the review gate "
        "on each. The trace columns on every subject tab are named after "
        "these stages.", at=1)
    sheetio.write_values(svc, "Pipeline Stages", pipe)
    sheetio.format_grid(svc, ids["Pipeline Stages"], len(pipe), 6,
                        freeze_cols=1, head_row=head, band=True,
                        widths={0: 80, 1: 160, 2: 250, 3: 300, 4: 110,
                                5: 400})

    sheetio.write_values(svc, "Samples Review", rev_rows)
    reviewtab.format_review(svc, sheetio, ids["Samples Review"],
                            rev_rows, rev_plan)
    print(f"Samples Review: {len(rev_rows)} rows")

    sheetio.write_values(svc, "QA Checklist", qa_rows)
    reviewtab.format_review(svc, sheetio, ids["QA Checklist"],
                            qa_rows, qa_plan)
    print(f"QA Checklist: {len(qa_rows)} rows")

    # The index quotes each tab's real size, so it is built last, from what
    # was actually written rather than from what was planned.
    sizes.update({
        "Teaching Calendar": (len(cal_rows), cal_plan["n_cols"]),
        "Calendar (overview)": (len(over_rows), over_plan["n_cols"]),
        "FDE Syllabus": (len(fde_rows), 10),
        "Coverage Map": (len(cov_rows), cov_plan["n_cols"]),
        "Coverage — gaps": (len(gap_rows), gap_plan["n_cols"]),
        "FLN Coverage": (len(fln), fln_plan["n_cols"]),
        "Skills Map": (len(map_rows), map_plan["n_cols"]),
        "All Segments + SLOs": (len(flat), 15),
        "Skill Taxonomy": (len(tax), 7),
        "Pipeline Stages": (len(pipe), 6),
        "Samples Review": (len(rev_rows), rev_plan["n_cols"]),
        "QA Checklist": (len(qa_rows), qa_plan["n_cols"])})
    nav_rows, nav_plan = navtab.build(sizes)
    sheetio.write_values(svc, "Navigation", nav_rows)
    navtab.format_navigation(svc, sheetio, ids["Navigation"], nav_rows,
                             nav_plan, ids)
    sheetio.order_tabs(svc, TAB_ORDER)
    print(f"Navigation: {len(nav_rows)} rows · {total['days']} teaching days, "
          f"{total['tails']} chapter tails, "
          f"{total['introduces']} SLO-introducing days")


if __name__ == "__main__":
    main()
