/**
 * FEAT-053 bd-32 — combined-report content for the TEACHER (pure layer).
 *
 * The teacher receives the OFFICIAL MEWAKA hero report — design unchanged,
 * rendered by the existing report-v2 generateHeroReport from the FO's edited
 * analysis (v2) — plus ONE companion text carrying what was discussed in the
 * debrief and the teacher's own commitment (D32, supersedes the moment-card).
 *
 * Everything in this module is TEACHER-facing. The rules are the feature's
 * trust firewall: never the FO's critique verbatim, never accusatory, never a
 * score, never any of the coach-the-coach material (that is for the officer
 * alone, D23/D27).
 */

const SCORE_PATTERNS = [
  /\d+\s*\/\s*\d+/,
  /\d+\s*%/,
  /asilimia\s*\d+/i,
  /alama\s+\d+/i,
  /\bscore\s*[:\s]\s*\d+/i,
];

// Verdict-on-the-person phrasing that must never reach a teacher, whatever
// the model does. Mirrors the harm-gate vocabulary (bd-30).
const ACCUSATORY_PATTERNS = [
  /hujui\s+kufundisha/i,          // "you don't know how to teach"
  /darasa\s+lako\s+ni\s+chafu/i,  // "your class is filthy"
  /somo\s+(lako\s+)?(li|ni)likuwa\s+baya/i,
  /mwalimu\s+mbaya/i,
  /don'?t\s+know\s+how\s+to\s+teach/i,
];

/**
 * One gpt-5-mini pass over the recorded debrief conversation → notes the
 * TEACHER will read: what was discussed (warm) + her own commitment.
 */
/**
 * FEAT-093 bd-53 — ur/en variant of the teacher-notes prompt. The Swahili
 * prompt below is untouched. Same trust rules 1:1: the TEACHER will read
 * this; warm; never accusatory; never a score; the commitment ONLY in the
 * teacher's own words and NULL when none was spoken (never invent).
 */
function buildDebriefNotesPromptI18n(transcript, options = {}, lang = 'ur') {
  const langName = lang === 'ur' ? 'Urdu (اردو)' : 'English';
  return `A school officer (${options.foName || 'the officer'}) had a coaching conversation (debrief) with a teacher after observing their lesson. From the transcript below, write a SHORT warm note THE TEACHER WILL READ, in ${langName}.

HARD RULES (the teacher's trust depends on these):
- NEVER any number, score, percentage or grade ("40/75", "53%", "score: 2") — reject the thought entirely.
- NEVER anything accusatory or a verdict about the teacher as a person.
- "discussed_sw": 1–2 warm sentences on what the two of them actually discussed (teaching moves, not judgements), in ${langName}.
- "commitment_sw": the commitment THE TEACHER THEMSELVES SPOKE, in their own words, in ${langName} — IF AND ONLY IF they clearly made one. IF NO COMMITMENT WAS SPOKEN: commitment_sw = null. NEVER invent one — putting words in a teacher's mouth is a lie that breaks the trust this tool runs on.

Return JSON EXACTLY: { "discussed_sw": "...", "commitment_sw": "..." | null }

DEBRIEF TRANSCRIPT:
${transcript}`;
}

function buildDebriefNotesPrompt(transcript, options = {}) {
  const { foName = 'afisa' } = options;
  return `Wewe ni mwandishi wa kumbukumbu za mazungumzo ya kielimu Tanzania. Ulipewa nakala ya mazungumzo ya kujenga (debrief) kati ya afisa wa uwandani (${foName}) na mwalimu, baada ya afisa kuangalia somo la mwalimu.

MUHIMU KABISA: MWALIMU ATAISOMA kumbukumbu hii. Kila neno ni kwa ajili yake — la kumtia moyo na kumsaidia kukumbuka mliyokubaliana.

NAKALA YA MAZUNGUMZO:
${transcript}

ANDIKA (Kiswahili sanifu, joto):
- discussed_sw: sentensi 2–3 — MADA zilizozungumzwa (nini kilijadiliwa), kwa mtazamo wa kujenga. Usinukuu lawama au kauli kali za afisa; eleza mazungumzo kwa heshima.
- commitment_sw: ahadi ya mwalimu MWENYEWE — kwa maneno yake (her own words), umbo la "Nita…" — LAKINI TU kama mwalimu ALITAMKA ahadi au makubaliano ndani ya nakala. KAMA HAKUNA AHADI ILIYOTAMKWA: commitment_sw = null. KAMWE usibuni (never invent) ahadi — kumwandikia mwalimu maneno ambayo hakusema ni uongo unaovunja imani, na ni mbaya kuliko kuacha wazi.

KANUNI (kila moja ni LAZIMA):
- KAMWE hakuna alama, namba za ufaulu, asilimia, au score.
- KAMWE hakuna hukumu juu ya mwalimu ("hujui…", "darasa chafu…") — hata kama afisa alisema hivyo, kumbukumbu haiyarudii.
- Sauti: mwenzake anayemtakia mema; feedback ni zawadi.

TOA JSON yenye muundo huu HASA:
{ "discussed_sw": "...", "commitment_sw": "..." au null }`;
}

function _allNotesText(notes) {
  return [notes.discussed_sw || '', notes.commitment_sw || ''].join('\n');
}

function validateDebriefNotes(notes) {
  // bd-37: commitment is OPTIONAL — a mandatory field forces the model to
  // invent one when the teacher never spoke it (caught live: a fabricated
  // first-person pledge reached a report preview).
  if (!notes || !notes.discussed_sw) {
    throw new Error('debrief notes need discussed_sw');
  }
  const text = _allNotesText(notes);
  for (const rx of SCORE_PATTERNS) {
    if (rx.test(text)) throw new Error(`teacher-facing notes leak a score (${rx})`);
  }
  for (const rx of ACCUSATORY_PATTERNS) {
    if (rx.test(text)) throw new Error(`teacher-facing notes carry an accusatory verdict (hukumu) (${rx})`);
  }
  return true;
}

/**
 * The ONE companion message that follows the hero report image.
 * Returns null when there are no notes (debrief skipped / too thin) — the
 * report still sends on its own; an empty shell would read as broken.
 */
function buildCompanionText(notes, { foName }, S) {
  if (!notes) return null;
  validateDebriefNotes(notes);   // belt-and-braces: this text reaches a teacher
  const parts = [
    `📝 *${S.companion_from_label} ${foName}*`,
    '',
    notes.discussed_sw,
  ];
  if (notes.commitment_sw) {
    parts.push('', `🌱 *${S.companion_commitment_label}*`, `_"${notes.commitment_sw}"_`);
  }
  parts.push('', S.companion_closing);
  return parts.join('\n').slice(0, 4096);
}

module.exports = {
  buildDebriefNotesPromptI18n,
  buildDebriefNotesPrompt,
  validateDebriefNotes,
  buildCompanionText,
};
