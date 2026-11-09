# Make my own, grades 1–5: how to test on sandbox (bd-snkn32.4, PR #4443)

Test teacher: the operator's sandbox number (0334•••7774) (sandbox user 2598108b…). The account is ICT and now teaches grade 3 as well as grades 6–8. Both `portal_lp_make_own` and `portal_teacher_v2` are on for this user.

1. Open https://portal-sandbox.up.railway.app/login. Log out first so the session reloads, then log in with the operator's sandbox number (0334•••7774) and its OTP.
2. Go to **Lesson Plans → Grade 3 → Math → chapter 1**. **Make my own** is the first card, above the days, with no scrolling needed.
3. Tap it. Step 1 is **Which day?** and lists Day 1, Day 2 and so on. There is no Worksheet or Revision.
4. Answer the five questions. Then tap **Make my plan**. The waiting page shows while the plan is written, which takes about 1–3 minutes. The plan then opens in the viewer as a phone page with these sections: Opening, I Do, We Do, You Do, Check and Homework. The header says "Mine".
5. Repeat for an Urdu-medium book: **Grade 3 → Urdu** (or اسلامیات). The plan comes back in Urdu, in Nastaliq, with Urdu headings.
6. To check grades 6–12 are unchanged, go to **Grade 6 → English → any chapter → Make my own**. The flow is the same as before, with step 1 named "Book pages".
7. To check a flag-off teacher sees nothing new: on any account without `portal_lp_make_own`, the chapter pages look exactly as they do today.

If a plan says "Couldn't make it", search Axiom `niete-logs` for `LP K-5 own:`. The log shows the gate's reasons.
