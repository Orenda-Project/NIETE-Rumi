/**
 * THE DC PHASE CHIP REPEATS THE SECTION TITLE IT IS SITTING INSIDE.
 *
 * Reported by the CoS, 2026-09-23, after `dcPhase.hook` was renamed "Hook" -> "Opening" at the
 * operator's own request (*"the hook tag should be opening instead"*). The section that holds
 * the hook is ALREADY titled Opening, so page 2 of the grade 3 English render now stacks three
 * labels over one block:
 *
 *     Opening &middot; continued      <- the continuation bar (contBarHtml)
 *     Opening                         <- the DC phase chip  (movePill -> dcPhaseOf)
 *     Open with this question         <- the block's own label
 *
 * Three names for one block is the repetition the operator has objected to twice, verbatim:
 * *"why does it land twice? the name? just once should be enough, pls cut repetition"* and
 * *"the header/footer has too many lines"*.
 *
 * MEASURED BEFORE CHOOSING (the CoS asked for evidence, not a preference). Across the twenty
 * grade 3 documents in `renders/g3-ch2-trio/o1/docs/`, every phase chip printed and how it sits
 * in its section:
 *
 *     big-idea    -> "Announce"     in "Explanation"
 *     hook        -> "Opening"      in "Opening"          <- collides, 20 / 20
 *     hw          -> "Homework"     in "Homework"         <- collides, 20 / 20
 *     i-do        -> "Explain"      in "Explanation"
 *     remember    -> "Exit"         in "Check"
 *     we-do       -> "Guided"       in "We Do &middot; You Do"
 *     you-do      -> "Independent"  in "We Do &middot; You Do"
 *
 * TWO collisions, not one -- and the homework one is not today's rename, it is in every
 * document and predates it. So this is a standing class of defect that a rename would only
 * half-fix, and the second half would come back the next time a label is renamed to the
 * teacher's word for it. The rule, not the rename.
 *
 * WHAT THE RULE MAY NOT DO is remove the chip generally. On the five non-colliding phases it is
 * the only thing on the page naming the Digital-Coach move a teacher is in, which is the entire
 * reason it exists (bd-hlk39). It is suppressed where, and only where, it is a second printing
 * of the name already painted on the section bar directly above it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

/** Grade 3, with the section titles the real G1-5 documents author. */
function doc({ titles = {}, blockId = {}, lang } = {}) {
  const d = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  d.provenance.grade = 3;
  d.sections.forEach((s) => {
    if (titles[s.id]) s.title = titles[s.id];
    // the fixture is a grade 9 plan, so its homework block carries no phase id; the real G1-5
    // documents all id it `hw`, which is what makes that section's chip collide
    if (blockId[s.id] && (s.blocks || [])[0]) s.blocks[0].id = blockId[s.id];
  });
  if (lang) d.provenance.medium = lang;
  return d;
}

const build = (o = {}) =>
  buildHtml(doc(o), { docDir: path.dirname(FIXTURE), lang: o.lang || 'en' }).html;

const norm = (s) => String(s || '').replace(/&middot;/g, ' ').replace(/<[^>]*>/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The document cut into section regions: each section bar, and everything under it until the
 * next bar. `title` is the bar's own printed name with any "&middot; 15 min" suffix dropped.
 */
function regions(html) {
  const out = [];
  const re = /<div[^>]*class="bar[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  const starts = [];
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const nm = /<span class="nm">([\s\S]*?)<\/span>/.exec(m[1]);
    starts.push({ at: m.index, end: re.lastIndex, title: nm ? nm[1].split('&middot;')[0] : '' });
  }
  starts.forEach((s, i) => {
    out.push({ title: s.title, body: html.slice(s.end, i + 1 < starts.length ? starts[i + 1].at : html.length) });
  });
  return out;
}

/** The phase-chip texts printed inside one region. */
const chips = (body) => [...body.matchAll(/<span class="dct">([\s\S]*?)<\/span>/g)].map((m) => m[1]);

afterEach(() => setPageFormat('phone'));

describe('the DC phase chip never repeats the section title above it', () => {
  test('the Opening section prints "Opening" ONCE -- on the bar, not again on the block', () => {
    const r = regions(build({ titles: { introduction: 'Opening' } }))
      .find((x) => norm(x.title) === 'opening');
    expect(r).toBeTruthy();
    expect(chips(r.body).map(norm)).not.toContain('opening');
  });

  test('Homework collides the same way, and it is not today\'s rename -- it is in every document', () => {
    const r = regions(build({ titles: { homework: 'Homework' }, blockId: { homework: 'hw' } }))
      .find((x) => norm(x.title) === 'homework');
    expect(r).toBeTruthy();
    expect(chips(r.body).map(norm)).not.toContain('homework');
  });

  test('a chip that names a DIFFERENT move is kept -- it is the only thing saying which move this is', () => {
    const r = regions(build({ titles: { development: 'Explanation' } }))
      .find((x) => norm(x.title) === 'explanation');
    expect(r).toBeTruthy();
    expect(chips(r.body).map(norm)).toContain('explain');
  });

  test('the comparison is on the words, not the byte string', () => {
    // a title authored "OPENING" or "Opening!" is the same word to a reader, so it is the same
    // repetition -- case and punctuation may not be what decides whether a label prints twice
    const r = regions(build({ titles: { introduction: 'OPENING!' } }))
      .find((x) => norm(x.title) === 'opening');
    expect(chips(r.body).map(norm)).not.toContain('opening');
  });

  test('Urdu is judged on the Urdu strings, both of them', () => {
    // rule 20: the chip is آغاز on an Urdu render, so an Urdu document titling its section آغاز
    // hits exactly the same collision, and must be suppressed by the same comparison
    const r = regions(build({ lang: 'ur', titles: { introduction: 'آغاز' } }))
      .find((x) => norm(x.title) === norm('آغاز'));
    expect(r).toBeTruthy();
    expect(chips(r.body).map(norm)).not.toContain(norm('آغاز'));
  });

  test('a section whose title is untouched keeps every chip it prints today', () => {
    // the default titles ("Introduction", "Home work") collide with nothing, so nothing goes:
    // this is the regression guard on the five phases the rule must never reach
    const all = regions(build()).flatMap((x) => chips(x.body)).map(norm);
    expect(all).toContain('opening');
    expect(all).toContain('explain');
  });
});
