/**
 * `محمد` OPENING ANOTHER PERSON'S NAME IS NOT A MENTION OF THE PROPHET — bd-gyrg8 (P0, 2026-09-11).
 *
 * The RELIGIOUS_MARKS gate demanded an honorific after EVERY `محمد`. Under that pressure an author
 * wrote `اشفاق احمد کے والد محمد ﷺ خان` (grade_10_urdu p1c02, the Ashfaq Ahmed chapter), and the
 * K-5 lane's deterministic repair did the same to `قائدِ اعظم محمد علی جناح` on a Grade 2 lesson
 * that reached teachers and is circulating in their groups. ﷺ on anyone but the Prophet is a
 * religious error, not a style slip — the quiz lane already learned this once (#769).
 *
 * `محمد` is the Prophet when it stands alone or inside a reverential appellation (حضرت محمد،
 * محمد مصطفیٰ، محمد رسول اللہ، محمد بن عبداللہ). It is a person when it opens a compound name
 * (محمد علی، محمد خان، محمد اقبال، محمد بن قاسم).
 *
 * Red-first: on this branch's base the first block below reports RELIGIOUS_MARKS.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

function docSaying(text) {
  const d = JSON.parse(raw);
  d.needs_human_review = true;
  d.human_review_reason = 'سیرت کا مواد۔';
  d.page2.next_period = text;
  return d;
}
const fails = (doc) => (lint(doc).fails || []).map(String);
const codes = (doc) => fails(doc).map((e) => e.split(/[\s:]/)[0]);

describe('RELIGIOUS_MARKS — a compound given name is not the Prophet', () => {
  it('does not demand ﷺ after محمد خان / محمد علی جناح / محمد بن قاسم / محمد اقبال', () => {
    const got = codes(docSaying(
      'نبی کریم ﷺ کے اسوہ کا تسلسل۔ اشفاق احمد کے والد محمد خان حیوانات کے معالج تھے۔ '
      + 'قائدِ اعظم محمد علی جناح، محمد بن قاسم اور علامہ محمد اقبال کا ذکر بھی آئے گا۔'));
    expect(got).not.toContain('RELIGIOUS_MARKS');
  });

  it('reads through aeraab — مُحَمَّد عَلی جِناح is still a person', () => {
    expect(codes(docSaying('نبی کریم ﷺ کا اسوہ۔ قائدِ اعظم مُحَمَّد عَلی جِناح نے قوم سے خطاب کیا۔')))
      .not.toContain('RELIGIOUS_MARKS');
  });

  it('still demands the honorific for the Prophet himself', () => {
    expect(codes(docSaying('حضرت محمد نے صبر کی تلقین فرمائی۔'))).toContain('RELIGIOUS_MARKS');
    expect(codes(docSaying('آپ کا نام محمد بن عبداللہ ہے۔'))).toContain('RELIGIOUS_MARKS');
    expect(codes(docSaying('محمد مصطفیٰ کا اسوہ ہمارے لیے نمونہ ہے۔'))).toContain('RELIGIOUS_MARKS');
    expect(codes(docSaying('نبی کریم ﷺ کا نام محمد ہے۔'))).toContain('RELIGIOUS_MARKS');
  });

  it('...and is satisfied once it is there', () => {
    expect(codes(docSaying('حضرت محمد ﷺ نے صبر کی تلقین فرمائی۔'))).not.toContain('RELIGIOUS_MARKS');
  });
});
