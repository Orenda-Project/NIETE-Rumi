'use strict';
/**
 * Every picture on a Grade 1-2 paper gets its image before the paper is saved
 * (bd-5jmnfj.4.3). An item carries `picture: {kind, ...}`; this sets `picture.src`
 * to a data URI the renderer embeds, so the PDF needs no network.
 *
 *   dots, shapes, clock   drawn as SVG in place (fde-picture-svg)
 *   object, count, scene  read from R2, or drawn by the image model on a miss,
 *                         shrunk to a 320px grey JPEG and cached:
 *                         fde-pictures/v1/<object|scene>/<slug>.jpg
 *
 * A count is its object's picture, repeated by the renderer. A failed drawing is
 * tried once more; a second failure fails the paper PICTURE_FAILED, so a paper
 * never prints an empty box.
 */

const crypto = require('crypto');
const Svg = require('./fde-picture-svg');
const Kie = require('./fde-picture-kie');

const PREFIX = 'fde-pictures/v1';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MODEL_KINDS = ['object', 'count', 'scene'];

const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const canon = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Where an image-model picture is cached. A scene's key also hashes its whole description. */
function cacheKey(picture) {
  if (picture.kind === 'scene') {
    const hash = crypto.createHash('sha256').update(canon(picture.describe)).digest('hex').slice(0, 8);
    return `${PREFIX}/scene/${slug(picture.describe)}-${hash}.jpg`;
  }
  return `${PREFIX}/object/${slug(picture.name)}.jpg`;
}

function realDeps() {
  const R2 = require('../../storage/r2');
  const sharp = require('sharp');
  return {
    headObject: R2.headObject,
    downloadFromR2: R2.downloadFromR2,
    uploadBuffer: R2.uploadBuffer,
    generateImage: (prompt) => Kie.generateImage(prompt),
    shrink: (buf) => sharp(buf).resize(320, 320, { fit: 'inside' }).grayscale().jpeg({ quality: 80 }).toBuffer(),
  };
}

function walk(examJson, fn) {
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((examJson && examJson[branch]) || {})) {
      for (const list of Object.values(types || {})) {
        if (Array.isArray(list)) list.forEach((q) => { if (q && q.picture) fn(q); });
      }
    }
  }
}

function pictureFailed(q, err) {
  const e = new Error('A picture on the paper could not be drawn.');
  e.code = 'PICTURE_FAILED';
  e.slot = q.slot || null;
  e.kind = (q.picture && q.picture.kind) || null;
  e.cause = err.message;
  return e;
}

async function modelPicture(picture, d) {
  const key = cacheKey(picture);
  const head = await d.headObject(key);
  if (head && head.exists) return d.downloadFromR2(key);
  const prompt = Kie.promptFor(picture);
  let png;
  try {
    png = await d.generateImage(prompt);
  } catch (first) {
    png = await d.generateImage(prompt);
  }
  const jpg = await d.shrink(png);
  await d.uploadBuffer(jpg, key, 'image/jpeg', { cacheControl: CACHE_CONTROL });
  return jpg;
}

/** Sets picture.src on every item that carries a picture. Throws PICTURE_FAILED on the first it cannot draw. */
async function resolvePictures(examJson, deps = null) {
  const items = [];
  walk(examJson, (q) => items.push(q));
  if (!items.length) return examJson;
  const d = deps || realDeps();
  const drawn = new Map(); // cache key -> Promise<Buffer>, so one paper draws a picture once
  await Promise.all(items.map(async (q) => {
    try {
      const svg = Svg.svgFor(q.picture);
      if (svg) { q.picture.src = Svg.dataUri(svg); return; }
      if (!MODEL_KINDS.includes(q.picture.kind)) throw new Error(`unknown picture kind ${q.picture.kind}`);
      const key = cacheKey(q.picture);
      if (!drawn.has(key)) drawn.set(key, modelPicture(q.picture, d));
      const buf = await drawn.get(key);
      q.picture.src = `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`;
    } catch (err) {
      throw pictureFailed(q, err);
    }
  }));
  return examJson;
}

module.exports = { resolvePictures, cacheKey, PREFIX };
