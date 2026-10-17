'use strict';
/**
 * The child home's step timings (the bot's internal hub answer: Server-Timing, one `name;dur=<ms>` per awaited step)
 * and the page-beacon switch (app_settings web_quiz_server_timing, default off, JSON true only, 30 s cache).
 *
 * steps() is a stopwatch the hub build marks after each awaited step; header() is the header's value. The header is
 * internal (no page bytes). on() only says whether the dashboard may also put the timing in the page's boot JSON;
 * it never waits (the cached value, refreshed in the background), so the switch costs a child's page nothing.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_server_timing';
const TTL_MS = 30 * 1000;
let cache = null;
let reading = null;

const isTrue = (v) => v === true || v === 'true' || (typeof v === 'string' && (() => { try { return JSON.parse(v) === true; } catch (_) { return false; } })());

function refresh() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        cache = { at: Date.now(), on: isTrue(data && data.value) };
      } catch (err) {
        logToFile('⚠️ web quiz server timing: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
      } finally { reading = null; }
    })();
  }
  return reading;
}

function on(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) refresh().catch(() => {});
  return Boolean(cache && cache.on);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A stopwatch: mark(name) adds the time since the last mark to `name` (a name used twice adds up). */
function steps() {
  const t0 = now();
  let last = t0;
  const d = {};
  return {
    mark(name) { const t = now(); d[name] = (d[name] || 0) + (t - last); last = t; },
    header() {
      const parts = Object.keys(d).map((k) => `${k};dur=${Math.round(d[k])}`);
      parts.push(`total;dur=${Math.round(now() - t0)}`);
      return parts.join(', ');
    },
  };
}

module.exports = { on, steps, KEY, _reset: () => { cache = null; reading = null; } };
