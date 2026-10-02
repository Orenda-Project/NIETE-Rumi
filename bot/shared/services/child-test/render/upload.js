/**
 * Child-test stimulus — R2 keys, upload, presign (bd-s1oo0.2).
 *
 * Layout (CONTRACT §4): child-test/stimulus/v1/g{grade}/{form}/{block}/{n}.png, n from 1 in send
 * order, plus {block}/manifest.json naming each card's part. The fallback cards (letters, words)
 * sit beside them under {block}-fallback/.
 *
 * A stimulus is ALWAYS sent through a presigned URL. The staging build sent R2's private address
 * and every image failed with HTTP 400 while the handler carried on (design review §1), and
 * r2.getPresignedUrl() itself returns the bare address when signing fails — so presignStimulus
 * checks for a signature and throws, which lets the sender fall back to text and log it.
 */

const r2 = require('../../../storage/r2');

const BLOCK_RE = /^(urdu|english|maths)$/;

function stimulusKey({ grade, form, block, n, variant = 'main' }) {
  if (!BLOCK_RE.test(String(block))) throw new Error(`child-test stimulus: bad block "${block}"`);
  if (!/^[35]$/.test(String(grade))) throw new Error(`child-test stimulus: bad grade "${grade}"`);
  if (!/^[A-Z]$/.test(String(form))) throw new Error(`child-test stimulus: bad form "${form}"`);
  const dir = variant === 'fallback' ? `${block}-fallback` : block;
  const tail = n === 'manifest' ? 'manifest.json' : `${Number(n)}.png`;
  if (n !== 'manifest' && !(Number(n) >= 1)) throw new Error(`child-test stimulus: bad card number "${n}"`);
  return `child-test/stimulus/v1/g${grade}/${form}/${dir}/${tail}`;
}

/**
 * @param {{grade:number, form:string, block:string, variant?:string, cards:Array<{part:string, png:Buffer, widthPx?:number, heightPx?:number}>, itemBankVersion?:string}} a
 * @returns {Promise<{keys: string[], manifestKey: string}>}
 */
async function uploadInlineCards({ grade, form, block, variant = 'main', cards, itemBankVersion = null }) {
  if (!Array.isArray(cards) || cards.length === 0) throw new Error('child-test stimulus: no cards to upload');
  const keys = [];
  for (let i = 0; i < cards.length; i++) {
    const key = stimulusKey({ grade, form, block, n: i + 1, variant });
    await r2.uploadBuffer(cards[i].png, key, 'image/png');
    keys.push(key);
  }
  const manifestKey = stimulusKey({ grade, form, block, n: 'manifest', variant });
  const manifest = {
    version: 'child-test-stimulus-v1',
    itemBankVersion,
    grade: Number(grade), form, block, variant,
    cards: cards.map((c, i) => ({ n: i + 1, key: keys[i], part: c.part, widthPx: c.widthPx || null, heightPx: c.heightPx || null })),
    renderedAt: new Date().toISOString(),
  };
  await r2.uploadBuffer(Buffer.from(JSON.stringify(manifest, null, 1)), manifestKey, 'application/json');
  return { keys, manifestKey };
}

/** @returns {Promise<string>} a signed GET url; throws if it could not be signed. */
async function presignStimulus(key, expiresIn = 900) {
  const url = await r2.getPresignedUrl(r2.buildR2PublicUrl(key), expiresIn);
  if (!url || !url.includes('X-Amz-Signature')) throw new Error(`child-test stimulus: could not presign ${key}`);
  return url;
}

module.exports = { stimulusKey, uploadInlineCards, presignStimulus };
