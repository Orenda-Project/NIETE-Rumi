/**
 * v24 review, picture boxes (G5 board pattern), each through the real chain
 * applyLayout → normaliseScheme → renderPaper / renderMarkingScheme.
 *
 *   1. The key's cover box "Teacher: before the exam" says to add the picture/diagram
 *      BEFORE photocopying. Today step 2 is Photocopy and step 3 is "You add", so a
 *      teacher following them in order adds the picture to every copy.
 *   2. G5 Urdu C.Q7 and G5 English C.Q10 get a generated plain black-outline scene
 *      (the model writes an English `describe_en`; fde-pictures draws it as a scene).
 *      The image prints INSIDE the frame, the "pasted or drawn" title goes, and the
 *      "You add: the picture" / supplies line goes. A failed drawing never fails the
 *      paper: the item keeps today's empty frame (fallback, not fail-closed).
 *   3. Science A.Q1b stays teacher-supplied; its `question` must be the diagram's NAME,
 *      so one starting "Label / Draw / Name" is held and re-asked.
 *
 * Pure: HTML strings, injected picture deps, no network. Fictional fixtures only.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Pictures = require('../../bot/shared/services/assessment/fde-pictures');
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');

const NOW = '2026-10-29T07:00:00.000Z';
const P = Patterns.get('fde_g5_2027').subjects;
const SRC = 'data:image/png;base64,AAAA';
const URDU_TITLE = 'تصویر (استاد چسپاں کریں یا بنائیں)';
const EN_TITLE = 'Picture (pasted or drawn by the teacher)';
const NO_PICTURES = 'The paper carries no pictures.';

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
const EN_FIXTURE = 'r26-english-staging-laid';

function laid(raw, subject) {
  return normaliseScheme(applyLayout(raw, P[subject], { kind: 'fde' }, { now: NOW }).examJson).examJson;
}
const paperOf = (exam, subject) => R.renderPaper({ examJson: exam, grade: 5, subject, answerLines: true, allowShort: true });
const schemeOf = (exam, subject) => R.renderMarkingScheme({ examJson: exam, grade: 5, subject, allowShort: true });

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

// The element starting at `from` (an opening <div>), up to its own closing tag.
function elementAt(html, from) {
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = from;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(from, re.lastIndex);
  }
  return html.slice(from);
}

const beforeBox = (scheme) => { const i = scheme.indexOf('<div class="box before">'); return visible(scheme.slice(i, scheme.indexOf('</ol>', i))); };
const suppliesBox = (scheme) => { const i = scheme.indexOf('<div class="box supplies">'); return i < 0 ? '' : visible(scheme.slice(i, scheme.indexOf('</ul>', i))); };
const frameOf = (paper) => elementAt(paper, paper.indexOf('<div class="frame"'));

function itemAt(exam, slot) {
  for (const types of Object.values(exam.unseen || {})) {
    for (const list of Object.values(types || {})) {
      const q = (list || []).find((x) => x && x.slot === slot);
      if (q) return q;
    }
  }
  return null;
}

// The image deps of fde-picture-place.test.js: an in-memory store, prompts captured.
function deps({ fail = false } = {}) {
  const prompts = [];
  const store = {};
  return {
    prompts,
    d: {
      headObject: async (key) => ({ exists: key in store }),
      downloadFromR2: async (key) => store[key],
      uploadBuffer: async (buf, key) => { store[key] = buf; },
      generateImage: async (prompt) => { prompts.push(prompt); if (fail) throw new Error('image model down'); return Buffer.from('png'); },
      shrink: async (buf) => buf,
      gray: async () => ({ data: new Uint8Array(100).fill(255), width: 10, height: 10 }),
      sleep: async () => {},
      log: () => {},
    },
  };
}

function prompt(subject, sectionId) {
  const S = P[subject];
  const section = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({ grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20',
    section, slots: section.slots, lang: S.medium, P: S, scope: { kind: 'fde', chapters: null, pages: null } });
}

describe('1. the cover box says add the picture before photocopying', () => {
  it('Science: "You add: the diagram to label" comes before "Photocopy the question paper"', () => {
    const box = beforeBox(schemeOf(laid(fixture('science'), 'science'), 'science'));
    const add = box.indexOf('the diagram to label');
    expect(add).toBeGreaterThanOrEqual(0);
    expect(add).toBeLessThan(box.indexOf('Photocopy the question paper'));
  });

  it('Urdu: «شامل کریں: تصویر» comes before «فوٹو کاپی»', () => {
    const box = beforeBox(schemeOf(laid(fixture('urdu'), 'urdu'), 'urdu'));
    const add = box.indexOf('تصویر');
    expect(add).toBeGreaterThanOrEqual(0);
    expect(add).toBeLessThan(box.indexOf('فوٹو کاپی'));
  });

  it('English: "You add: the picture" comes before "Photocopy the question paper"', () => {
    const box = beforeBox(schemeOf(laid(fixture(EN_FIXTURE), 'english'), 'english'));
    const add = box.indexOf('the picture');
    expect(add).toBeGreaterThanOrEqual(0);
    expect(add).toBeLessThan(box.indexOf('Photocopy the question paper'));
  });

  it('control: Maths (no frame) keeps its box exactly as today', () => {
    const box = beforeBox(schemeOf(laid(fixture('maths'), 'maths'), 'maths'));
    expect(box).toBe(' Teacher: before the exam This is the marking scheme for the question paper. Do not give it to children. '
      + 'Photocopy the question paper, every page, one per child. Tell the class: Section A on the question paper; '
      + 'Sections B and C on the answer sheet; Q2: attempt any 8 of 12; Q4–Q8: attempt any 3 of 5. Time: 3 hrs. '
      + 'Mark question by question across all copies, not copy by copy. ');
  });
});

describe('2. Urdu Q7 and English Q10 print a generated scene inside the frame', () => {
  const withPicture = (raw, subject, slot) => {
    const exam = laid(raw, subject);
    itemAt(exam, slot).picture = { kind: 'scene', describe: 'a school sports day', src: SRC };
    return exam;
  };

  it('Urdu Q7: the image is inside the frame and the "teacher pastes or draws" title is gone', () => {
    const frame = frameOf(paperOf(withPicture(fixture('urdu'), 'urdu', 'urdu.C.Q7'), 'urdu'));
    expect(frame).toContain(`<img src="${SRC}"`);
    expect(visible(frame)).not.toContain(URDU_TITLE);
  });

  it('English Q10: the image is inside the frame and the "pasted or drawn" title is gone', () => {
    const frame = frameOf(paperOf(withPicture(fixture(EN_FIXTURE), 'english', 'english.C.Q10'), 'english'));
    expect(frame).toContain(`<img src="${SRC}"`);
    expect(visible(frame)).not.toContain(EN_TITLE);
  });

  it('Urdu Q7 with a picture: the key no longer asks the teacher to add one (cover box and supplies box)', () => {
    const scheme = schemeOf(withPicture(fixture('urdu'), 'urdu', 'urdu.C.Q7'), 'urdu');
    expect(beforeBox(scheme)).not.toContain('شامل کریں: تصویر');
    expect(suppliesBox(scheme)).not.toContain('تصویر:');
  });

  it('English Q10 with a picture: no "You add: the picture" and no "Picture:" supply line', () => {
    const scheme = schemeOf(withPicture(fixture(EN_FIXTURE), 'english', 'english.C.Q10'), 'english');
    expect(beforeBox(scheme)).not.toContain('You add: the picture');
    expect(suppliesBox(scheme)).not.toContain('Picture:');
  });

  it('control: without a picture the frame still prints its empty box, title and word bank', () => {
    const paper = paperOf(laid(fixture(EN_FIXTURE), 'english'), 'english');
    expect(visible(frameOf(paper))).toContain(EN_TITLE);
    expect(frameOf(paper)).not.toContain('<img');
    expect(visible(paper)).toContain('swing');
  });

  it('the Urdu Q7 and English Q10 prompt rules ask for an English `describe_en` scene', () => {
    const slotOf = (subject, slot) => P[subject].sections.flatMap((s) => s.slots).find((s) => s.slot === slot);
    expect(slotOf('urdu', 'urdu.C.Q7').prompt_rule).toContain('`describe_en`');
    expect(slotOf('english', 'english.C.Q10').prompt_rule).toContain('`describe_en`');
  });

  it('the Urdu C and English C section prompts ask for describe_en and drop "The paper carries no pictures."', () => {
    for (const subject of ['urdu', 'english']) {
      const text = prompt(subject, 'C');
      expect(text).toContain('describe_en');
      expect(text).not.toContain(NO_PICTURES);
    }
  });

  it('control: Science A still tells the model the paper carries no pictures', () => {
    expect(prompt('science', 'A')).toContain(NO_PICTURES);
  });

  it('resolveFramePictures draws describe_en as a scene and sets picture.src on Urdu Q7', async () => {
    const exam = laid(fixture('urdu'), 'urdu');
    itemAt(exam, 'urdu.C.Q7').describe_en = 'children running a race on a school field with flags';
    const x = deps();
    await Pictures.resolveFramePictures(exam, x.d);
    const q = itemAt(exam, 'urdu.C.Q7');
    expect(q.picture).toEqual(expect.objectContaining({ kind: 'scene', describe: 'children running a race on a school field with flags' }));
    expect(q.picture.src).toMatch(/^data:image\//);
    expect(x.prompts.some((p) => p.includes('children running a race'))).toBe(true);
    expect(Pictures.cacheKey(q.picture)).toContain('children-running-a-race');
  });

  it('a failed drawing does not fail the paper: no picture, and today\'s empty frame and "You add" line print', async () => {
    const exam = laid(fixture('urdu'), 'urdu');
    itemAt(exam, 'urdu.C.Q7').describe_en = 'children running a race on a school field';
    await expect(Pictures.resolveFramePictures(exam, deps({ fail: true }).d)).resolves.toBeDefined();
    expect(itemAt(exam, 'urdu.C.Q7').picture).toBeUndefined();
    const paper = paperOf(exam, 'urdu');
    expect(visible(frameOf(paper))).toContain(URDU_TITLE);
    expect(beforeBox(schemeOf(exam, 'urdu'))).toContain('تصویر');
  });

  it('guard (needs the new function): an item with no describe_en gets no picture and the image model is never called', async () => {
    const exam = laid(fixture('urdu'), 'urdu');
    const x = deps();
    await Pictures.resolveFramePictures(exam, x.d);
    expect(itemAt(exam, 'urdu.C.Q7').picture).toBeUndefined();
    expect(x.prompts).toEqual([]);
  });
});

describe('3. Science Q1(b) frame title is the diagram\'s name, never an instruction', () => {
  const withQuestion = (question) => {
    const raw = fixture('science');
    itemAt(raw, 'science.A.Q1b').question = question;
    return applyLayout(raw, P.science, { kind: 'fde' }, { now: NOW });
  };

  it.each([
    'Label any five parts of the human respiratory system.',
    'Draw and label the parts of a flower.',
    'Name the parts of the human heart.',
  ])('"%s" is held and the slot re-asked (shortfall)', (question) => {
    const r = withQuestion(question);
    expect(r.shortfall).toEqual(expect.arrayContaining([expect.objectContaining({ slot: 'science.A.Q1b', missing: 1 })]));
    expect(visible(paperOf(normaliseScheme(r.examJson).examJson, 'science'))).not.toContain('Diagram: Label any');
  });

  it('control: a diagram name ("Human respiratory system") is printed, not held', () => {
    const r = withQuestion('Human respiratory system');
    expect(r.shortfall.filter((f) => f.slot === 'science.A.Q1b')).toEqual([]);
    expect(visible(paperOf(normaliseScheme(r.examJson).examJson, 'science'))).toContain('Human respiratory system');
  });
});
