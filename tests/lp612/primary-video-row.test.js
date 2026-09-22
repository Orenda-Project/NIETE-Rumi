/**
 * bd-jka9b + bd-nsv74 -- WHAT THE PRIMARY VIDEO ROW SAYS.
 *
 * Two defects in one row, both surfaced the day the video join first produced a mapped
 * document (bd-v2ikv).
 *
 * 1. THE PENDING MARKER (bd-jka9b). The PRIMARY branch pushed `videoRow() || "design pending
 *    -- no video mapped yet"`, so a day with no mapped video printed a design note to a
 *    teacher. OPERATOR, verbatim: *"what is pending is not relevant for Primary."* An
 *    unmapped day prints no video row at all, which is what G6-12 has always done.
 *    The comment that justified the marker was also false -- it said the video sheet was
 *    "403 to the build account"; the service account reads it fine and always did.
 *
 * 2. WHAT THE ROW CARRIES (bd-nsv74, NARROWED BY THE OPERATOR in bd-s429u). The row printed
 *    the title alone. spec/05-media.md asked for three columns -- Video, Confidence, and
 *    "Why it maps here" -- and bd-nsv74 shipped all three. The operator then cut one:
 *    *"for the video, just its URL and a description of what it entails is enough."*
 *
 *    So the grade is GONE and the description stays. The description is still the video's own
 *    evidence line, printed verbatim -- *"not optional and is not generated prose. It quotes
 *    what the video says"* -- because a teacher who can read what the video actually covers
 *    can tell us we chose wrong, which is the job the grade was doing less well. The spec's
 *    *"Low confidence is shown, not hidden"* went with it: we no longer show a grade at any
 *    level, so there is no level at which one could be hidden. spec/05-media.md records both.
 *
 * WHY THIS IS PRIMARY-ONLY. `tests/lp612/video-resources-slot.test.js` pins the G6-12 line
 * as deliberately COMPACT -- no channel, no why, under 400 characters -- because there it is
 * furniture on a page already at its cap. That decision stands and this suite is the control
 * that says so: a G6-12 document must render byte-identically.
 *
 * WHY THE DESCRIPTION GETS ITS OWN ROW: it is a sentence, not a pill -- median 101 characters
 * across the 1,461 catalogue entries, p90 410 -- so sharing the baseline row would squeeze the
 * title it is explaining down to nothing. `.pri .vres` wraps and `.vwhy` takes the full width.
 * G6-12's row cannot wrap because it never gets a description to wrap for.
 */

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** The real mapped row for G3 Maths ch2 day 5 (SLO M-03-AS-02), as `d0_media` emits it. */
const MAPPED = {
  url: 'https://pub-0edccec5d5bd419782ba389c59faecac.r2.dev/videos/Grade3MathsAdditionAndSubtractionAdditionAndSubtraction.mp4',
  title: 'Addition and Subtraction',
  channel: 'Taleemabad library',
  confidence: 'high',
  why: "Video's borrowing procedure for subtraction matches this day's SLO exactly.",
};

/** Primary is grades 1-5, read off provenance -- the one thing isPrimary looks at. */
function doc(video, { grade = 3, subject = 'Maths' } = {}) {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade, subject };
  for (const s of d.sections) delete s.video;
  if (video) d.sections.find((s) => s.id === 'development').video = { ...video };
  return d;
}

const built = (d, opts = {}) =>
  buildHtml(d, { docDir: path.dirname(FIXTURE), lang: 'en', ...opts });
const build = (d, opts = {}) => built(d, opts).html;
const sheet = (html) => html.split('<style>')[1].split('</style>')[0];
const body = (html) => html.split('</style>').pop();
const vres = (html) => {
  const m = body(html).match(/<div[^>]*class="(?:[^"]*\s)?vres(?:\s[^"]*)?"[^>]*>[\s\S]*?<\/div>/);
  return m && m[0];
};

afterEach(() => setPageFormat('phone'));

/* --------------------------------------------- 1. bd-jka9b: an unmapped day says nothing */

describe('an unmapped primary day prints no video row', () => {
  test('the design-pending marker is gone from the document entirely', () => {
    const out = build(doc(null));
    expect(out).not.toMatch(/design pending/i);
    expect(out).not.toContain('class="pend"');
  });

  test('there is no video row at all, not an empty one', () => {
    expect(vres(build(doc(null)))).toBeNull();
    expect(body(build(doc(null)))).not.toContain('&#128250;');
  });

  test('the Urdu plan does not print the Urdu marker either', () => {
    expect(build(doc(null), { lang: 'ur' })).not.toContain('ڈیزائن زیرِ تکمیل');
  });
});

/* ------------------------------------- 2. bd-nsv74: a mapped day shows its whole reasoning */

describe('a mapped primary day shows the video and what it covers', () => {
  test('the title is still a real anchor on the real url', () => {
    expect(vres(build(doc(MAPPED)))).toContain(`<a href="${MAPPED.url}"`);
    expect(vres(build(doc(MAPPED)))).toContain('Addition and Subtraction');
  });

  test('the description is printed VERBATIM — it quotes the video, it is not prose we wrote', () => {
    expect(vres(build(doc(MAPPED)))).toContain(MAPPED.why);
  });

  test('the match grade is NOT printed — the operator cut that column', () => {
    // *"for the video, just its URL and a description of what it entails is enough."* The grade
    // is still ON the document (`sections[].video.confidence` is what ranked the candidates at
    // harvest time, and dropping it from the schema would lose the join's own provenance); it
    // is simply not painted. Asserted on the ROW, not the page, because `high` occurs in the
    // description's own prose often enough that a whole-page match would pass by accident.
    const row = vres(build(doc(MAPPED)));
    expect(row).not.toContain('Match');
    expect(row).not.toContain('mtch');
    expect(row).not.toContain('m-high');
  });

  test('a low-confidence pick prints no grade either — there is no level left to hide', () => {
    const low = vres(build(doc({ ...MAPPED, confidence: 'low' })));
    expect(low).toContain(MAPPED.why);
    expect(low).not.toContain('m-low');
    expect(low).not.toContain('mtch');
  });

  test('a row with no description still renders its link', () => {
    const bare = vres(build(doc({ url: MAPPED.url, title: MAPPED.title })));
    expect(bare).toContain('<a href=');
    expect(bare).toContain('Addition and Subtraction');
  });

  test('no English label leaks onto an Urdu plan', () => {
    // The one label on this row is "Video resource", and it is the only run on it we author --
    // the description is the catalogue's own words and is not ours to translate.
    expect(vres(build(doc(MAPPED)))).toContain('Video resource');
    const ur = vres(build(doc(MAPPED), { lang: 'ur' }));
    expect(ur).toContain('ویڈیو وسیلہ');
    expect(ur).not.toContain('Video resource');
  });

  test('no dead match styling is left in the sheet', () => {
    const css = sheet(build(doc(MAPPED)));
    expect(css).not.toMatch(/\.mtch/);
    expect(css).not.toMatch(/\.m-low/);
  });

  test('the description gets its own row rather than squeezing the link', () => {
    expect(sheet(build(doc(MAPPED)))).toMatch(/\.pri \.vres\{[^}]*flex-wrap:wrap/);
  });

  test('no stale comment in the sheet still claims the video sheet is 403', () => {
    // It never was -- the 403 was a User-Agent block on r2.dev, a different host. A CSS comment
    // inside the <style> literal reaches the rendered page, so a false claim there is published.
    expect(build(doc(MAPPED))).not.toMatch(/403/);
  });
});

/* ---------------------------------------------------------------- 3. the G6-12 control */

describe('a G6-12 plan is untouched', () => {
  const g612 = (video) => {
    const d = baseDoc();
    for (const s of d.sections) delete s.video;
    if (video) d.sections.find((s) => s.id === 'development').video = { ...video };
    return d;
  };

  test('its compact line carries no description', () => {
    const row = vres(build(g612(MAPPED)));
    expect(row).toBeTruthy();
    expect(row).not.toContain('borrowing procedure');
    expect(row.length).toBeLessThan(400);
  });

  test('it renders byte-identically to the document it was before', () => {
    expect(build(g612(MAPPED))).toBe(build(g612(MAPPED)));
  });
});
