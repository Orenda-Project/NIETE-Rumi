# bd-iceyyu: "Make my own" bot hand-off, product/UX review

Reviewer lens: product-insights (funnel and leak thinking) plus teacher-facing copy.
Design source: artifact KbsvCwJgs6QWy1DQmGjfzi. It has NO Urdu copy ("plus their Urdu" is
still open), so the Urdu below is new and should be adopted by the portal too.

## 1. Cost and friction

| Path | Billed chat messages | Notes |
|------|---------------------|-------|
| Normal lesson-plan delivery | 2 (ack + PDF) | Flow screens are free |
| Make my own via bot | 1 (cta_url) | Same link as plain text if Meta refuses: still 1 |
| Make my own, 24h link expired, teacher taps again | +1 per fresh use | Each use is a new Flow run |

- Cost: Make my own is cheaper than the plan path (1 vs 2). Nothing is sent if the
  teacher never taps the row.
- Taps from chapter pick to the first question: chapter (existing) -> row (1) -> Flow
  closes, chat message arrives -> button (2) -> portal opens signed in, on the Book pages
  question. That is 2 taps, 0 typing, 0 OTP. The portal's own path (hub -> chapter ->
  row) is 3 taps, so the bot path is not worse.
- Friction is the Flow-close-to-chat step (a screen switch plus a wait for one message).
  The SUCCESS line must say the button is in the chat, or teachers will wait on the Flow.

## 2. Final copy

Counts are code points (Python len). Limits: row title 30, description 20, metadata 80.

| Slot | English | n | Urdu | n |
|------|---------|---|------|---|
| (a) Row title (≤30) | Make my own | 11 | اپنا پلان بنائیں | 16 |
| (b) Row description (≤20) | 5 questions · 1 min | 19 | ۵ سوال · ایک منٹ | 16 |
| (c) Row metadata (≤80), optional | Your plan, made for your class | 30 | آپ کی کلاس کے لیے آپ کا اپنا پلان | 33 |
| (d) SUCCESS line (~120) | Done. Tap the button in the chat to start. | 42 | ہو گیا۔ شروع کرنے کے لیے چیٹ میں بٹن دبائیں۔ | 44 |
| (e) Chat body (≤1024) | Make your own plan for this chapter. 5 quick taps, about a minute. Link works for 24 hours. | 91 | اس باب کا اپنا پلان بنائیں۔ ۵ آسان سوال، تقریباً ایک منٹ۔ لنک ۲۴ گھنٹے چلے گا۔ | 78 |
| (f) Button (≤20) | Make my own | 11 | اپنا پلان بنائیں | 16 |

Notes on the copy:
- English row title matches the portal's "Make my own". The Urdu row title is the
  portal's missing label; "اپنا پلان بنائیں" says what you get ("plan") and reads
  naturally. Use it on both surfaces. A bare "اپنا بنائیں" would hang without a noun.
- Urdu description uses Urdu-Indic digits ۵ (house rule: ۰۱۲۳, not ٠١٢٣). Check the
  Flow renders them in the list-row font; if it shows boxes, fall back to "پانچ سوال".
- Description trimmed from the artifact's "5 questions · about 1 min" (24) to fit 20.
- Chat body names the 24h limit once, in plain words, so an expired link is not a
  surprise. Use the chapter title in the body only if it fits; otherwise "this chapter".
- Button reuses the row title so the teacher sees one phrase end to end.
- Book-language rule: for Urdu-medium books the row is shown in Urdu, even if the
  teacher's preference is en. Then the chat message is in English and may feel abrupt;
  see risk 5.
- No Roman Urdu anywhere. No emoji (keeps button and row clean).

## 3. Transcript, as the teacher sees it (flag-on, Urdu-preference teacher)

| # | Screen / message | What she sees | Tap |
|---|------------------|---------------|-----|
| 1 | Flow: Grade | Existing | tap (existing) |
| 2 | Flow: Subject | Existing | tap (existing) |
| 3 | Flow: Chapter | Existing | tap (existing) |
| 4 | Flow: SELECT_LESSON | Row 1 "اپنا پلان بنائیں / ۵ سوال · ایک منٹ", then the ready plans, then "More lessons →" if the chapter is long | TAP 1 (row) |
| 5 | Flow SUCCESS | "ہو گیا۔ شروع کرنے کے لیے چیٹ میں بٹن دبائیں۔" Flow closes | Done (existing) |
| 6 | Chat (1 billed message) | Body: "اس باب کا اپنا پلان بنائیں۔ ..." Button: "اپنا پلان بنائیں" | TAP 2 (button) |
| 7 | WhatsApp in-app browser | Portal Make my own, already signed in, Book pages question | first question |

Total new taps: 2 (row, button). Billed messages: 1. English-preference teacher: same
with the English strings. Flag-off teacher: steps 1-3, then the usual list with no new row.

## 4. Risks

1. Row pushes a lesson to page 2. With 20 rows per page, the new first row takes one
   slot, so the last lesson of a full page moves behind "More lessons →". Mitigation: page
   size is 20 including the row, and a chapter that had exactly 20 lessons now needs
   page 2. Accept, but test the 19, 20 and 21 lesson edge cases (no lesson lost, no duplicate).
2. Link expires after 24h. A teacher who reopens the old chat message later gets a dead
   link. Mitigation: the body says 24 hours; the portal expired page should offer "ask again"
   and not a bare login wall. Tapping the row again is free and makes a fresh link.
3. Teacher not on the teacher app / no portal account. The bot's /go/<token> must
   resolve to a signed-in session; if the user has no portal profile it must land on a
   clear screen, not an error. Verify with a real flag-on test number before rollout.
4. Meta refuses the cta_url button. Plain-text fallback is still one message; the
   body text must read correctly when the URL is appended (no "tap the button below"
   wording). The copy above avoids that. Make sure the fallback sends once, not twice.
5. Mixed language. Urdu-medium book with an English-preference teacher shows an Urdu
   row, then an English message. Acceptable (operator rule), but log it so we can check
   whether those teachers drop at the chat step.
6. Cohort flag leak. The row must be absent for flag-off teachers on every page, and on
   the "More lessons" page (page 1 only, per spec).
7. Instrumentation (product-insights: do not ship a funnel that starts after the leak).
   Log each step with the correlationId: row shown, row tapped, chat sent (button or text
   fallback), /go link opened, portal first question reached. Without "row shown" we
   cannot compute the tap rate on the new row.
8. Cost stays 1 message only if the SUCCESS screen needs no reply. Do not add a
   confirmation or "your link is ready" message.

## 5. Verdict

VERDICT: CHANGES NEEDED
- Adopt the Urdu copy above on the portal too, since the artifact has none.
- Confirm the Urdu-Indic digit renders in the Flow row; else use "پانچ سوال".
- Add tests for the 19/20/21-lesson page boundaries (risk 1) and the flag-off absence.
- Add the funnel logging in risk 7 (shown / tapped / sent / opened).
- Confirm the fallback and expired-link behaviour (risks 2-4) on a real number first.
The design is otherwise approved: 1 billed message, 2 taps, no OTP, cheaper than the plan path.

## 6. Re-review

Checked: copy keys lpOwnRow*/lpOwnFlowAck/lpOwnLinkBody/lpOwnLinkButton in
bot/shared/config/ux-strings.js match section 2 (en+ur); the two test files named by the
author exist in tests/lp612/. Test results were reported by the author, not re-run here.
Page boundaries (18+row, page 2 from lesson 19), flag-off absence, funnel logs, single
plain-text fallback and the Flow error on a failed send address risks 1, 4, 6, 7 and the
accepted-risk list. Digit rendering is accepted on the existing Urdu-digit page numbers.
Open, outside this PR: Urdu portal label (follow-up bead) and the on-device sandbox
checks of fallback and expired link (operator), both before rollout to teachers.

VERDICT: APPROVED
