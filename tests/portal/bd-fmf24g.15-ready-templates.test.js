/**
 * bd-fmf24g.15 — the two WhatsApp UTILITY templates for the "ready" fallback, drafted in English and Urdu
 * (infrastructure/templates/drafts/). They are DRAFTS: nothing here submits them to Meta, and the fallback
 * that would use them is built switched off. What is held here is what Meta rejects the whole message for
 * (pre-merge Class M): every field inside its cap — measured in CODE POINTS, never `.length` — and the shape
 * Meta wants (no variable at either end of the body, one example per variable, a document header, one URL
 * button on the portal's /t/{{1}} link).
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/templates/drafts');
const FILES = ['lesson_plan_ready_v1_en', 'lesson_plan_ready_v1_ur', 'paper_ready_v1_en', 'paper_ready_v1_ur'];
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, `${f}.json`), 'utf8'));
const cp = (s) => [...s].length;
const part = (t, type) => t.components.find((c) => c.type === type);
const vars = (s) => [...s.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

describe.each(FILES)('%s', (file) => {
  const t = load(file);

  it('is a UTILITY template in en or ur, named lesson_plan_ready_v1 / paper_ready_v1', () => {
    expect(t.category).toBe('UTILITY');
    expect(['en', 'ur']).toContain(t.language);
    expect(t.name).toMatch(/^(lesson_plan|paper)_ready_v1$/);
    expect(file.endsWith(`_${t.language}`)).toBe(true);
  });

  it('body: at most 1024 code points; no variable first or last; variables 1..n in order, each with an example', () => {
    const body = part(t, 'BODY');
    expect(cp(body.text)).toBeLessThanOrEqual(1024);
    const v = vars(body.text);
    expect(v).toEqual(v.map((_, i) => i + 1));
    expect(body.text.trim().startsWith('{{')).toBe(false);
    expect(body.text.trim().endsWith('}}')).toBe(false);
    expect(body.example.body_text[0]).toHaveLength(v.length);
    expect(body.example.body_text[0].every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
  });

  it('footer: at most 60 code points, says why she got it, no variables', () => {
    const footer = part(t, 'FOOTER');
    expect(cp(footer.text)).toBeLessThanOrEqual(60);
    expect(vars(footer.text)).toEqual([]);
  });

  it('header is the PDF (a DOCUMENT) with a sample slot', () => {
    const header = part(t, 'HEADER');
    expect(header.format).toBe('DOCUMENT');
    expect(header.example.header_handle).toHaveLength(1);
  });

  it('exactly one URL button, at most 25 code points, on the portal /t/{{1}} link, with an example', () => {
    const buttons = part(t, 'BUTTONS').buttons;
    expect(buttons).toHaveLength(1);
    expect(buttons[0].type).toBe('URL');
    expect(cp(buttons[0].text)).toBeLessThanOrEqual(25);
    expect(buttons[0].url).toBe('https://portal.niete.edu.pk/t/{{1}}');
    expect(buttons[0].example).toHaveLength(1);
  });
});

describe('the pair of languages say the same thing', () => {
  it.each(['lesson_plan_ready_v1', 'paper_ready_v1'])('%s: the same variables in both', (name) => {
    const [en, ur] = ['en', 'ur'].map((l) => load(`${name}_${l}`));
    expect(vars(part(en, 'BODY').text)).toEqual(vars(part(ur, 'BODY').text));
  });

  it('the Urdu is Urdu (it carries Arabic-script letters) and the English has none', () => {
    const arabic = /[؀-ۿ]/;
    for (const f of FILES) {
      const t = load(f);
      const text = [part(t, 'BODY').text, part(t, 'FOOTER').text, part(t, 'BUTTONS').buttons[0].text].join(' ');
      expect(arabic.test(text)).toBe(t.language === 'ur');
    }
  });

  it('the vocabulary is the ontology\'s: Open in app / ایپ میں کھولیں, and the paper is a "paper" / پرچہ', () => {
    expect(part(load('paper_ready_v1_en'), 'BODY').text).toMatch(/Your paper is ready/);
    expect(part(load('paper_ready_v1_ur'), 'BODY').text).toMatch(/پرچہ/);
    expect(part(load('lesson_plan_ready_v1_ur'), 'BODY').text).toMatch(/لیسن پلان/);
    expect(part(load('lesson_plan_ready_v1_en'), 'BUTTONS').buttons[0].text).toBe('Open in app');
  });
});

describe('drafts are not submittable by accident', () => {
  it('they are not in the folder the publisher walks (publish-templates.sh takes only the top-level *.json)', () => {
    const top = fs.readdirSync(path.join(DIR, '..')).filter((f) => f.endsWith('.json'));
    for (const f of FILES) expect(top).not.toContain(`${f}.json`);
  });

  it('the document header still carries a placeholder, so Meta would refuse it as it is', () => {
    expect(part(load('paper_ready_v1_en'), 'HEADER').example.header_handle[0]).toMatch(/UPLOAD A SAMPLE PDF/);
  });
});
