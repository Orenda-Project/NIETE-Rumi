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
    flow_fallback: 'Uchambuzi umekamilika ✅ — lakini fomu ya kuhariri bado haijawashwa kwenye mfumo huu. Wasiliana na timu ya Rumi.',
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
    send_done_fo: '✅ Ripoti imefika kwa mwalimu. Asante kwa kazi nzuri ya ukocha! 🌱',
    send_template_queued_fo:
      '📨 Mwalimu hajanitumia ujumbe hivi karibuni, kwa hivyo nimemtumia mwaliko rasmi — akiubonyeza, ripoti yake itamfikia mara moja. Nitakujulisha.',
    send_operator_review_fo:
      '🔎 Ripoti imepelekwa kwa timu ya Rumi kwa ukaguzi wa mwisho (utaratibu wa majaribio). Ikithibitishwa, itamfikia mwalimu.',
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
    long_audio_no_state: 'لمبی ریکارڈنگ ملی — لیکن ابھی کوئی مشاہدہ زیرِ عمل نہیں۔ پہلے /observe لکھیں، پھر ریکارڈنگ بھیجیں۔',
    coach_card_title: 'دو اچھی باتیں · ایک آزمانے کی',
    coach_card_eyebrow: 'کوچنگ کی رائے',
    coach_card_value_eyebrow: 'آج آپ نے جو قدر جی',
    coach_card_subtitle: 'استاد سے آپ کی گفتگو سے — صرف میرے اور آپ کے درمیان۔',
    coach_card_wins_label: 'آپ نے کیا اچھا کیا',
    coach_card_try_label: 'اگلی بار یہ آزمائیں',
    coach_card_closing: 'فیصلہ آپ کا ہے — کوچ آپ ہیں۔ 🌱',
    coach_concern_opener: 'آپ کی ڈی بریف سن لی۔ ایک بات کھل کر کہنی ہے — کیونکہ آپ کا بڑھنا اسی میں ہے۔',
    coach_concern_title: 'کھل کر کہنے کی بات',
    coach_concern_closing: 'یہ صرف میرے اور آپ کے درمیان ہے۔ اگلی ملاقات میں آزمائیں — میں ساتھ ہوں۔',
    pick_teacher_body: 'رپورٹ کس کو بھیجیں؟ اپنی فہرست سے استاد چنیں، یا نیا شامل کریں۔',
    pick_teacher_button: 'استاد چنیں',
    pick_teacher_section: 'آپ کے اساتذہ',
    pick_teacher_new: '➕ نیا استاد',
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
    send_done_fo: '✅ رپورٹ استاد کو پہنچ گئی۔',
    send_template_queued_fo: '📨 استاد نے حال میں مجھے پیغام نہیں بھیجا، اس لیے انہیں دعوت بھیجی ہے — ایک ٹیپ پر رپورٹ مل جائے گی۔ میں بتاؤں گی۔',
    send_operator_review_fo: '📨 رپورٹ جائزے کے لیے بھیج دی گئی ہے — منظوری پر استاد کو پہنچے گی۔',
    report_caption_teacher: '🌱 آپ کے سبق پر مبارک ہو! یہ رہی آپ کی رپورٹ۔',
    companion_from_label: 'جانب سے',
    companion_commitment_label: 'آپ کا عزم',
    companion_closing: 'ہمیں آپ کے کام پر فخر ہے۔ ہم ساتھ ہیں۔ 💛',
  },
  en: {
    no_account: "Sorry, I couldn't find your account. Please send me any message first, then try /observe again.",
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
    flow_fallback: 'Analysis complete ✅ — but the editable form is not yet enabled on this deployment. Please contact the Rumi team.',
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
    long_audio_no_state:
      "🎧 I received a long recording — but there's no observation waiting for you right now. If this was a lesson or debrief recording, type /observe first (and pick the right observation), then send it again.",
    coach_card_title: 'Two wins · one to try next time',
    coach_card_eyebrow: 'Coaching Feedback',
    coach_card_value_eyebrow: 'The value you lived today',
    coach_card_subtitle: 'From your conversation with the teacher — between you and me only.',
    coach_card_wins_label: 'What you did well',
    pick_teacher_body:
      'Who should receive the report? Pick a teacher from your list, or add a new one.',
    pick_teacher_button: 'Pick a teacher',
    pick_teacher_section: 'Your teachers',
    pick_teacher_new: '➕ New teacher',
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
    coach_card_try_label: 'Try this next time',
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
    send_done_fo: '✅ The report reached the teacher. Beautiful coaching work! 🌱',
    send_template_queued_fo:
      "📨 The teacher hasn't messaged me recently, so I sent them an official invite — one tap and the report arrives. I'll let you know.",
    send_operator_review_fo:
      '🔎 The report went to the Rumi team for a final check (pilot procedure). Once approved, it reaches the teacher.',
    report_caption_teacher:
      'Your lesson report 🌱 Prepared from {fo}\'s visit — with notes from your conversation together.',
    companion_from_label: 'From',
    companion_commitment_label: 'Your commitment',
    companion_closing: 'We are proud of your work. Tuko pamoja. 💛',
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

module.exports = { observeStrings, observeLang };
