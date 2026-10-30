/**
 * Round 6 loop 2 Urdu panel (bd-5jmnfj.4.58.9.3): the G1 poem's fifth question asked the child to name a hamd
 * («اللہ تعالیٰ کی تعریف والی نظم کو کیا کہتے ہیں؟») — religious wording the model composed, not the poem's — and
 * G1/G2 poem asks printed the next question's answer («خوشبو», «پیڑ», «گیت»).
 */
const A = '../../bot/shared/services/assessment/';
const { urduOralBad } = require(`${A}fde-early-urdu-oral`);

const G1 = 'پیڑ اور پودے، شاخوں پہ پتے\nپھول اور خوشبو، ہر سو جو پھیلے\nسب کو بنایا میرے خدا نے\nہر ایک جانے ہر ایک مانے';
const G2 = 'صبح سویرے میں جب اٹھوں\nچھوڑ کے بستر باغ میں پہنچوں\nشاخ پہ کھلتے پھول کو دیکھوں\nننھی چڑیاں مجھ سے پہلے\nپیڑ پہ بیٹھی گیت سہانے\nکتنی خوشی سے گائیں مل کے';
const reasons = (items, script) => urduOralBad('poem', items, script).map((f) => f.reason);

describe('S10 poem asks carry no religious wording the poem does not print', () => {
  it('flags «اللہ تعالیٰ» and «حمد» in an ask or answer when the poem does not print them', () => {
    const items = [{ ask: 'اللہ تعالیٰ کی تعریف والی نظم کو کیا کہتے ہیں؟', answer: 'حمد' }];
    expect(reasons(items, G1)).toContain('religious-not-in-poem');
  });
  it('flags «نماز» in an answer', () => {
    expect(reasons([{ ask: 'بچہ صبح اٹھ کر کیا کرتا ہے؟', answer: 'نماز پڑھتا ہے' }], G2)).toContain('religious-not-in-poem');
  });
  it('lets the poem\'s own «خدا» through', () => {
    expect(reasons([{ ask: 'سب کو کس نے بنایا؟', answer: 'میرے خدا نے' }], G1)).not.toContain('religious-not-in-poem');
  });
  it('lets a plain ask through (the G1 script itself is a hamd, so only religious-poem is raised, round 4)', () => {
    expect(reasons([{ ask: 'شاخوں پر کیا ہوتے ہیں؟', answer: 'پتے' }], G1)).toEqual(['religious-poem']);
  });
});

describe('S11 no poem ask prints a poem word another answer is for', () => {
  it('flags G1: Q4 prints «خوشبو», the answer Q3 asks for', () => {
    const items = [
      { ask: 'پھول کے ساتھ اور کیا ہر طرف پھیلتا ہے؟', answer: 'پھول کے ساتھ خوشبو ہر طرف پھیلتی ہے۔' },
      { ask: 'خوشبو کہاں تک پھیلتی ہے؟', answer: 'ہر سو' },
    ];
    expect(reasons(items, G1)).toContain('gives-away');
  });
  it('flags G2: Q4 prints «پیڑ», the answer Q3 asks for', () => {
    const items = [
      { ask: 'ننھی چڑیاں بچے سے پہلے کہاں بیٹھی ہوتی ہیں؟', answer: 'ننھی چڑیاں پیڑ پر بیٹھی ہوتی ہیں۔' },
      { ask: 'ننھی چڑیاں پیڑ پر بیٹھ کر کیا کرتی ہیں؟', answer: 'گیت گاتی ہیں' },
    ];
    expect(reasons(items, G2)).toContain('gives-away');
  });
  it('passes asks whose answers stay unsaid', () => {
    const items = [
      { ask: 'بچہ بستر چھوڑ کر کہاں پہنچتا ہے؟', answer: 'باغ میں' },
      { ask: 'بچہ شاخ پر کیا دیکھتا ہے؟', answer: 'کھلتا پھول' },
      { ask: 'چڑیاں کس طرح گاتی ہیں؟', answer: 'خوشی سے مل کر' },
    ];
    expect(reasons(items, G2)).not.toContain('gives-away');
  });
});
