'use strict';

/**
 * Round 10 (the reviewers' 6 Nov list), their corrections to the shorter lines: the island line («جزیرہ», not «جائزہ»);
 * the English letter-names "your turn" keeps that Jugnu only listens; the no-voice line says «ہر جواب» (not «دوبار»,
 * "twice"); and one word for "press" in every Urdu line, «دبائیں» (no «کلک کریں», no «ٹچ کریں»). Each new line is said in
 * the served batteries with the clip key its words hash to and that clip on disk in every set the router can serve; the
 * old words are said nowhere.
 */

const fs = require('fs');
const path = require('path');
const { audioKey } = require('../../shared/services/child-test/sa/reviewed-lines');
const { applySwitches } = require('../../../dashboard/routes/sa-battery-switches');

const SA_DATA = path.join(__dirname, '../../shared/data/child-test/sa');
const SA_CLIPS = path.join(__dirname, '../../../dashboard/sa');
const served = fs.readdirSync(SA_DATA)
  .filter((f) => /^sa\..+\.(en|ur)\.json$/.test(f))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(SA_DATA, f), 'utf8'))]);
const said = (obj, lang, t) => JSON.stringify(obj).includes(`"text":${JSON.stringify(t)},"audio":"${audioKey(lang, t)}"`);
const saysText = (obj, t) => JSON.stringify(obj).includes(JSON.stringify(t));
const clipsMissing = (lang, t) => ['v1', 'v2', 'v4'].filter((set) => !fs.existsSync(path.join(SA_CLIPS, set, audioKey(lang, t).replace('sa/v1/', ''))));

// [lang, the words before, the words now]
const CHANGED = [
  ["ur", "آپ کا جائزہ اس فون پر محفوظ ہے۔ انٹرنیٹ آتے ہی چلا دیا جائے گا۔",
   "آپ کا جزیرہ اس فون پر محفوظ ہے۔ انٹرنیٹ آتے ہی چلا دیا جائے گا۔"],
  ["en", "Now it is your turn to say the name of each letter.",
   "Now it's your turn. Say the name of each letter. Jugnu will just listen."],
  ["ur", "پڑھنا مشکل لگے؟ تو اسٹار کو ٹچ کریں۔",
   "پڑھنا مشکل لگے؟ تو اسٹار کو دبائیں۔"],
  ["ur", "ایک ایک کر کے حروف آئیں گے۔ ہر حرف کی آواز بولیں، نام نہیں۔ کسی حرف کی آواز نہ آتی ہو تو \"آگے\"کے بٹن کو ٹچ کریں۔",
   "ایک ایک کر کے حروف آئیں گے۔ ہر حرف کی آواز بولیں، نام نہیں۔ کسی حرف کی آواز نہ آتی ہو تو \"آگے\" کے بٹن کو دبائیں۔"],
  ["ur", "اس قطار میں ایک نمبر غائب ہے۔ خالی خانے میں کون سا نمبر آئے گا؟ اسے کلک کریں۔",
   "اس قطار میں ایک نمبر غائب ہے۔ خالی خانے میں کون سا نمبر آئے گا؟ اسے دبائیں۔"],
  ["ur", "ایک ایک کر کے حروف آئیں گے۔ ہر حرف کا نام بولیں، جیسے: \"بے\"۔ کوئی حرف نہ آتا ہو تو \"آگے\" کو ٹچ کریں۔",
   "ایک ایک کر کے حروف آئیں گے۔ ہر حرف کا نام بولیں، جیسے: \"بے\"۔ کوئی حرف نہ آتا ہو تو \"آگے\" کو دبائیں۔"],
  ["ur", "اب بڑے نمبر کو کلک کرنے کی آپ کی باری ہے۔",
   "اب بڑے نمبر کو دبانے کی آپ کی باری ہے۔"],
  ["ur", "ان دو نمبروں کو دیکھیں۔ جو نمبر بڑا ہے، اسے کلک کریں۔",
   "ان دو نمبروں کو دیکھیں۔ جو نمبر بڑا ہے، اسے دبائیں۔"],
  ["ur", "ایک ایک کر کے حروف آئیں گے۔ ہر حرف کا نام بولیں اس کی آواز نہیں۔ حرف اونچی آواز میں بولیں، اگر کوئی حرف نہ آتا ہو تو \"آگے\" کو ٹچ کریں۔",
   "ایک ایک کر کے حروف آئیں گے۔ ہر حرف کا نام بولیں اس کی آواز نہیں۔ حرف اونچی آواز میں بولیں، اگر کوئی حرف نہ آتا ہو تو \"آگے\" کو دبائیں۔"],
  ["ur", "اب غائب نمبر کو کلک کرنے کی آپ کی باری ہے۔",
   "اب غائب نمبر کو دبانے کی آپ کی باری ہے۔"],
  ["ur", "ایک ایک کر کے حروف آئیں گے۔ ہر حرف کی آواز بولیں، نام نہیں۔ جیسے: ب ... \"بَ\"! کسی حرف کی آواز نہ آتی ہو تو \"آگے\"کے بٹن کو ٹچ کریں۔",
   "ایک ایک کر کے حروف آئیں گے۔ ہر حرف کی آواز بولیں، نام نہیں۔ جیسے: ب ... \"بَ\"! کسی حرف کی آواز نہ آتی ہو تو \"آگے\" کے بٹن کو دبائیں۔"],
  ["ur", "کیا جگنو کی آواز آ رہی ہے؟ جگنو جس تصویر کا نام لے، اس پر کلک کریں!",
   "کیا جگنو کی آواز آ رہی ہے؟ جگنو جس تصویر کا نام لے، اسے دبائیں!"],
  ["ur", "ایک ایک کر کے الفاظ آئیں گے۔ ہر لفظ تیز آواز سے پڑھیں۔ توڑ توڑ کے مت پڑھیں، اگر کوئی لفظ نہ آتا ہو تو \"آگے\" کے بٹن کو ٹچ کریں",
   "ایک ایک کر کے الفاظ آئیں گے۔ ہر لفظ تیز آواز سے پڑھیں۔ توڑ توڑ کے مت پڑھیں، اگر کوئی لفظ نہ آتا ہو تو \"آگے\" کے بٹن کو دبائیں"],
  ["ur", "کوئی بھی نمبر لکھیں۔ لکھ لیں تو \"ہو گیا\" کو ٹچ کریں۔",
   "کوئی بھی نمبر لکھیں۔ لکھ لیں تو \"ہو گیا\" کو دبائیں۔"],
  ["ur", "اب جلدی سے حل ہونے والے کچھ سوال آئیں گے! ہر جواب کو جلدی مگر دھیان سے سمجھیں اور اس کا جواب اونچی آواز میں بولیں۔ جو جواب نہ آئے، تو\"آگے\" کے بٹن کو کلک کریں۔",
   "اب جلدی سے حل ہونے والے کچھ سوال آئیں گے! ہر جواب کو جلدی مگر دھیان سے سمجھیں اور اس کا جواب اونچی آواز میں بولیں۔ جو جواب نہ آئے، تو \"آگے\" کے بٹن کو دبائیں۔"],
];
const SILENCE = {
  from: "جگنو آپ کی آواز نہیں سن سکا۔ جواب کو دوبار اونچی آواز میں بولیں۔ آئیے یہ حصہ دوبارہ کرتے ہیں۔",
  to: "جگنو آپ کی آواز نہیں سن سکا۔ ہر جواب اونچی آواز میں بولیں۔ آئیے یہ حصہ دوبارہ کرتے ہیں۔",
};

describe('round 10: the reviewers\' corrections to the shorter lines', () => {
  test.each(CHANGED)('%s: «%s» is now said in its new words, with its clip', (lang, from, to) => {
    const mine = served.filter(([f]) => f.endsWith(`.${lang}.json`));
    expect(mine.filter(([, b]) => said(b, lang, to)).length).toBeGreaterThan(0);
    expect(mine.filter(([, b]) => saysText(b, from)).map(([f]) => f)).toEqual([]);
    expect(clipsMissing(lang, to)).toEqual([]);
  });

  test('no Urdu line says «کلک» or «ٹچ» for "press"', () => {
    const hits = [];
    for (const [f, b] of served.filter(([n]) => n.endsWith('.ur.json'))) {
      for (const m of JSON.stringify(b).matchAll(/"text":"([^"\\]*(?:\\.[^"\\]*)*)"/g)) if (/کلک|ٹچ/.test(m[1])) hits.push([f, m[1]]);
    }
    expect(hits).toEqual([]);
  });

  test('the no-voice line (sa_silence_repeat ON) says «ہر جواب», with its clip', () => {
    const [, b] = served.find(([f]) => f.endsWith('.ur.json'));
    const line = applySwitches(b, { silenceRepeat: true }).lines.silence_repeat;
    expect(line).toEqual({ text: SILENCE.to, audio: audioKey('ur', SILENCE.to) });
    expect(clipsMissing('ur', SILENCE.to)).toEqual([]);
  });
});
