"""Which page of the book a segment is actually about.

Stage C grounds a lesson on page truth and invents nothing, which makes the
choice of page the whole of the guarantee: ground a lesson on the wrong page
and every later gate — the rubric, the QA checks, the judge — is scoring a
fluent, well-formed lesson about the wrong thing.

A segment names its pages twice, as `pages_printed` (what is on the paper) and
`pages_pdf` (the index in the scan). On fourteen of the seventeen books the
two agree and either would do. On the other three they do not:

  Grade 5 Urdu has a production fault. Printed pages 130-137 are printed
  TWICE — once at the true offset of +3, and again at +13 for the Chapter 14
  tail, Chapter 15 and Chapter 16. A printed number is therefore not a key
  at all in that band: "131" names two different pages, one about a calendar
  and one about Allama Iqbal.

  Grade 4 General Science opens at an offset of 4 where its siblings sit at 3.

  The five English books carry no `pages_pdf` at all, which is benign — but
  it means the printed number is the only key, so it is also the only thing
  left to check.

So: resolve by BOTH keys, keep the page whose own `chapter.number` matches the
segment's, and when the two keys disagree SAY SO rather than pick. A page this
module cannot settle comes back as no page and a flag. That is the point — a
wrong page is silent and a missing page is not, and Stage C would rather stop
on twelve segments than ground thirteen days on the wrong chapter.

The one design decision worth stating: `by_printed` maps a number to a LIST,
always, even where the book is well behaved. A caller that special-cases the
singular is a caller that will index `[0]` into the duplicated band without
noticing, which is exactly how this got shipped the first time.

Pure on purpose — no imports, no I/O. The caller loads the page-truth files
and hands the dicts in, so the grounding rule stays testable without
credentials and without the corpus, which is restricted and not on every
machine.
"""


class Index(object):
    """The pages of one book, keyed both ways a segment might name them."""

    def __init__(self, by_pdf, by_printed, duplicated):
        self.by_pdf = by_pdf
        self.by_printed = by_printed
        self.duplicated = duplicated       # printed numbers naming >1 page


class Resolution(object):
    """The pages a segment resolved to, and everything odd about getting there.

    `resolved` is all-or-nothing on purpose: one unsettled page in a
    three-page day means the day cannot be grounded, not that it can be
    grounded from two thirds of its source. `pages` still carries what did
    resolve, because a report that only says "failed" is one nobody can act on.
    """

    def __init__(self, pages, flags, resolved):
        self.pages = pages
        self.flags = flags
        self.resolved = resolved


def chapter_of(page):
    """The chapter number a page declares, or None if it declares none.

    Front matter, dividers and the odd blank carry `chapter: null`. They
    match nothing — including a segment whose own chapter_number is missing,
    which is why this returns None rather than falling back to anything.
    """
    ch = (page or {}).get("chapter")
    return ch.get("number") if isinstance(ch, dict) else None


def index(pages):
    """Build the two lookups for one book's page truth."""
    by_pdf, by_printed = {}, {}
    for p in pages:
        pdf = p.get("pdf_page_index")
        if pdf is not None:
            by_pdf[pdf] = p
        printed = p.get("printed_page_number")
        if printed is not None:
            by_printed.setdefault(printed, []).append(p)
    return Index(by_pdf, by_printed,
                 {n for n, ps in by_printed.items() if len(ps) > 1})


def _flag(reason, printed, pdf, chapter, chose=None):
    return {"reason": reason, "printed": printed, "pdf": pdf,
            "chapter_number": chapter, "chose": chose}


def _one_page(printed, pdf, chapter, idx):
    """Settle a single page. Returns `(page, flag)`, either of which may be None."""
    pdf_page = idx.by_pdf.get(pdf) if pdf is not None else None
    printed_pages = idx.by_printed.get(printed, []) if printed is not None else []

    # A key the book does not hold is a broken reference, not a near miss:
    # the other key might still land somewhere, and landing somewhere is how
    # a typo becomes a lesson about the wrong page.
    if (pdf is not None and pdf_page is None) or \
            (printed is not None and not printed_pages):
        return None, _flag("not-in-book", printed, pdf, chapter)

    candidates = ([pdf_page] if pdf_page is not None else []) + printed_pages
    agreeing, seen = [], set()
    for p in candidates:
        if chapter_of(p) != chapter or chapter is None:
            continue
        key = p.get("pdf_page_index")
        if key not in seen:
            seen.add(key)
            agreeing.append(p)

    if not agreeing:
        return None, _flag("chapter-mismatch", printed, pdf, chapter)
    if len(agreeing) > 1:
        # Two pages of the asked-for chapter both answer to these keys. The
        # chapter cannot break the tie, so nothing may.
        return None, _flag("ambiguous", printed, pdf, chapter)

    page = agreeing[0]
    undisputed = len(printed_pages) <= 1 and (pdf_page is None
                                              or pdf_page is page)
    if undisputed:
        return page, None
    chose = "pdf" if pdf_page is page else "printed"
    return page, _flag("keys-disagree", printed, pdf, chapter, chose)


def resolve(segment, idx):
    """Resolve one segment's pages against one book's index."""
    printed = segment.get("pages_printed") or []
    pdf = segment.get("pages_pdf") or []
    chapter = segment.get("chapter_number")

    if not printed and not pdf:
        return Resolution([], [_flag("no-pages", None, None, chapter)], False)
    if pdf and len(pdf) != len(printed):
        # Zipping these would pair the second printed page with nothing and
        # call the silence agreement.
        return Resolution(
            [], [_flag("key-length-mismatch", printed, pdf, chapter)], False)

    keys = list(zip(printed, pdf)) if pdf else [(n, None) for n in printed]
    pages, flags, ok = [], [], True
    for pr, pd in keys:
        page, flag = _one_page(pr, pd, chapter, idx)
        if flag is not None:
            flags.append(flag)
        if page is None:
            ok = False
        else:
            pages.append(page)
    return Resolution(pages, flags, ok)
