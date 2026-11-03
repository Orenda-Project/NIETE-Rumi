/**
 * bd-6clakk.11 — the oral part of an English or Urdu topic paper, to FDE's own criteria.
 * G1-2 reuse the early pattern's oral; G3-5 carry the FDE model papers' oral tasks (oral-g35.js).
 * Written from the ticked pages with the early writer's prompt. A short or failed oral drops the
 * block (logged) rather than failing the paper.
 */
const Patterns = require('../patterns');
const { makeOral } = require('../patterns/early/chrome');
const Prompt = require('../fde-early-prompt');
const { ORAL_SYSTEM } = require('../fde-early-writer');
const G35 = require('./oral-g35');

const EARLY = { 1: 'fde_g1_2026', 2: 'fde_g2_2026' };
const ORAL_SECTION = Object.freeze({ id: 'oral', slots: [] });
const NAME = { english: 'English', urdu: 'Urdu' };

function oralFor({ grade, subject }) {
  const key = Patterns.normalise(subject);
  if (!NAME[key]) return null;
  const g = Number(grade);
  if (EARLY[g]) {
    const S = Patterns.subjectOf(EARLY[g], key);
    return (S && S.oral) || null;
  }
  return G35[key][g] ? makeOral({ tasks: G35[key][g] }) : null;
}

async function writeTopicOral({ grade, subject, pageContent, requestId = null }, d) {
  const oral = oralFor({ grade, subject });
  if (!oral) return null;
  const key = Patterns.normalise(subject);
  const P = { medium: key === 'urdu' ? 'ur' : 'en', name_en: NAME[key] };
  const { model, job } = d.patternModel(d.family);
  const ownModel = d.resolveModelForJob('assessment.generate', { family: d.family }).model;
  const base = Prompt.oralPrompt({ oral, grade, P, pageContent, saidCheck: false });
  const ask = async (note) => {
    const user = note ? `${base}\n\n${note}` : base;
    const messages = d.sectionMessages({ system: ORAL_SYSTEM, user, pageContent, model });
    const reply = await d.writeSection({ messages, model, ownModel, job, pattern: 'topic_oral', section: ORAL_SECTION });
    return Prompt.oralContent(reply.tree, oral, { saidCheck: false });
  };
  try {
    let got = await ask(null);
    if (got.missing.length) {
      const next = await ask(`Last time these tasks came back without what they need: ${got.missing.join(', ')}. Write every task in full.`);
      // A task the first reply filled keeps it; the second reply fills the rest.
      const content = oral.tasks
        .map((t) => got.content.find((c) => c.id === t.id) || next.content.find((c) => c.id === t.id))
        .filter(Boolean);
      got = { content, missing: oral.tasks.map((t) => t.id).filter((id) => !content.some((c) => c.id === id)) };
    }
    if (got.missing.length) {
      d.logToFile('[assessment] topic oral dropped', { requestId, grade, subject: key, missing: got.missing });
      return null;
    }
    return { ...oral, content: got.content };
  } catch (err) {
    d.logToFile('[assessment] topic oral dropped', { requestId, grade, subject: key, error: err.message });
    return null;
  }
}

module.exports = { oralFor, writeTopicOral };
