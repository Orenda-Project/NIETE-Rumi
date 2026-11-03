'use strict';

/**
 * Two Urdu lines we wrote from the Urdu reviewer's answers (3 Nov), for her to hear before they are final: the story-reading
 * instruction keeps "read it aloud, skip a word you don't know", and the story-questions line says "answer in whichever
 * language is easier" in the gender-neutral form. Each is said with its clip key and that clip is on disk in every set the
 * router can serve; the old words are said nowhere.
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

const STORY_READING = {
  from: 'یہ ایک چھوٹی کہانی ہے۔ اسے اونچی آواز سے پڑھیں، بیچ میں نہ رُکیں۔ جو لفظ نہ آئے، اسے چھوڑ دیں۔ کہانی کے آخر میں کچھ سوال ہوں گے۔',
  to: 'اب ایک چھوٹی سی کہانی پڑھیں گے۔ کہانی بلند آواز سے پڑھیں، اور جو لفظ نہ آتا ہو اسے چھوڑ دیں۔ کہانی کے آخر میں کچھ سوال ہوں گے۔',
};
const STORY_QUESTIONS = {
  from: 'آپ نے ابھی جو کہانی پڑھی، اب اس کے بارے میں کچھ سوال ہیں۔ ہر سوال سنیں اور اپنا جواب اونچی آواز میں بتائیں۔ اردو یا انگریزی، کسی بھی زبان میں جواب دیں۔',
  to: 'آپ نے ابھی جو کہانی پڑھی، اب اس کے بارے میں کچھ سوال ہیں۔ ہر سوال سنیں اور اپنا جواب اونچی آواز میں بتائیں۔ اردو یا انگریزی، جس زبان میں آسانی ہو، اس میں جواب دیں۔',
};

describe('lines drafted from the Urdu reviewer\'s answers (3 Nov)', () => {
  test.each([['story reading', STORY_READING], ['story questions', STORY_QUESTIONS]])(
    '%s: the new words are said in the served batteries, the old words nowhere, the clip is on disk',
    (_, { from, to }) => {
      expect(served.length).toBe(8);
      expect(served.filter(([, b]) => said(b, to)).length).toBeGreaterThan(0);
      expect(served.filter(([, b]) => said(b, from)).map(([f]) => f)).toEqual([]);
      expect(clipOnDisk(to)).toEqual([]);
    },
  );
});
