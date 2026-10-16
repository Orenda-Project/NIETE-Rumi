'use strict';
/**
 * The first-touch door's three replies and its one event.
 *
 *   sendChooser      the chooser (door.body + "Make quiz" / "Play"), trigger door_reply, recipient family
 *   sendFamilyReply  the family door's cta_url (/f/<token>), trigger family_reply, recipient family; a refused cta
 *                    (sent:false) → family.fallback as plain text in the SAME turn (the same one record, no second)
 *   sendMakerReply   the maker cta: the maker module's makerCta({ uid, lang, who, via }) — it records maker_reply
 *                    itself; absent or throwing → the door's own 3-button fallback through the wrapper below,
 *                    trigger maker_reply, recipient teacher
 *
 * ONE send wrapper: Ledger.record({ trigger, phone, reason, recipient, initiated:'user' }) FIRST; the send only when it
 * returned true. false = the sister's per-phone cap refused it (it already logged web_quiz.reply_capped): nothing is
 * sent. The ledger never fails open and the door adds no cap of its own. Nothing here is bot-initiated, nothing is a
 * template, no reply is a second message, and no registration invite is ever called from here.
 *
 * logDoor() emits onboard.quiz_door with EXACTLY the contract's fields — never a phone, a name, a kid, a dk, a token
 * or a code; `ukey` only through the sister's ukeyOf and only when it is set.
 */
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const Ledger = require('../quiz/message-ledger');
const FamilyToken = require('./family.token');

/**
 * The bilingual buttons (COPY v1.2 §1, `.bi` rows; ≤ 20 code points; Latin first, « · », then Urdu, so the button
 * paints left to right). Held here, not in the catalog: an Urdu-slot catalog value that opens with a Latin word must
 * open with U+200F (the catalog's paragraph-direction gate), which would turn these right to left and push
 * `Record · ریکارڈ کریں` (20/20) past Meta's cap.
 */
const BI_BUTTONS = Object.freeze({
  doorTeacher: 'Make quiz · بنائیں',      // door.btn.teacher.bi
  doorChild: 'Play · کھیلیں',             // door.btn.child.bi
  maker: 'Make quiz · بنائیں',            // maker.btn.bi (the maker module's cta button)
  family: 'Open quiz · کھولیں',           // family.btn.bi
  fallback1: 'Quiz · تیار کوئز',          // maker.fallback.btn1.bi
  fallback2: 'Plan · لیسن پلان',          // maker.fallback.btn2.bi
  fallback3: 'Record · ریکارڈ کریں',      // maker.fallback.btn3.bi
});

const IDS = Object.freeze({
  DOOR_TEACHER: 'ft_door_teacher',
  DOOR_CHILD: 'ft_door_child',
  MK_READY: 'ft_fb_quiz',
  MK_PLAN: 'ft_fb_lp',
  MK_RECORD: 'ft_fb_coach',
});

/** The maker seam. Tests set `_deps.makerCta`; unset → the maker module's own makerCta, required lazily. */
const _deps = { makerCta: undefined };
let makerMissingLogged = false;

function resolveMakerCta() {
  if (_deps.makerCta !== undefined) return _deps.makerCta;
  try {
    const mod = require('./maker.cta');   // the maker page's module; absent until it lands
    return mod && typeof mod.makerCta === 'function' ? mod.makerCta : null;
  } catch (_) {
    return null;
  }
}

/** 'ur' → the Urdu slot; 'en' → the English one ('bi' is never passed here: its values are whole keys of their own). */
const ux = (key, lang) => resolveUx(key, { language: clampLanguage(lang) });

/**
 * The one send wrapper: the ledger first, the send only when it said yes. `beforeSend` (the chooser's show count) runs
 * only for a reply that is going out. → { allowed, sent }.
 */
async function ledgered({ trigger, from, reason, recipient, send, beforeSend = null }) {
  const allowed = await Ledger.record({ trigger, phone: from, reason, recipient, initiated: 'user' });
  if (!allowed) return { allowed: false, sent: false };
  if (beforeSend) {
    try { await beforeSend(); } catch (err) { logToFile('⚠️ first-touch door: the show count was not written', { error: err.message }); }
  }
  const sent = await send();
  return { allowed: true, sent: Boolean(sent) };
}

/**
 * The chooser. lang 'ur' → door.body.ur + the Urdu buttons; 'bi' → door.body.bi + the bilingual buttons; 'en' (only
 * a person's own preferred_language) → door.body.en + the English buttons.
 * → 'chooser' | 'capped' | 'none' (the send failed).
 */
async function sendChooser({ from, lang, reason = 'text', beforeSend = null }) {
  const WhatsAppService = require('../whatsapp.service');
  const body = lang === 'bi' ? resolveUx('ftDoorBodyBi', { language: 'en' }) : ux('ftDoorBody', lang);
  const buttons = lang === 'bi'
    ? [{ id: IDS.DOOR_TEACHER, title: BI_BUTTONS.doorTeacher }, { id: IDS.DOOR_CHILD, title: BI_BUTTONS.doorChild }]
    : [{ id: IDS.DOOR_TEACHER, title: ux('ftDoorBtnTeacher', lang) }, { id: IDS.DOOR_CHILD, title: ux('ftDoorBtnChild', lang) }];
  const out = await ledgered({
    trigger: 'door_reply', from, reason, recipient: 'family', beforeSend,
    send: () => WhatsAppService.sendInteractiveButtons(from, { body, buttons }),
  });
  if (!out.allowed) return 'capped';
  return out.sent ? 'chooser' : 'none';
}

/**
 * The family reply: the cta_url to /f/<token>; a refused cta (or no link to make) → family.fallback as plain text in
 * the same turn, under the same one record. → 'family' | 'fallback' | 'capped' | 'none'.
 */
async function sendFamilyReply({ from, user, lang, reason = 'text', ukey = null }) {
  const WhatsAppService = require('../whatsapp.service');
  const bi = lang !== 'ur';
  const url = FamilyToken.familyUrl(FamilyToken.mintFamilyToken({ uid: user && user.id, lang: bi ? 'bi' : 'ur', ukey }));
  let how = 'none';
  const out = await ledgered({
    trigger: 'family_reply', from, reason, recipient: 'family',
    send: async () => {
      if (url) {
        const sent = await WhatsAppService.sendCtaUrl(from, {
          body: bi ? resolveUx('ftFamilyBodyBi', { language: 'en' }) : ux('ftFamilyBody', 'ur'),
          buttonText: bi ? BI_BUTTONS.family : ux('ftFamilyBtn', 'ur'),     // ≤ 20 code points
          url,
        });
        if (sent && sent.sent !== false) { how = 'family'; return true; }
      }
      const text = await WhatsAppService.sendMessage(from, bi ? resolveUx('ftFamilyFallbackBi', { language: 'en' }) : ux('ftFamilyFallback', 'ur'));
      how = 'fallback';
      return text;
    },
  });
  if (!out.allowed) return 'capped';
  return out.sent ? how : 'none';
}

/** The door's own 3-button fallback for the maker reply (maker_reply, recipient teacher). */
async function sendMakerFallback({ from, lang, who, reason }) {
  const WhatsAppService = require('../whatsapp.service');
  const bi = lang !== 'ur';
  // which body (COPY M4 fallback): a never-met phone → .unknown; the door's teacher key → maker.fallback.body. The
  // copy has no .bi of maker.fallback.body: a bilingual reply uses .unknown.bi (both carry the undo line).
  const body = bi
    ? resolveUx('ftMakerFallbackBodyUnknownBi', { language: 'en' })
    : ux(who === 'door' ? 'ftMakerFallbackBody' : 'ftMakerFallbackBodyUnknown', 'ur');
  const buttons = bi
    ? [{ id: IDS.MK_READY, title: BI_BUTTONS.fallback1 }, { id: IDS.MK_PLAN, title: BI_BUTTONS.fallback2 }, { id: IDS.MK_RECORD, title: BI_BUTTONS.fallback3 }]
    : [{ id: IDS.MK_READY, title: ux('ftMakerFallbackBtn1', 'ur') }, { id: IDS.MK_PLAN, title: ux('ftMakerFallbackBtn2', 'ur') }, { id: IDS.MK_RECORD, title: ux('ftMakerFallbackBtn3', 'ur') }];
  const out = await ledgered({
    trigger: 'maker_reply', from, reason, recipient: 'teacher',
    send: () => WhatsAppService.sendInteractiveButtons(from, { body, buttons }),
  });
  if (!out.allowed) return 'capped';
  return out.sent ? 'fallback' : 'none';
}

/**
 * The maker reply. who ∈ {unknown, door} (the door never sends `known`: that is the empty line's), via 'door'.
 * → 'maker' (the maker module answered) | 'fallback' | 'capped' | 'none'.
 */
async function sendMakerReply({ from, user, lang, who = 'unknown', via = 'door', reason = 'text' }) {
  const makerCta = resolveMakerCta();
  if (makerCta) {
    try {
      // the agreed call is makerCta({ uid, lang, who, via }); `phone` rides along so it can send without a lookup
      await makerCta({ uid: user && user.id, lang, who, via, phone: from });
      return 'maker';
    } catch (err) {
      logToFile('⚠️ first-touch door: the maker cta threw — the door\'s own fallback', { error: err && err.message });
    }
  } else if (!makerMissingLogged) {
    makerMissingLogged = true;
    logToFile('ℹ️ first-touch door: no maker cta module yet — the door\'s own 3-button fallback answers');
  }
  return sendMakerFallback({ from, lang, who, reason });
}

/**
 * The phone's event key: the sister's ukeyOf (web-quiz-bind.service's ukeyOf IS the repo's, re-exported; read here
 * from the repo so the door never requires the binder, which requires the ingress); null when it cannot be made.
 */
function ukeyFor(from) {
  try {
    const BindRepo = require('../quiz/child-phone-bindings.repo');
    return BindRepo.ukeyOf(BindRepo.normalisePhone(from)) || null;
  } catch (_) {
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The users row is at most 24 h old (by created_at); false when unknown. */
function isNewPhone(user, now = Date.now()) {
  const t = user && user.created_at ? new Date(user.created_at).getTime() : NaN;
  return Number.isFinite(t) && now - t <= DAY_MS;
}

/** onboard.quiz_door, once per decided door turn, with exactly the contract's fields. */
function logDoor({ from, user, door, verdict = 'unknown', reason = 'no_key', store = 'none', reply, tap = 'none', lang, script = 'none' }) {
  const ukey = ukeyFor(from);
  logEvent('onboard.quiz_door', {
    door, verdict, reason, new_phone: isNewPhone(user), store, reply, tap, lang, script,
    ...(ukey ? { ukey } : {}), w: 's',
  });
}

module.exports = {
  BI_BUTTONS, IDS, _deps,
  sendChooser, sendFamilyReply, sendMakerReply, logDoor, ukeyFor, isNewPhone,
};
