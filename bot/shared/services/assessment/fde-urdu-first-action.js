'use strict';
/**
 * G5 Urdu comprehension (v37r4 g5-urdu Q2 الف 1): a «سب سے پہلے / first» stem has a one-action key. The item
 * «زینب صبح اٹھ کر سب سے پہلے کیا کرتی ہے؟» was keyed with two actions, so a child who named the first lost the
 * mark. Flags `{slot, reason:'first', items}` for a re-ask (never rewritten) when the key joins two clauses with
 * «اور» that each end in an auxiliary, or runs to two sentences. A noun pair («امی اور ابو آئے») is one action. Pure.
 */

const { eachItem } = require('./fde-urdu-walk-all');

const FIRST = /سب\s+سے\s+پہلے/u;
const AUX = /(?:ہے|ہیں|ہوں|ہو|تھا|تھی|تھے|تھیں|گا|گی|گے)$/u;
const strip = (s) => String(s || '').replace(/[۔،؟!]/g, ' ').trim();

function twoActions(answer) {
  const text = String(answer || '').trim();
  if (!text) return false;
  const sentences = text.split(/[۔؟!]/u).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > 1) return true;
  return text.split(/\s+اور\s+|\s*،\s*/u).map(strip).filter(Boolean).filter((c) => AUX.test(c.split(/\s+/).pop())).length > 1;
}

function questionsOf(q) {
  const list = [q];
  (Array.isArray(q.parts) ? q.parts : []).forEach((p) => { if (p && Array.isArray(p.questions)) list.push(...p.questions); });
  return list;
}

function firstActionShortfall(examJson) {
  const bySlot = new Map();
  eachItem(examJson, (item) => {
    questionsOf(item).forEach((q) => {
      if (!q || typeof q.question !== 'string' || !FIRST.test(q.question) || !twoActions(q.answer)) return;
      if (!bySlot.has(item.slot)) bySlot.set(item.slot, []);
      bySlot.get(item.slot).push(`${q.question.trim()} → ${String(q.answer).trim()}`);
    });
  });
  return [...bySlot].map(([slot, items]) => ({ slot, reason: 'first', items }));
}

function firstActionNote(shortfall) {
  const items = (Array.isArray(shortfall) ? shortfall : []).filter((r) => r && r.reason === 'first').flatMap((r) => r.items || []);
  if (!items.length) return '';
  return `${items.map((i) => `${i}.`).join(' ')} `
    + 'Each of these questions asks what comes "سب سے پہلے" (first) but its answer names two actions. Rewrite the answer '
    + 'as the one first action only (or ask a different question), and leave every other item unchanged.';
}

module.exports = { firstActionShortfall, firstActionNote };
