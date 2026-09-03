const { clampLanguage } = require('../../config/ux-strings');
/**
 * FEAT-053 bd-12/bd-14 — /observe user-facing strings, en/sw.
 * Follows the coaching-strings.js pattern (bd-1755): one function returning
 * the full string set for a language; chat copy localized to the user's
 * preferred language (D6 in the feature decision log).
 *
 * NOTE bd-14 will extend the why_coaching onboarding with the Swahili video +
 * a reflective conversation; the copy here is the v1 text spine it builds on.
 */

const STRINGS = {
  sw: {
    no_account: 'Samahani, sikupata akaunti yako. Tafadhali nitumie ujumbe wowote kwanza, kisha jaribu /observe tena.',
    capture_failed: 'Samahani — kumetokea hitilafu upande wangu wakati wa kuhifadhi uchunguzi huu. Rekodi yako haijapotea. Tafadhali andika /observe na uitume tena.',
    role_denied:
      'Samahani — huduma ya /observe ni ya viongozi wa shule (maafisa uwandani) kwa sasa. 💛\n\n' +
      'Kama wewe ni mwalimu, niko hapa kukusaidia: andika "menu" kuona ninachoweza kukufanyia.',
    onboard_why:
      'Karibu kwenye kazi ya ukocha, rafiki yangu. 🌱\n\n' +
      'Kabla hatujaanza, jambo moja la moyoni: kazi yako si ukaguzi — ni malezi. ' +
      'Mwalimu unayemtembelea si mtu wa kusimamiwa, ni mtu wa kusaidiwa akue. ' +
      'Wewe ni msiri wake: mtu anayemwamini, anayemsikiliza, anayemwonyesha alichokifanya vizuri — kisha anamsaidia kuona hatua MOJA ndogo ya kuboresha.\n\n' +
      'Kwa nini hili ni muhimu? Mwalimu anapokuamini, anafunguka. Anapofunguka, anajifunza. ' +
      'Anapojifunza, ufundishaji unabadilika — na hapo ndipo matokeo ya wanafunzi yanapoanza kupanda. ' +
      'Imani ya mwalimu kwako ndiyo daraja pekee la mabadiliko ya darasani.\n\n' +
      'Ukiingia darasani kesho, ingia kama mkocha — si mkaguzi. Tuko pamoja. 💛',
    onboard_functional:
      'Karibu /observe! Hivi ndivyo inavyofanya kazi:\n\n' +
      '1️⃣ Nenda darasani na urekodi somo (sauti)\n' +
      '2️⃣ Nitakuletea fomu ya MEWAKA iliyojazwa tayari — wewe hakiki na uibadilishe\n' +
      '3️⃣ Baadaye: mazungumzo ya kujenga (debrief) na mwalimu, na muhtasari kwa mwalimu',
    capture_prompt:
      '🎙 Sawa! Ukiwa darasani, bonyeza rekodi kwenye WhatsApp na urekodi somo lote (au sehemu yake — dakika 10 hadi 40).\n\n' +
      'Ukimaliza, nitumie rekodi hiyo hapa. Nitaisikiliza na kukuletea fomu ya MEWAKA iliyojazwa tayari kwa kila kiashiria — wewe utaihakiki na kuibadilisha unavyoona inafaa.',
    audio_received:
      '🎧 Nimepokea rekodi — asante! Naisikiliza sasa na kujaza fomu ya MEWAKA. Nitakutumia fomu ndani ya dakika 2–5.',
    flow_header: 'MEWAKA — rasimu',
    flow_body: 'Nimejaza fomu ya MEWAKA kutoka rekodi yako — kila kiashiria lina alama, ushahidi na ushauri. Fungua, hakiki, na ubadilishe unavyoona inafaa, kisha wasilisha.',
    flow_button: 'Fungua fomu',
    flow_fallback: 'Uchambuzi umekamilika ✅ — lakini fomu ya kuhariri bado haijawashwa kwenye mfumo huu. Wasiliana na timu ya NIETE.',
    submitted_ack: '✅ Asante! Uchunguzi wako wa MEWAKA umehifadhiwa pamoja na marekebisho yako.',
    // ── bd-21: debrief entry points ──────────────────────────────────
    debrief_choice_body:
      'Hatua inayofuata: mazungumzo ya kujenga (debrief) na mwalimu. 🌱\n\n' +
      'Nitakuandalia mwongozo mfupi wa mazungumzo — sifa za kweli, swali moja la kutafakari, na jambo MOJA la kuboresha. Je, uko tayari kuzungumza na mwalimu sasa, au baadaye?',
    btn_debrief_now: 'Debrief sasa',
    btn_debrief_later: 'Baadaye',
    debrief_later_ack:
      'Sawa kabisa — hakuna haraka. 💛 Ukiwa tayari kuzungumza na mwalimu, andika /observe na uchague uchunguzi huo kwenye orodha.',
    list_body:
      'Una mazungumzo ya kujenga (debrief) yanayosubiri. Chagua uchunguzi kuanza debrief yake, au anza uchunguzi mpya.',
    list_button: 'Chagua',
    list_section_title: 'Debrief zinazosubiri',
    list_new_observation: '🎙 Uchunguzi mpya',
    list_new_observation_desc: 'Anza uchunguzi mpya wa darasa',
    list_row_default_desc: 'Bonyeza kuanza debrief',
    // bd-2668 — who was observed (asked only when the capture was unbound)
    // bd-2675 — the tap event, the single nudge, and the honest stop
    send_tapped_fo: '✅ {name} amefungua ripoti yake.',
    send_nudged_fo: '🔔 {name} bado hajafungua ripoti — nimemkumbusha mara moja.',
    send_gave_up_fo: '{name} hajafungua ripoti. Sitamsumbua tena — mwambie akufungulie, kisha tuma tena kutoka /observe.',
    // bd-88krt — Flow terminal-screen text (data-driven so a cancel never reads
    // "Observation scheduled")
    search_no_match: 'Hakuna kilicholingana — jaribu tena',
    school_already_mine: 'Tayari kwenye orodha yako',
    school_added_heading: 'Shule imeongezwa',
    school_removed_heading: 'Shule imeondolewa',
    flow_scheduled_heading: 'Uchunguzi umepangwa',
    flow_scheduled_body: 'Bonyeza /observe wakati wowote kuona ratiba yako.',
    obs_cancelled_heading: 'Uchunguzi umeghairiwa',
    obs_cancelled_body: 'Umeondolewa kwenye orodha yako — rekodi imehifadhiwa.',
    flow_cancelled_heading: 'Ziara imeghairiwa',
    flow_cancelled_body: 'Hakuna kurekodi. Bonyeza /observe kuona ratiba yako.',
    flow_rescheduled_heading: 'Ziara imehamishwa',
    flow_rescheduled_body: 'Bonyeza /observe kuona ratiba yako mpya.',
    flow_action_failed_heading: 'Haikufanikiwa',
    flow_action_failed_body: 'Bonyeza /observe ujaribu tena.',
    who_body: 'Umemchunguza mwalimu yupi? Hii husaidia ripoti kufika kwa mtu sahihi.',
    who_button: 'Chagua mwalimu',
    who_section: 'Walimu wako',
    who_other: 'Mtu mwingine',
    who_other_desc: 'Hayupo kwenye orodha hii',
    who_ack: 'Asante — nimeandika {name}.',
    who_other_ack: 'Sawa. Utaweza kuandika jina wakati wa kutuma ripoti.',
    who_stale: 'Orodha hii imepitwa na wakati. Utaweza kuandika jina wakati wa kutuma ripoti.',
    list_send_desc_prefix: 'Tuma ripoti kwa',
    list_send_default_desc: 'Tuma ripoti kwa mwalimu',
    // ── bd-22: guided debrief ────────────────────────────────────────
    debrief_record_instruction:
      'Ukiwa na mwalimu: fungua kinasa sauti cha WhatsApp 🎙 na urekodi mazungumzo yenu yote — mwongozo utabaki hapa juu unapoirekodi.\n\n' +
      'Rekodi hiyo ni kwa AJILI YAKO tu: nitaisikiliza na kukupa maoni ya kukusaidia kukua kama mkocha. Mwalimu hataiona.',
    debrief_not_yours: 'Samahani — uchunguzi huo si wako, siwezi kufungua debrief yake.',
    debrief_already_done: '✅ Debrief ya uchunguzi huo imeshafanyika. Andika /observe kuanza uchunguzi mpya.',
    debrief_load_error: 'Samahani, sikuweza kupata uchunguzi huo sasa. Tafadhali jaribu tena baada ya dakika chache.',
    // ── bd-28: debrief recording + coach-the-coach ───────────────────
    debrief_audio_received:
      '🎧 Nimeipokea rekodi ya debrief — asante kwa kuniamini! Naisikiliza sasa; nitakutumia maoni ya kukusaidia kukua kama mkocha ndani ya dakika chache. Ni kati yangu na wewe tu. 💛',
    debrief_too_short:
      'Samahani — sikuweza kusikia mazungumzo ya kutosha kwenye rekodi hiyo. Kama debrief bado inaendelea, rekodi tena sehemu ndefu zaidi na unitumie — mwongozo bado uko hapa juu.',
    debrief_feedback_failed:
      'Nimeipokea rekodi yako, lakini nimeshindwa kuichambua sasa hivi. Andika /observe, chagua uchunguzi huo kwenye orodha, na urekodi tena — nitaisikiliza upya.',
    // bd-2kxxa.3 — transcription failed (provider outage etc.). Honest, and told
    // ONCE: the worker sweep retries by itself, so she must NOT re-record.
    debrief_processing_failed:
      'Sikuweza kuchakata rekodi hii ya debrief bado. Nitaendelea kujaribu tena mwenyewe — hakuna haja ya kurekodi upya. Kama hakuna kitu kitakachofika ndani ya saa moja, andika /observe na uchague debrief hiyo tena.',
    // bd-jrxo3 — nothing bound: start from the school, then re-send the recording.
    redirect_pick_teacher:
      'Tuanze na shule ili rekodi hii imfikie mwalimu sahihi. Chagua shule, kisha mwalimu — kisha nitumie rekodi tena.',
    // bd-tju8f — explicit binding + three-stage worklist + cancel
    bind_prompt_body: 'Nimepokea rekodi. Ni ya uchunguzi wa mwalimu gani? Chagua hapa chini — walimu waliopangwa wapo juu.',
    bind_button: '📋 Chagua mwalimu',
    bind_section_title: 'Rekodi hii ni ya nani?',
    bind_row_visit_fallback: 'Uchunguzi uliopangwa',
    bind_row_other: 'Mwalimu mwingine',
    bind_row_other_desc: 'Chagua shule na mwalimu mwenyewe',
    bind_row_debrief: '🎙 Hii ni debrief',
    bind_row_debrief_desc: 'Iunganishe na uchunguzi unaosubiri',
    bind_row_not_obs: 'Si uchunguzi',
    bind_row_not_obs_desc: 'Endelea kama ujumbe wa kawaida',
    bind_ack: '✅ Imeunganishwa na uchunguzi wa {name} — uchambuzi umeanza.',
    bind_expired: 'Rekodi hiyo haipo tena. Tafadhali itume tena.',
    bind_not_obs_ack: 'Sawa — endelea na mazungumzo ya kawaida.',
    bind_dupe_ack: 'Rekodi hii nimeshaipokea ({name}) — kazi inaendelea, hakuna haja ya kuituma tena.',
    bind_dupe_fallback_name: 'uchunguzi ule ule',
    bind_park_full: 'Jibu swali lililo hapo juu kwanza — kisha tuma rekodi inayofuata, ili rekodi yoyote isipotee.',
    capture_next_hint: 'Rekodi darasa linalofuata wakati wowote — nikilipokea nitakuuliza ni la mwalimu gani.',
    section_stage_a: '1️⃣ Kamilisha fomu',
    section_stage_b: '2️⃣ Fanya debrief',
    section_stage_c: '3️⃣ Tuma ripoti',
    list_section_new: 'Mpya',
    resume_desc_gate: 'Picha au andalio la somo linasubiri — bonyeza kukamilisha',
    resume_desc_form: 'Fomu inasubiri — bonyeza kufungua',
    resume_desc_retry: '⚠ Ilisimama — bonyeza kuanzisha tena',
    resume_desc_wait: 'Uchambuzi unaendelea — fomu itafika hivi karibuni',
    resume_retry_ack: '🔄 Nimeanzisha tena — nitakutumia fomu ikiwa tayari.',
    resume_retry_exhausted: 'Nimejaribu mara kadhaa na hauwezi kukamilika. Rekodi yako ipo salama. Kama bado una sauti, nitumie tena — nitaanzisha uchunguzi mpya.',
    watchdog_stalled_coach: '⚠️ Uchunguzi uliorekodiwa ulisimama katikati na sikuweza kuuanzisha tena. Hakuna kilichopotea — rekodi ipo salama. Nitumie sauti tena nitaanzisha uchunguzi mpya.',
    resume_wait_ack: 'Bado ninaufanyia kazi — fomu itafika hivi karibuni.',
    btn_cancel_obs: 'Futa uchunguzi',
    btn_cancel_yes: 'Ndiyo, futa',
    btn_back: 'Rudi',
    btn_open_form: 'Fungua fomu',
    btn_retry_now: 'Anzisha tena',
    btn_ok_wait: 'Sawa',
    cancel_confirm_body: 'Ufute uchunguzi huu? Utaondoka kwenye orodha yako — rekodi itabaki salama.',
    cancel_ack: '✅ Uchunguzi umefutwa.',
    cancel_too_late: 'Ripoti imeshamfikia mwalimu, kwa hiyo uchunguzi huu hauwezi kufutwa tena.',
    long_audio_no_state:
      '🎧 Nimepokea rekodi ndefu — lakini sina uchunguzi unaosubiri kwako sasa. Kama ni rekodi ya somo au ya debrief, andika /observe kwanza (na uchague uchunguzi husika), kisha nitumie rekodi tena.',
    coach_card_title: 'Mbili nzuri · moja ya kujaribu',
    coach_card_eyebrow: 'Maoni ya Ukocha · Coaching Feedback',
    coach_card_value_eyebrow: 'Thamani uliyoiishi leo · The value you lived today',
    coach_card_subtitle: 'Kutoka kwenye mazungumzo yako na mwalimu — ni kati yangu na wewe tu.',
    coach_card_wins_label: 'Ulichofanya vizuri',
    pick_teacher_body:
      'Mtumie nani ripoti? Chagua mwalimu kutoka kwenye orodha yako, au ongeza mpya.',
    pick_teacher_button: 'Chagua mwalimu',
    pick_teacher_section: 'Walimu wako',
    pick_teacher_new: '➕ Mwalimu mpya',
    pick_teacher_more: 'Walimu zaidi…',
    pick_teacher_new_desc: 'Andika jina na namba ya simu',
    leader_registered_welcome:
      'Umesajiliwa kama kiongozi wa shule. 🌱 Ukiwa tayari kumtembelea mwalimu darasani, andika /observe — nitakusaidia kuchunguza somo, kuandaa mazungumzo ya kujenga, na kumtumia mwalimu ripoti yake.\nYou are registered as a school leader. When you are ready to visit a teacher, type /observe — I will help you observe the lesson, prepare the debrief, and send the teacher their report.',
    pick_teacher_manage: '🛠 Simamia walimu',
    pick_teacher_manage_desc: 'Ondoa au sahihisha mwalimu kwenye orodha yako',
    manage_body: 'Chagua mwalimu wa kusimamia. Kuondoa hakufuti ripoti zilizotumwa — kunaondoa jina kwenye orodha yako tu.',
    manage_button: 'Chagua',
    manage_section: 'Orodha yako',
    manage_confirm_body: '{name} ({phone}) — unataka kufanya nini? Kubadilisha jina: mwandikie tena kwa namba ile ile.',
    manage_remove_btn: 'Ondoa kwenye orodha',
    manage_back_btn: 'Rudi',
    manage_removed_ack: '✅ {name} ameondolewa kwenye orodha yako.',
    coach_card_try_label: 'Jaribu hili wakati ujao',
    coach_card_closing: 'Chaguo ni lako — wewe ndiye mkocha. 🌱',
    // bd-30 — the harm gate: the officer disparaged the teacher. Honest, not congratulatory.
    coach_concern_opener:
      'Nimesikiliza mazungumzo yenu. Kuna jambo moja lazima nikuambie kwa ukweli — kwa sababu ninakujali, na kwa sababu mwalimu huyu anakutegemea. 💛',
    coach_concern_title: 'Jambo la kuzungumza kwa uwazi',
    coach_concern_closing:
      'Sikuandiki hili kukuhukumu. Kila mkocha hukosea, na mkocha bora ndiye anayeweza kusikia hili na kubadilika. Tunaanza upya kesho. 🌱',
    // ── bd-24/25/32: combined report to the teacher ──────────────────
    send_choice_body:
      'Hatua ya mwisho: kumtumia mwalimu ripoti yake — ripoti rasmi ya MEWAKA pamoja na kumbukumbu za mazungumzo yenu. Utaiona kwanza kabla haijatumwa. Je, tumtumie?',
    btn_send_report: 'Tuma ripoti',
    btn_send_later: 'Baadaye',
    send_later_ack:
      'Sawa. 💛 Ukiwa tayari, andika /observe na uchague uchunguzi huo — utaona chaguo la kutuma ripoti (📨).',
    send_ask_details:
      'Niambie jina la mwalimu na namba yake ya simu — ujumbe mmoja tu.\n\nMfano: *Bi. Zainabu, 0712 345 678*',
    send_details_reask:
      'Samahani, sikuelewa. Tafadhali andika jina NA namba ya simu ya Tanzania pamoja.\n\nMfano: *Bi. Zainabu, 0712 345 678*',
    send_preview_coming:
      'Sawa — {name} ({phone}). Naandaa ripoti yake sasa; nitakuonyesha KWANZA kabla ya kutuma. Dakika 1–2. ⏳',
    send_confirm_body:
      'Hii hapo juu ndiyo ripoti kamili atakayopokea mwalimu — ripoti rasmi ya MEWAKA pamoja na kumbukumbu za debrief yenu. Je, nitume sasa?',
    btn_send_now: 'Tuma sasa',
    btn_send_cancel: 'Ghairi',
    send_delivering: '📨 Natuma ripoti kwa mwalimu sasa. Nitakujulisha ikifika.',
    send_cancel_ack: 'Sawa — sijatuma chochote. Ukibadili mawazo, andika /observe na uchague uchunguzi huo.',
    send_already_sent: '✅ Ripoti ya uchunguzi huo imeshatumwa kwa mwalimu.',
    send_waiting_tap_info: '📨 Ripoti iko tayari — mwaliko ulitumwa kwa {name} ({date}). Bado hajaugusa; Rumi anamkumbusha, na ripoti itafika mara tu atakapobonyeza.',
    send_done_fo: '✅ Ripoti imefika kwa mwalimu. Asante kwa kazi nzuri ya ukocha! 🌱',
    // bd-2411: delivery to the teacher failed on the worker; tell the coach so it isn't a silent drop.
    send_failed_fo: '⚠️ Samahani — ripoti haikuweza kutumwa kwa mwalimu sasa hivi. Andika /observe, chagua uchunguzi huo, na ujaribu tena kutuma (📨).',
    send_template_queued_fo:
      '📨 Mwalimu hajanitumia ujumbe hivi karibuni, kwa hivyo nimemtumia mwaliko rasmi — akiubonyeza, ripoti yake itamfikia mara moja. Nitakujulisha.',
    send_operator_review_fo:
      '🔎 Ripoti imepelekwa kwa timu ya NIETE kwa ukaguzi wa mwisho (utaratibu wa majaribio). Ikithibitishwa, itamfikia mwalimu.',
    report_caption_teacher:
      'Ripoti yako ya somo 🌱 Imeandaliwa kutokana na uchunguzi wa {fo} — pamoja na kumbukumbu za mazungumzo yenu.',
    companion_from_label: 'Kutoka kwa',
    companion_commitment_label: 'Ahadi yako',
    companion_closing: 'Tunajivunia kazi yako. Tuko pamoja. 💛',
  },

  // FEAT-093 bd-53 — Urdu, authored natively (never machine-mirrored from sw/en).
  // Same trust rules: never a score to the teacher, warm and direct, second person.
  ur: {
    no_account: 'معاف کیجیے، آپ کا اکاؤنٹ نہیں ملا۔ براہ کرم پہلے رجسٹر کریں۔',
    capture_failed: 'معاف کیجیے — یہ مشاہدہ محفوظ کرتے وقت میری طرف سے مسئلہ ہوا۔ آپ کی ریکارڈنگ ضائع نہیں ہوئی۔ براہ کرم دوبارہ /observe لکھ کر بھیجیں۔',
    role_denied: 'یہ سہولت اسکول لیڈرز، سپروائزرز، کوچز اور پرنسپلز کے لیے ہے۔ اگر آپ کو یہ کردار ملنا چاہیے تو اپنی ٹیم سے رابطہ کریں۔',
    onboard_why:
      'کوچنگ کے کام میں خوش آمدید۔ 🌱\n\nشروع کرنے سے پہلے دل کی ایک بات: آپ کا کام معائنہ نہیں — پرورش ہے۔ جس استاد کے پاس آپ جاتے ہیں وہ نگرانی کے لیے نہیں، مدد کے لیے ہے۔ آپ اُن کے رازدار ہیں: جن پر وہ بھروسہ کریں، جو سنیں، جو دکھائیں کہ کیا اچھا ہوا — اور پھر بہتری کا صرف ایک چھوٹا قدم دکھائیں۔\n\nیہ کیوں اہم ہے؟ جب استاد آپ پر بھروسہ کرتے ہیں تو وہ کھلتے ہیں۔ جب وہ کھلتے ہیں تو سیکھتے ہیں۔ اور جب وہ سیکھتے ہیں تو کلاس بدلتی ہے۔\n\n🎙 تیار ہوں تو کلاس میں WhatsApp پر ریکارڈ دبائیں اور سبق ریکارڈ کریں (10 سے 40 منٹ)۔ مکمل ہونے پر ریکارڈنگ مجھے بھیج دیں۔',
    onboard_functional:
      'کوچنگ کے کام میں خوش آمدید۔ 🌱\n\n🎙 کلاس میں WhatsApp پر ریکارڈ دبائیں اور سبق ریکارڈ کریں (10 سے 40 منٹ)۔ مکمل ہونے پر ریکارڈنگ مجھے یہاں بھیج دیں۔',
    capture_prompt: '🎙 جب تیار ہوں: کلاس کا سبق ریکارڈ کر کے مجھے بھیجیں (وائس نوٹ یا فائل، دونوں چلتے ہیں)۔',
    audio_received: '🎧 ریکارڈنگ مل گئی — شکریہ! اب میں سن کر فارم بھر رہی ہوں۔ 2 سے 5 منٹ میں فارم بھیجوں گی۔',
    flow_header: 'مشاہدے کا فارم — مسودہ',
    flow_body: 'میں نے آپ کی ریکارڈنگ سے فارم بھر دیا ہے — ہر اشاریے پر اسکور، ثبوت اور مشورہ۔ کھولیں، جانچیں، جو مناسب لگے بدلیں، پھر جمع کریں۔',
    flow_button: 'فارم کھولیں',
    flow_fallback: 'فارم نہیں کھل رہا؟ دوبارہ /observe لکھیں۔',
    submitted_ack: '✅ شکریہ! آپ کا مشاہدہ آپ کی ترامیم کے ساتھ محفوظ ہو گیا۔',
    debrief_choice_body: 'اگلا قدم: استاد کے ساتھ تعمیری گفتگو (ڈی بریف)۔ 🌱\n\nمیں آپ کے لیے مختصر گفتگو کا خاکہ تیار کروں گی — سچی تعریف، غور کا ایک سوال، اور بہتری کی صرف ایک بات۔ ابھی بات کریں گے یا بعد میں؟',
    btn_debrief_now: 'ابھی ڈی بریف',
    btn_debrief_later: 'بعد میں',
    debrief_later_ack: 'ٹھیک ہے — یہ مشاہدہ /observe لکھنے پر فہرست میں ملے گا۔',
    list_body: 'آپ کی تعمیری گفتگوئیں (ڈی بریف) منتظر ہیں۔ کوئی مشاہدہ چنیں، یا نیا مشاہدہ شروع کریں۔',
    list_button: '📋 چنیں',
    list_section_title: 'منتظر ڈی بریف',
    list_new_observation: '🎙 نیا مشاہدہ',
    list_new_observation_desc: 'کلاس کا نیا مشاہدہ شروع کریں',
    list_row_default_desc: 'ڈی بریف باقی ہے',
    // bd-2668 — who was observed (asked only when the capture was unbound)
    // bd-2675 — the tap event, the single nudge, and the honest stop
    send_tapped_fo: '✅ {name} نے اپنی رپورٹ کھول لی ہے۔',
    send_nudged_fo: '🔔 {name} نے ابھی تک رپورٹ نہیں کھولی — ایک بار یاد دہانی بھیج دی ہے۔',
    send_gave_up_fo: '{name} نے رپورٹ نہیں کھولی۔ اب مزید یاد دہانی نہیں بھیجوں گی — انہیں بتا دیں، پھر /observe سے دوبارہ بھیج دیں۔',
    // bd-88krt — Flow terminal-screen text (per-language, never hardcoded)
    search_no_match: 'کچھ نہیں ملا — دوبارہ کوشش کریں',
    school_already_mine: 'پہلے سے آپ کی فہرست میں',
    school_added_heading: 'اسکول شامل ہو گیا',
    school_removed_heading: 'اسکول ہٹا دیا گیا',
    flow_scheduled_heading: 'مشاہدہ شیڈول ہو گیا',
    flow_scheduled_body: 'اپنا شیڈول دیکھنے کے لیے کبھی بھی /observe لکھیں۔',
    obs_cancelled_heading: 'مشاہدہ منسوخ ہو گیا',
    obs_cancelled_body: 'یہ آپ کی فہرست سے ہٹ گیا — ریکارڈنگ محفوظ ہے۔',
    flow_cancelled_heading: 'ملاقات منسوخ ہو گئی',
    flow_cancelled_body: 'اب کچھ ریکارڈ نہیں کرنا۔ شیڈول دیکھنے کے لیے /observe لکھیں۔',
    flow_rescheduled_heading: 'ملاقات منتقل ہو گئی',
    flow_rescheduled_body: 'نیا شیڈول دیکھنے کے لیے /observe لکھیں۔',
    flow_action_failed_heading: 'یہ کام مکمل نہیں ہوا',
    flow_action_failed_body: 'دوبارہ کوشش کے لیے /observe لکھیں۔',
    who_body: 'آپ نے کس ٹیچر کا مشاہدہ کیا؟ اس سے رپورٹ درست ٹیچر تک پہنچتی ہے۔',
    who_button: 'ٹیچر منتخب کریں',
    who_section: 'آپ کے ٹیچرز',
    who_other: 'کوئی اور',
    who_other_desc: 'اس فہرست میں موجود نہیں',
    who_ack: 'شکریہ — {name} محفوظ کر لیا۔',
    who_other_ack: 'ٹھیک ہے۔ رپورٹ بھیجتے وقت نام لکھ سکتے ہیں۔',
    who_stale: 'یہ فہرست پرانی ہو چکی ہے۔ رپورٹ بھیجتے وقت نام لکھ سکتے ہیں۔',
    list_send_desc_prefix: 'رپورٹ بھیجنا باقی: ',
    list_send_default_desc: 'استاد کو رپورٹ بھیجیں',
    debrief_record_instruction:
      'استاد کے پاس ہوں تو: WhatsApp کا وائس ریکارڈر 🎙 کھول کر اپنی پوری گفتگو ریکارڈ کریں — خاکہ اوپر موجود رہے گا۔\n\nیہ ریکارڈنگ صرف آپ کے لیے ہے: میں سن کر آپ کو بطور کوچ بڑھنے میں مدد دوں گی۔ استاد اسے کبھی نہیں دیکھیں گے۔',
    debrief_not_yours: 'یہ مشاہدہ آپ کے کھاتے کا نہیں لگتا۔',
    debrief_already_done: 'اس مشاہدے کی ڈی بریف مکمل ہو چکی ہے۔ ✅',
    debrief_load_error: 'معاف کیجیے، کچھ گڑبڑ ہو گئی۔ دوبارہ کوشش کریں یا /observe لکھیں۔',
    debrief_audio_received: '🎧 ڈی بریف کی ریکارڈنگ مل گئی — بھروسے کا شکریہ! سن کر چند منٹ میں آپ کو رائے بھیجوں گی۔ یہ صرف میرے اور آپ کے درمیان ہے۔',
    debrief_too_short: 'ریکارڈنگ بہت مختصر لگی۔ پوری گفتگو ریکارڈ کر کے دوبارہ بھیجیں۔',
    debrief_feedback_failed: 'معاف کیجیے، رائے تیار نہیں ہو سکی۔ ریکارڈنگ محفوظ ہے — تھوڑی دیر بعد دوبارہ کوشش ہو گی۔',
    // bd-2kxxa.3 — gender-agnostic when addressing the coach (imperatives only).
    debrief_processing_failed:
      'ڈی بریف کی ریکارڈنگ ابھی پروسیس نہیں ہو سکی۔ میں خود بخود دوبارہ کوشش کرتی رہوں گی — دوبارہ ریکارڈ کرنے کی ضرورت نہیں۔ اگر ایک گھنٹے میں رائے نہ آئے تو /observe لکھ کر یہ ڈی بریف دوبارہ چنیں۔',
    // bd-jrxo3 — gender-agnostic when addressing the coach (imperatives only).
    redirect_pick_teacher:
      'آئیے اسکول سے شروع کرتے ہیں تاکہ یہ ریکارڈنگ صحیح استاد تک پہنچے۔ پہلے اسکول چنیں، پھر استاد — اور اس کے بعد ریکارڈنگ دوبارہ بھیج دیں۔',
    // bd-tju8f — explicit binding + three-stage worklist + cancel
    bind_prompt_body: 'ریکارڈنگ مل گئی۔ یہ کس استاد کے مشاہدے کی ہے؟ نیچے سے چنیں — شیڈول والے استاد سب سے اوپر ہیں۔',
    bind_button: '📋 استاد چنیں',
    bind_section_title: 'یہ ریکارڈنگ کس کی ہے؟',
    bind_row_visit_fallback: 'شیڈول شدہ مشاہدہ',
    bind_row_other: 'کوئی اور استاد',
    bind_row_other_desc: 'اسکول اور استاد خود چنیں',
    bind_row_debrief: '🎙 یہ ڈی بریف ہے',
    bind_row_debrief_desc: 'کسی منتظر مشاہدے سے جوڑیں',
    bind_row_not_obs: 'یہ مشاہدہ نہیں',
    bind_row_not_obs_desc: 'عام پیغام کے طور پر جاری رکھیں',
    bind_ack: '✅ {name} کے مشاہدے سے جوڑ دیا — تجزیہ شروع ہے۔',
    bind_expired: 'یہ ریکارڈنگ اب محفوظ نہیں رہی۔ براہِ کرم دوبارہ بھیجیں۔',
    bind_not_obs_ack: 'ٹھیک ہے — عام گفتگو جاری رکھیں۔',
    bind_dupe_ack: 'یہ ریکارڈنگ پہلے ہی مل چکی ہے ({name}) — کام جاری ہے، دوبارہ بھیجنے کی ضرورت نہیں۔',
    bind_dupe_fallback_name: 'اسی مشاہدے',
    bind_park_full: 'پہلے اوپر والے سوال کا جواب دیں — پھر اگلی ریکارڈنگ بھیجیں، تاکہ کوئی ریکارڈنگ ضائع نہ ہو۔',
    capture_next_hint: 'اگلی کلاس جب چاہیں ریکارڈ کریں — بھیجنے پر میں پوچھ لوں گی کہ وہ کس استاد کی ہے۔',
    section_stage_a: '1️⃣ فارم مکمل کریں',
    section_stage_b: '2️⃣ ڈی بریف کریں',
    section_stage_c: '3️⃣ رپورٹ بھیجیں',
    list_section_new: 'نیا',
    resume_desc_gate: 'تصویر یا سبق کا منصوبہ باقی — دبا کر مکمل کریں',
    resume_desc_form: 'فارم بھرنا باقی — دبا کر کھولیں',
    resume_desc_retry: '⚠ رک گیا تھا — دبا کر دوبارہ چلائیں',
    resume_desc_wait: 'تجزیہ جاری ہے — فارم جلد ملے گا',
    resume_retry_ack: '🔄 دوبارہ شروع کر دیا — فارم تیار ہوتے ہی بھیج دوں گی۔',
    resume_retry_exhausted: 'میں نے اسے کئی بار چلایا، لیکن یہ مکمل نہیں ہو سکا۔ ریکارڈنگ محفوظ ہے۔ اگر آڈیو اب بھی موجود ہو تو دوبارہ بھیج دیں — میں نیا مشاہدہ شروع کر دوں گی۔',
    watchdog_stalled_coach: '⚠️ جو مشاہدہ ریکارڈ ہوا تھا وہ درمیان میں رک گیا اور دوبارہ نہیں چل سکا۔ کچھ ضائع نہیں ہوا — ریکارڈنگ محفوظ ہے۔ آڈیو دوبارہ بھیج دیں، میں نیا مشاہدہ شروع کر دوں گی۔',
    resume_wait_ack: 'اس پر کام جاری ہے — فارم جلد پہنچے گا۔',
    btn_cancel_obs: 'مشاہدہ منسوخ کریں',
    btn_cancel_yes: 'ہاں، منسوخ کریں',
    btn_back: 'واپس',
    btn_open_form: 'فارم کھولیں',
    btn_retry_now: 'دوبارہ چلائیں',
    btn_ok_wait: 'ٹھیک ہے',
    cancel_confirm_body: 'یہ مشاہدہ منسوخ کر دیں؟ یہ آپ کی فہرست سے ہٹ جائے گا — ریکارڈنگ محفوظ رہے گی۔',
    cancel_ack: '✅ مشاہدہ منسوخ ہو گیا۔',
    cancel_too_late: 'رپورٹ استاد کو جا چکی ہے، اس لیے یہ مشاہدہ اب منسوخ نہیں ہو سکتا۔',
    long_audio_no_state: 'لمبی ریکارڈنگ ملی — لیکن ابھی کوئی مشاہدہ زیرِ عمل نہیں۔ پہلے /observe لکھیں، پھر ریکارڈنگ بھیجیں۔',
    coach_card_title: 'خوبیاں · بہتری · عملی منصوبہ',
    coach_card_eyebrow: 'کوچنگ کی رائے',
    coach_card_value_eyebrow: 'آج آپ نے جو قدر جی',
    coach_card_subtitle: 'استاد سے آپ کی گفتگو سے — صرف میرے اور آپ کے درمیان۔',
    // bd-y7jr8 — the 3+1 headings, matching the debrief guide the coach reads
    coach_card_wins_label: 'خوبیاں',
    coach_card_action_label: 'عملی منصوبہ',
    coach_card_reflect_label: 'اگلی بار سے پہلے خود سے پوچھیں',
    guide_reflect_label: 'یہ سوال آخر میں پوچھیں',
    coach_card_try_label: 'بہتری کا شعبہ',
    coach_card_closing: 'فیصلہ آپ کا ہے — کوچ آپ ہیں۔ 🌱',
    coach_concern_opener: 'آپ کی ڈی بریف سن لی۔ ایک بات کھل کر کہنی ہے — کیونکہ آپ کا بڑھنا اسی میں ہے۔',
    coach_concern_title: 'کھل کر کہنے کی بات',
    coach_concern_closing: 'یہ صرف میرے اور آپ کے درمیان ہے۔ اگلی ملاقات میں آزمائیں — میں ساتھ ہوں۔',
    pick_teacher_body: 'رپورٹ کس کو بھیجیں؟ اپنی فہرست سے استاد چنیں، یا نیا شامل کریں۔',
    pick_teacher_button: 'استاد چنیں',
    pick_teacher_section: 'آپ کے اساتذہ',
    pick_teacher_new: '➕ نیا استاد',
    pick_teacher_more: 'مزید اساتذہ…',
    pick_teacher_new_desc: 'نام اور فون نمبر لکھیں',
    pick_teacher_manage: '🛠 فہرست سنبھالیں',
    pick_teacher_manage_desc: 'فہرست سے استاد ہٹائیں یا درست کریں',
    manage_body: 'کس استاد کو سنبھالنا ہے؟ ہٹانے سے بھیجی گئی رپورٹیں نہیں مٹتیں — صرف نام فہرست سے ہٹتا ہے۔',
    manage_button: 'چنیں',
    manage_section: 'آپ کی فہرست',
    manage_confirm_body: '{name} ({phone}) — کیا کرنا ہے؟ نام بدلنے کے لیے: اسی نمبر سے دوبارہ شامل کریں۔',
    manage_remove_btn: 'فہرست سے ہٹائیں',
    manage_back_btn: 'واپس',
    manage_removed_ack: '✅ {name} آپ کی فہرست سے ہٹا دیے گئے۔',
    leader_registered_welcome:
      'آپ بطور اسکول لیڈر رجسٹر ہو گئے۔ 🌱 جب کسی استاد کی کلاس دیکھنے جائیں تو /observe لکھیں — میں سبق کے مشاہدے، تعمیری گفتگو کی تیاری، اور استاد کو رپورٹ بھیجنے میں مدد کروں گی۔',
    send_choice_body: 'آخری قدم: استاد کو اُن کی رپورٹ بھیجنا — سرکاری رپورٹ مع آپ کی گفتگو کے نکات۔ بھیجنے سے پہلے آپ خود دیکھیں گے۔ بھیجیں؟',
    btn_send_report: 'رپورٹ بھیجیں',
    btn_send_later: 'بعد میں',
    send_later_ack: 'ٹھیک ہے — یہ رپورٹ /observe کی فہرست میں 📨 کے ساتھ ملے گی۔',
    send_ask_details: 'استاد کا نام اور فون نمبر لکھیں — ایک ہی پیغام میں۔\n\nمثال: *مس ثانیہ، 0301 2345678*',
    send_details_reask: 'سمجھ نہیں آیا۔ نام اور نمبر ایک پیغام میں لکھیں۔ مثال: *مس ثانیہ، 0301 2345678*',
    send_preview_coming: 'ٹھیک ہے — {name} ({phone})۔ رپورٹ تیار کر رہی ہوں؛ بھیجنے سے پہلے آپ کو دکھاؤں گی۔ 1-2 منٹ۔ ⏳',
    send_confirm_body: 'اوپر بالکل وہی رپورٹ ہے جو استاد کو ملے گی — سرکاری رپورٹ مع آپ کی ڈی بریف کے نکات۔ ابھی بھیج دوں؟',
    btn_send_now: 'ابھی بھیجیں',
    btn_send_cancel: 'منسوخ',
    send_delivering: '📨 رپورٹ بھیجی جا رہی ہے — پہنچتے ہی بتاؤں گی۔',
    send_cancel_ack: 'ٹھیک ہے، نہیں بھیجی۔ تفصیلات محفوظ ہیں — جب چاہیں /observe سے دوبارہ۔',
    send_already_sent: 'یہ رپورٹ پہلے ہی بھیجی جا چکی ہے۔ ✅',
    send_waiting_tap_info: '📨 رپورٹ تیار ہے — {name} کو دعوت ({date}) بھیجی جا چکی ہے۔ ابھی دعوت پر ٹیپ نہیں ہوا؛ رومی یاد دہانی بھیجتی رہتی ہے، اور ٹیپ ہوتے ہی رپورٹ خود بخود پہنچ جائے گی۔',
    send_done_fo: '✅ رپورٹ استاد کو پہنچ گئی۔',
    // bd-2411: delivery failed on the worker — surface it to the coach, never silent.
    send_failed_fo: '⚠️ معذرت — رپورٹ ابھی استاد کو نہیں بھیجی جا سکی۔ /observe لکھیں، وہ مشاہدہ منتخب کریں، اور دوبارہ بھیجنے کی کوشش کریں (📨)۔',
    send_template_queued_fo: '📨 استاد نے حال میں مجھے پیغام نہیں بھیجا، اس لیے انہیں دعوت بھیجی ہے — ایک ٹیپ پر رپورٹ مل جائے گی۔ میں بتاؤں گی۔',
    send_operator_review_fo: '📨 رپورٹ جائزے کے لیے بھیج دی گئی ہے — منظوری پر استاد کو پہنچے گی۔',
    report_caption_teacher: '🌱 آپ کے سبق پر مبارک ہو! یہ رہی آپ کی رپورٹ۔',
    companion_from_label: 'جانب سے',
    companion_commitment_label: 'آپ کا عزم',
    companion_closing: 'ہمیں آپ کے کام پر فخر ہے۔ ہم ساتھ ہیں۔ 💛',
  },
  en: {
    no_account: "Sorry, I couldn't find your account. Please send me any message first, then try /observe again.",
    capture_failed: "Sorry — something went wrong on my side while saving that observation. Your recording isn't lost. Please type /observe and send it again; if it keeps happening, tell the team.",
    role_denied:
      '/observe is for school leaders (field officers) for now. 💛\n\n' +
      "If you're a teacher, I'm here for you — type \"menu\" to see what I can do.",
    onboard_why:
      'Welcome to coaching, my friend. 🌱\n\n' +
      "Before we begin, one thing from the heart: your job is not inspection — it's nurture. " +
      'The teacher you visit is not someone to be supervised, but someone to help grow. ' +
      'You are their confidant: someone they trust, who listens, who shows them what they did well — and then helps them see ONE small next step.\n\n' +
      'Why does this matter? When a teacher trusts you, they open up. When they open up, they learn. ' +
      "When they learn, their teaching changes — and that is when their students' results begin to rise. " +
      'Their trust in you is the only bridge to change in their classroom.\n\n' +
      'So when you walk in tomorrow, walk in as a coach — never an inspector. We are in this together. 💛',
    onboard_functional:
      'Welcome to /observe! Here is how it works:\n\n' +
      '1️⃣ Go to the classroom and record the lesson (audio)\n' +
      '2️⃣ I will send you a pre-filled FICO form — review and edit it\n' +
      '3️⃣ Later: a guided debrief with the teacher, and a summary for them',
    capture_prompt:
      '🎙 Ready! In the classroom, press record on WhatsApp and record the lesson (or part of it — 10 to 40 minutes).\n\n' +
      "When you're done, send me the recording here. I'll listen and send you a FICO form pre-filled for every indicator — you review and change anything you disagree with.",
    audio_received:
      "🎧 Got the recording — thank you! I'm listening now and filling in the FICO form. It will arrive here in 2–5 minutes.",
    flow_header: 'FICO — draft',
    flow_body: "I've pre-filled the FICO form from your recording — every indicator has a rating, evidence, and an improvement note. Open it, review, change anything you disagree with, then submit.",
    flow_button: 'Open the form',
    flow_fallback: 'Analysis complete ✅ — but the editable form is not yet enabled on this deployment. Please contact the NIETE team.',
    submitted_ack: '✅ Thank you! Your FICO observation is saved, with your edits.',
    // ── bd-21: debrief entry points ──────────────────────────────────
    debrief_choice_body:
      'Next step: the debrief — a growth conversation with the teacher. 🌱\n\n' +
      "I'll prepare a short conversation guide for you — genuine praise, one reflective question, and ONE thing to improve. Are you ready to talk with the teacher now, or later?",
    btn_debrief_now: 'Debrief now',
    btn_debrief_later: 'Later',
    debrief_later_ack:
      "No rush at all. 💛 When you're ready to talk with the teacher, type /observe and pick that observation from the list.",
    list_body:
      'You have debriefs waiting. Pick an observation to start its debrief, or start a new observation.',
    list_button: 'Choose',
    list_section_title: 'Pending debriefs',
    list_new_observation: '🎙 New observation',
    list_new_observation_desc: 'Start a new classroom observation',
    list_row_default_desc: 'Tap to start the debrief',
    // bd-2668 — who was observed (asked only when the capture was unbound)
    // bd-2675 — the tap event, the single nudge, and the honest stop
    send_tapped_fo: '✅ {name} has opened the report.',
    send_nudged_fo: '🔔 {name} has not opened the report yet — I have sent one reminder.',
    send_gave_up_fo: '{name} has not opened the report. I will not send more reminders — have a word, then send it again from /observe.',
    // bd-88krt — Flow terminal-screen text (per-language, never hardcoded)
    search_no_match: 'No matches — try again',
    school_already_mine: 'Already in your list',
    school_added_heading: 'School added',
    school_removed_heading: 'School removed',
    flow_scheduled_heading: 'Observation scheduled',
    flow_scheduled_body: 'Tap /observe anytime to see your schedule.',
    obs_cancelled_heading: 'Observation cancelled',
    obs_cancelled_body: 'Removed from your list — the recording stays saved.',
    flow_cancelled_heading: 'Visit cancelled',
    flow_cancelled_body: 'Nothing to record. Tap /observe to see your schedule.',
    flow_rescheduled_heading: 'Visit moved',
    flow_rescheduled_body: 'Tap /observe to see your updated schedule.',
    flow_action_failed_heading: 'That did not go through',
    flow_action_failed_body: 'Tap /observe to try again.',
    who_body: 'Which teacher did you observe? This keeps the report with the right teacher.',
    who_button: 'Pick teacher',
    who_section: 'Your teachers',
    who_other: 'Someone else',
    who_other_desc: 'Not in this list',
    who_ack: 'Thanks — noted {name}.',
    who_other_ack: 'No problem. You can type the name when you send the report.',
    who_stale: 'That list has expired. You can type the name when you send the report.',
    list_send_desc_prefix: 'Send report to',
    list_send_default_desc: 'Send the report to the teacher',
    // ── bd-22: guided debrief ────────────────────────────────────────
    debrief_record_instruction:
      "When you're with the teacher: open WhatsApp's voice recorder 🎙 and record your whole conversation — the guide stays right above while you record.\n\n" +
      "The recording is for YOU alone: I'll listen and give you feedback to grow as a coach. The teacher never sees it.",
    debrief_not_yours: "Sorry — that observation isn't yours, so I can't open its debrief.",
    debrief_already_done: '✅ That debrief is already done. Type /observe to start a new observation.',
    debrief_load_error: "Sorry, I couldn't load that observation right now. Please try again in a few minutes.",
    // ── bd-28: debrief recording + coach-the-coach ───────────────────
    debrief_audio_received:
      "🎧 Got your debrief recording — thank you for trusting me with it! I'm listening now; feedback to help you grow as a coach arrives in a few minutes. This stays between us. 💛",
    debrief_too_short:
      "Sorry — I couldn't hear enough of the conversation in that recording. If the debrief is still going, record a longer stretch and send it over — the guide is still right above.",
    debrief_feedback_failed:
      "I received your recording but couldn't analyze it just now. Type /observe, pick that observation from the list, and record again — I'll listen fresh.",
    // bd-2kxxa.3 — transcription failed (provider outage etc.). Honest, and told
    // ONCE: the worker sweep retries by itself, so she must NOT re-record.
    debrief_processing_failed:
      "I couldn't process this debrief recording yet. I'll keep retrying automatically — you don't need to re-record. If nothing arrives within an hour, open /observe and pick that debrief again.",
    // bd-jrxo3 — the accepted cost is stated plainly: she sends it again.
    redirect_pick_teacher:
      "Let's start from the school so this reaches the right teacher. Pick the school, then the teacher — then send me the recording again.",
    // bd-tju8f — explicit binding + three-stage worklist + cancel
    bind_prompt_body: "Got your recording. Whose observation is this? Pick below — your scheduled teachers are at the top.",
    bind_button: '📋 Pick the teacher',
    bind_section_title: 'Whose recording is this?',
    bind_row_visit_fallback: 'Scheduled observation',
    bind_row_other: 'Another teacher',
    bind_row_other_desc: 'Pick the school and teacher yourself',
    bind_row_debrief: '🎙 This is a debrief',
    bind_row_debrief_desc: 'Attach it to a waiting observation',
    bind_row_not_obs: 'Not an observation',
    bind_row_not_obs_desc: 'Continue as a normal message',
    bind_ack: '✅ Attached to {name}\'s observation — analysis has started.',
    bind_expired: "That recording is no longer held. Please send it again.",
    bind_not_obs_ack: 'Okay — carry on as normal.',
    bind_dupe_ack: "I already have this recording ({name}) — it's in progress, no need to send it again.",
    bind_dupe_fallback_name: 'the same observation',
    bind_park_full: 'Answer the question above first — then send the next recording, so nothing gets lost.',
    capture_next_hint: "Record your next class whenever you like — when it arrives I'll ask which teacher it's for.",
    section_stage_a: '1️⃣ Complete the form',
    section_stage_b: '2️⃣ Do the debrief',
    section_stage_c: '3️⃣ Send the report',
    list_section_new: 'New',
    resume_desc_gate: 'Photo or lesson plan pending — tap to finish',
    resume_desc_form: 'Form still to fill — tap to open',
    resume_desc_retry: '⚠ It stopped — tap to run it again',
    resume_desc_wait: "Analysis in progress — the form is coming soon",
    resume_retry_ack: "🔄 Restarted — I'll send the form as soon as it's ready.",
    resume_retry_exhausted: "I've run this one as many times as I can and it won't go through. Your recording is saved. If you still have the audio, send it again and I'll start a fresh observation.",
    watchdog_stalled_coach: "⚠️ The observation you recorded stopped partway and I couldn't restart it. Nothing is lost — your recording is saved. Send the audio again when you can and I'll start a fresh one.",
    resume_wait_ack: "Still working on this one — the form will arrive soon.",
    btn_cancel_obs: 'Cancel observation',
    btn_cancel_yes: 'Yes, cancel it',
    btn_back: 'Back',
    btn_open_form: 'Open the form',
    btn_retry_now: 'Run it again',
    btn_ok_wait: 'Okay',
    cancel_confirm_body: 'Cancel this observation? It will leave your list — the recording stays safe.',
    cancel_ack: '✅ Observation cancelled.',
    cancel_too_late: "The report has already reached the teacher, so this observation can no longer be cancelled.",
    long_audio_no_state:
      "🎧 I received a long recording — but there's no observation waiting for you right now. If this was a lesson or debrief recording, type /observe first (and pick the right observation), then send it again.",
    coach_card_title: 'Strengths · growth · action plan',
    coach_card_eyebrow: 'Coaching Feedback',
    coach_card_value_eyebrow: 'The value you lived today',
    coach_card_subtitle: 'From your conversation with the teacher — between you and me only.',
    // bd-y7jr8 — the 3+1 headings, matching the debrief guide the coach reads
    coach_card_wins_label: 'Strengths',
    coach_card_action_label: 'Action plan',
    coach_card_reflect_label: 'Ask yourself before next time',
    guide_reflect_label: 'Ask this last',
    pick_teacher_body:
      'Who should receive the report? Pick a teacher from your list, or add a new one.',
    pick_teacher_button: 'Pick a teacher',
    pick_teacher_section: 'Your teachers',
    pick_teacher_new: '➕ New teacher',
    pick_teacher_more: 'More teachers…',
    pick_teacher_new_desc: 'Type the name and phone number',
    leader_registered_welcome:
      "You are registered as a school leader. 🌱 When you are ready to visit a teacher's classroom, type /observe — I will help you observe the lesson, prepare the coaching conversation, and send the teacher their report.",
    pick_teacher_manage: '🛠 Manage teachers',
    pick_teacher_manage_desc: 'Remove or fix a teacher on your list',
    manage_body: 'Pick a teacher to manage. Removing never deletes sent reports — it only takes the name off your list.',
    manage_button: 'Pick',
    manage_section: 'Your list',
    manage_confirm_body: '{name} ({phone}) — what would you like to do? To rename: just add them again with the same number.',
    manage_remove_btn: 'Remove from list',
    manage_back_btn: 'Back',
    manage_removed_ack: '✅ {name} removed from your list.',
    coach_card_try_label: 'Areas for growth',
    coach_card_closing: 'The choice is yours — you are the coach. 🌱',
    // bd-30 — the harm gate: the officer disparaged the teacher. Honest, not congratulatory.
    coach_concern_opener:
      "I listened to your conversation. There's one thing I have to be honest with you about — because I'm on your side, and because this teacher depends on you. 💛",
    coach_concern_title: 'Something worth naming',
    coach_concern_closing:
      "I'm not writing this to judge you. Every coach gets this wrong sometimes, and the best ones are the ones who can hear it and change. We start again tomorrow. 🌱",
    // ── bd-24/25/32: combined report to the teacher ──────────────────
    send_choice_body:
      "Last step: sending the teacher their report — the official FICO report plus notes from your conversation. You'll see it first before anything is sent. Shall we?",
    btn_send_report: 'Send report',
    btn_send_later: 'Later',
    send_later_ack:
      "No problem. 💛 When you're ready, type /observe and pick that observation — you'll see the send-report option (📨).",
    send_ask_details:
      'Tell me the teacher\'s name and phone number — one message.\n\nExample: *Ms. Zainabu, 0712 345 678*',
    send_details_reask:
      "Sorry, I didn't catch that. Please send the name AND a Tanzanian phone number together.\n\nExample: *Ms. Zainabu, 0712 345 678*",
    send_preview_coming:
      "Got it — {name} ({phone}). I'm preparing the report now; you'll see it FIRST before anything is sent. 1–2 minutes. ⏳",
    send_confirm_body:
      'Above is the exact report the teacher will receive — the official FICO report plus your debrief notes. Send it now?',
    btn_send_now: 'Send now',
    btn_send_cancel: 'Cancel',
    send_delivering: '📨 Sending the report to the teacher now. I\'ll confirm once it lands.',
    send_cancel_ack: "Okay — nothing was sent. If you change your mind, type /observe and pick that observation.",
    send_already_sent: '✅ That observation\'s report has already been sent to the teacher.',
    send_waiting_tap_info: '📨 The report is ready — the invitation went to {name} ({date}). No tap yet; Rumi keeps reminding, and the report is delivered automatically the moment the invitation is tapped.',
    send_done_fo: '✅ The report reached the teacher. Beautiful coaching work! 🌱',
    // bd-2411: delivery failed on the worker — surface it to the coach, never silent.
    send_failed_fo: "⚠️ Sorry — the report couldn't be sent to the teacher just now. Type /observe, pick that observation, and try sending again (📨).",
    send_template_queued_fo:
      "📨 The teacher hasn't messaged me recently, so I sent them an official invite — one tap and the report arrives. I'll let you know.",
    send_operator_review_fo:
      '🔎 The report went to the NIETE team for a final check (pilot procedure). Once approved, it reaches the teacher.',
    report_caption_teacher:
      'Your lesson report 🌱 Prepared from {fo}\'s visit — with notes from your conversation together.',
    companion_from_label: 'From',
    companion_commitment_label: 'Your commitment',
    // bd-2405: was 'We are proud of your work. Tuko pamoja. 💛' — the Swahili
    // "Tuko pamoja" leaked into the English set and reached NIETE teachers.
    companion_closing: 'We are proud of your work. We are with you. 💛',
  },
};

/**
 * @param {'sw'|'en'|string} lang
 * @returns {object} the string set (sw for 'sw', en otherwise)
 */
let _urMerged = null;
function observeStrings(lang) {
  if (lang === 'sw') return STRINGS.sw;
  if (lang === 'ur') {
    // key-by-key fallback to en — a missing Urdu string degrades, never crashes
    if (!_urMerged) _urMerged = { ...STRINGS.en, ...(STRINGS.ur || {}) };
    return _urMerged;
  }
  return STRINGS.en;
}

/**
 * FEAT-093 bd-53 — the officer's LOCKED language drives every observe surface
 * (UI strings, feedback, prompts, the report). sw and ur are first-class;
 * everything else falls back to en. The ur block falls back key-by-key to en
 * so a missing translation can never crash a flow.
 */
function observeLang(user) {
  const l = user && user.preferred_language;
  if (l === 'sw') return 'sw';
  if (l === 'ur') return 'ur';
  return 'en';
}

// ── Visit-picker capture prompt (bd-2432, port of main-bot bd-2328) ──────────
// Sent right after the coach taps "Start observation" in the visit Flow: names
// the BOUND teacher and the live framework (FICO on NIETE — never hardcode
// MEWAKA). en/ur only (NIETE market, Rule 20/bd-2405).
const VISIT_CAPTURE_TEMPLATES = {
  en: {
    withName: '🎙️ You\'re observing *{name}*. When the lesson starts, record it and send me the audio — I\'ll draft the {fw} form for you.',
    noName: '🎙️ When the lesson starts, record it and send me the audio — I\'ll draft the {fw} form for you.',
  },
  ur: {
    withName: '🎙️ آپ *{name}* کا مشاہدہ کر رہے ہیں۔ سبق شروع ہو تو ریکارڈ کر کے آڈیو مجھے بھیجیں — میں آپ کے لیے {fw} فارم تیار کر دوں گی۔',
    noName: '🎙️ سبق شروع ہو تو ریکارڈ کر کے آڈیو مجھے بھیجیں — میں آپ کے لیے {fw} فارم تیار کر دوں گی۔',
  },
};

/**
 * @param {string} lang     coach language ('ur' | anything-else→en)
 * @param {{teacherName?:string, framework?:string}} [opts]
 */
function buildVisitCapturePrompt(lang, opts = {}) {
  const l = clampLanguage(lang);
  const fw = String(opts.framework || 'FICO').toUpperCase();
  const t = VISIT_CAPTURE_TEMPLATES[l];
  const template = opts.teacherName ? t.withName : t.noName;
  return template.replace('{name}', opts.teacherName || '').replace('{fw}', fw);
}

// ── Scheduling "done" exit ack (bd-2444, operator 2026-07-31) ────────────────
// Sent in chat after "I'm done for now" on CONFIRM_SCHEDULED: recap the saved
// schedule in the coach's preferred/locked language + the /observe re-entry.
const SCHEDULE_DONE_TEMPLATES = {
  en: '✅ Observation scheduled for *{name}* on {date} at {slot}. Tap /observe anytime to see your schedule.',
  ur: '✅ *{name}* کا مشاہدہ {date}، {slot} کے لیے شیڈول ہو گیا۔ اپنے تمام شیڈول دیکھنے کے لیے کبھی بھی /observe لکھیں۔',
};

// bd-88krt — acks for cancelling and rescheduling a visit. Same per-language
// template shape as SCHEDULE_DONE_TEMPLATES above: the language protocol treats
// every coach-facing string as DATA, never a literal at the call site. Neither
// of these may mention recording — the operator cancelled a visit and was still
// told to "record and send me the audio", which is the bug they close.
const VISIT_CANCELLED_TEMPLATES = {
  en: '🗑 Cancelled the visit for *{name}*. Nothing to record. Tap /observe to see what is left on your schedule.',
  ur: '🗑 *{name}* کا مشاہدہ منسوخ کر دیا۔ اب کچھ ریکارڈ نہیں کرنا۔ باقی شیڈول دیکھنے کے لیے /observe لکھیں۔',
  sw: '🗑 Umeghairi ziara ya *{name}*. Hakuna kurekodi. Bonyeza /observe kuona ratiba yako.',
};

const VISIT_RESCHEDULED_TEMPLATES = {
  en: '📅 Moved *{name}* to {date}{slot}. Tap /observe anytime to see your schedule.',
  ur: '📅 *{name}* کا مشاہدہ {date}{slot} پر منتقل کر دیا۔ شیڈول دیکھنے کے لیے /observe لکھیں۔',
  sw: '📅 Nimehamisha *{name}* hadi {date}{slot}. Bonyeza /observe kuona ratiba yako.',
};

const _ACK_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function _ackDate(ymd) {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(ms)) return String(ymd || '');
  const d = new Date(ms);
  return `${d.getUTCDate()} ${_ACK_MONTHS[d.getUTCMonth()]}`;
}

/**
 * @param {string} lang  coach language ('ur' | anything-else→en)
 * @param {{teacherName?:string, date?:string, slot?:string}} [opts] date = YYYY-MM-DD
 */
function buildScheduleDoneAck(lang, opts = {}) {
  const l = clampLanguage(lang);
  return SCHEDULE_DONE_TEMPLATES[l]
    .replace('{name}', opts.teacherName || '')
    .replace('{date}', _ackDate(opts.date))
    .replace('{slot}', opts.slot || '');
}


/** bd-88krt — "cancelled", in the coach's own language. Never mentions recording. */
function buildVisitCancelledAck(lang, opts = {}) {
  const l = clampLanguage(lang);
  const t = VISIT_CANCELLED_TEMPLATES[l] || VISIT_CANCELLED_TEMPLATES.en;
  return t.replace('{name}', String((opts && opts.teacherName) || '').trim() || 'this teacher');
}

/** bd-88krt — "moved to …", in the coach's own language. Slot is optional. */
function buildVisitRescheduledAck(lang, opts = {}) {
  const l = clampLanguage(lang);
  const t = VISIT_RESCHEDULED_TEMPLATES[l] || VISIT_RESCHEDULED_TEMPLATES.en;
  const slot = (opts && opts.slot) ? ` · ${opts.slot}` : '';
  return t
    .replace('{name}', String((opts && opts.teacherName) || '').trim() || 'this teacher')
    .replace('{date}', _ackDate((opts && opts.date) || ''))
    .replace('{slot}', slot);
}

// ── R165 — "which teacher is this for?" ────────────────────────────────
// Sent when a photo / lesson plan arrives while MORE THAN ONE of the coach's
// observations is waiting at that gate and no tap named the target. One row per
// candidate (`mediatarget_<sessionId>`), titled with the observed teacher's
// name, falling back to the recording time. en/ur only (NIETE market, Rule 20);
// the Urdu addresses the coach with neutral imperatives (gender-neutral Urdu guard).
const MEDIA_TARGET_TEMPLATES = {
  en: {
    photo_body: "📎 Got your photo. Which teacher's observation is it for?",
    lp_body: "📎 Got the lesson plan. Which teacher's observation is it for?",
    button: 'Choose teacher',
    section: 'Waiting observations',
    row_fallback: 'Observation',
    row_desc: 'Recorded {time}',
    resend: "👍 Noted. Please send that photo or lesson plan again — it will go to this teacher's observation.",
    stale: 'That observation has already moved past this step, so I could not add the file. If it belongs to another teacher, send it again and pick them.',
  },
  ur: {
    photo_body: '📎 تصویر مل گئی۔ یہ کس استاد کے مشاہدے کے لیے ہے؟',
    lp_body: '📎 لیسن پلان مل گیا۔ یہ کس استاد کے مشاہدے کے لیے ہے؟',
    button: 'استاد چنیں',
    section: 'زیرِ التوا مشاہدے',
    row_fallback: 'مشاہدہ',
    row_desc: 'ریکارڈ: {time}',
    resend: '👍 ٹھیک ہے۔ براہ کرم وہ تصویر یا لیسن پلان دوبارہ بھیجیں — یہ اسی استاد کے مشاہدے میں شامل ہوگا۔',
    stale: 'وہ مشاہدہ اس مرحلے سے آگے بڑھ چکا ہے، اس لیے فائل شامل نہیں ہو سکی۔ اگر یہ کسی اور استاد کی ہے تو دوبارہ بھیج کر انہیں منتخب کریں۔',
  },
};

// WhatsApp list caps, measured in CODE POINTS (Rule 20): row title 24,
// row description 72, section title 24, button 20.
function _truncateCp(str, max) {
  const cp = [...String(str || '')];
  return cp.length <= max ? cp.join('') : `${cp.slice(0, max - 1).join('')}…`;
}

// NIETE serves ICT Islamabad only — one display timezone.
const MEDIA_TARGET_TZ = 'Asia/Karachi';
function _timeLabel(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: MEDIA_TARGET_TZ })
    .format(new Date(ms));
}

/**
 * @param {string} lang  coach language ('ur' | anything-else→en)
 * @param {{ kind: 'photo'|'lp', candidates: Array<{id:string, teacherName?:string|null, created_at?:string}> }} opts
 * @returns {object} listData for WhatsAppService.sendInteractiveMessage
 */
function buildMediaTargetPrompt(lang, { kind, candidates } = {}) {
  const l = clampLanguage(lang);
  const T = MEDIA_TARGET_TEMPLATES[l] || MEDIA_TARGET_TEMPLATES.en;
  const rows = (candidates || []).slice(0, 10).map((c) => {
    const time = _timeLabel(c.created_at);
    const name = String(c.teacherName || '').trim();
    const title = name || `${T.row_fallback}${time ? ` · ${time}` : ''}`;
    const row = { id: `mediatarget_${c.id}`, title: _truncateCp(title, 24) };
    if (name && time) row.description = _truncateCp(T.row_desc.replace('{time}', time), 72);
    return row;
  });
  return {
    body: { text: kind === 'lp' ? T.lp_body : T.photo_body },
    action: { button: _truncateCp(T.button, 20), sections: [{ title: _truncateCp(T.section, 24), rows }] },
  };
}

/** R165 — a single media-target string ('resend' | 'stale' | …) in the coach's language. */
function mediaTargetString(lang, key) {
  const l = clampLanguage(lang);
  const T = MEDIA_TARGET_TEMPLATES[l] || MEDIA_TARGET_TEMPLATES.en;
  return T[key] || MEDIA_TARGET_TEMPLATES.en[key] || '';
}

module.exports = {
  observeStrings, observeLang, buildVisitCapturePrompt, buildScheduleDoneAck,
  buildVisitCancelledAck, buildVisitRescheduledAck,
  buildMediaTargetPrompt, mediaTargetString,
};
