'use strict';

/**
 * Three Urdu lines the Urdu reviewer settled in her answers (3 Nov): each is said in her words where she said, with the clip
 * key its words hash to and that clip on disk in every set the router can serve; the old words are said nowhere they were
 * replaced. The "your turn" line changes on the listening tasks only; every other task keeps its own.
 */

const fs = require('fs');
const path = require('path');
const { audioKey } = require('../../shared/services/child-test/sa/reviewed-lines');

const SA_DATA = path.join(__dirname, '../../shared/data/child-test/sa');
const SA_CLIPS = path.join(__dirname, '../../../dashboard/sa');
const served = fs.readdirSync(SA_DATA)
  .filter((f) => /^sa\..+\.ur\.json$/.test(f))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(SA_DATA, f), 'utf8'))]);
const said = (obj, t) => JSON.stringify(obj).includes(`"text":${JSON.stringify(t)},"audio":"${audioKey('ur', t)}"`);
const clipOnDisk = (t) => ['v1', 'v2', 'v4'].filter((set) => !fs.existsSync(path.join(SA_CLIPS, set, audioKey('ur', t).replace('sa/v1/', ''))));

const READY = { from: 'تیار ہو جائیں۔ شروع کریں۔', to: 'تیار ہو جائیں تو "چلیں" کا بٹن دبائیں۔' };
const LISTENING = {
  from: 'ایک مختصر کہانی سنیں۔ کہانی دو بار سنائی جائے گی۔ پھر کچھ سوال ہوں گے۔ اپنا جواب اونچی آواز میں بتائیں، اردو یا انگریزی میں۔',
  to: 'اب ایک چھوٹی سی کہانی سنیں گے۔ کہانی غور سے سنیں کیونکہ کہانی کے آخر میں کچھ سوال ہوں گے۔ اپنا جواب اونچی آواز میں چاہے اردو یا انگریزی میں بتائیں۔',
};
const YOUR_TURN = { from: 'اب آپ کی باری ہے۔ جگنو آخر تک نہیں بتائے گا کہ جواب صحیح ہے یا نہیں۔', to: 'اب کہانی سننے کی آپ کی باری ہے۔' };
const LISTENING_TASKS = ['ur.listening', 'ur.listening2', 'en.listening', 'en.listening2'];

describe('the Urdu reviewer\'s answers (3 Nov)', () => {
  test.each([['ready', READY], ['listening instruction', LISTENING]])(
    '%s: the new words are said in the served batteries, the old words nowhere, the clip is on disk',
    (_, { from, to }) => {
      expect(served.length).toBe(8);
      expect(served.filter(([, b]) => said(b, to)).length).toBeGreaterThan(0);
      expect(served.filter(([, b]) => said(b, from)).map(([f]) => f)).toEqual([]);
      expect(clipOnDisk(to)).toEqual([]);
    },
  );

  test('"your turn": the listening tasks say the story line, in every battery that has them; every other task keeps its own', () => {
    let listening = 0;
    let others = 0;
    for (const [f, b] of served) {
      for (const t of b.tasks) {
        const line = t.script && t.script.test_intro;
        if (!line) continue;
        if (LISTENING_TASKS.includes(t.id)) {
          expect([f, t.id, line.text, line.audio]).toEqual([f, t.id, YOUR_TURN.to, audioKey('ur', YOUR_TURN.to)]);
          listening += 1;
        } else if (line.text === YOUR_TURN.from) {
          others += 1;
        }
      }
    }
    expect(listening).toBeGreaterThan(0);
    expect(others).toBeGreaterThan(0);
    expect(clipOnDisk(YOUR_TURN.to)).toEqual([]);
  });
});
