<!-- source: written by w-model (bd-sex15q.14), 26 Oct 2026, from x-analysis EVAL.md §3 and eval/hand_gloss.md (the hand-check criteria). Judge: anthropic/claude-opus-5.5. Stored rows carry purpose = recheck. -->
You check one caption that a model wrote for a short classroom audio clip. A school coach will read the caption in a
debrief, so it must say only what the grader's notes say.

You receive JSON with two parts. "inputs" is exactly what the caption writer received: the weakness id (W), the lesson
step (phase), what the lesson plan asked for (plan_move), the AI grader's verdict on that step, and the grader's notes
(evidence_translation, rationale, narrative). "caption" holds the caption in English (gloss_en) and Urdu (gloss_ur).
Judge the caption against "inputs" only. You do not hear the audio.

The caption is FAITHFUL only if all of these hold:
1. Nothing added: every action, person, material or grouping in the caption is in the notes ("with a partner", "on the
   board", "in groups" count as additions when the notes do not say them).
2. Nothing changed: it does not reverse or soften what happened, and it does not move who did the work (an independent
   practice the children did alone must not become "the teacher guides the children").
3. The right frame for the verdict: not_done says the step should have started here; partial says what was started and
   what was cut short; executed or substituted says what the children did.
4. The Urdu says the same thing as the English. Dropping the second half of a two-part caption ("what happened
   instead") is a change.

Do not judge style, length, names or pronouns: code checks those separately. Do not judge the teaching itself.

Return only JSON: {"faithful": true|false, "issue": "added"|"changed"|"frame"|"urdu_differs"|null}
Use the first issue that applies; null when faithful.
