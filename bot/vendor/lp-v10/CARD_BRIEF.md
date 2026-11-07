# v10 card author brief (bd-v0toag.27.7)

You write **one card.json** for one teaching day. The card is the one-page v10 lesson (the v20 design Amena signed off
on 12 Oct). It is a short, teachable front page; every section links to the full v9 plan for detail. You do not write
HTML, you do not edit any other file, and you never run git, bd, Drive, Sheets or any upload.

## Inputs (given in your task)

- `v9_html`: the v9 plan of record for this day. **Read it fully.** It is the content source: the textbook page, the
  words, the items, the board, the answers. Do not invent content that is not in it or in the textbook page it names.
- `moves`: the v9 moves file. Each move has `move_id` (m1, m2 …), `phase`, `text` and `bucket`. Every move whose
  bucket is `must_happen` **must** appear in some card move's `covers`.
- The worked example: `v10-build/cards/g2_ch10/English_seg1.card.json`. Copy its shape exactly.

## Output

`v10-build/cards/g{G}_ch{C}/{Subject}_seg{N}.card.json` (Subject = English | Urdu | Maths), with
`"v9_html": "g{G}_ch{C}_{Subject}_seg{N}.v9.html"`, `"card_version": "v10.1"`,
`"lesson_key": "g{G}·{Subject}·ch{C}·seg{N}"`, `"lang": "ur"` for Urdu and `"en"` otherwise.

## The rules (the gate refuses a card that breaks one)

1. **Sections, in order:** `open`, `explain`, `we`, `you`, `check`, then `hw` (hw has 0 minutes; leave it out only if
   v9 has no homework).
2. **40 minutes** across open+explain+we+you+check, on the judge time bar: **We Do ≥ 12, You Do ≥ 12, We Do + You Do
   ≥ 24, explain (I Do) ≤ 10.** The v9 day is usually 30 minutes: the extra time goes to practice, using v9's own
   items, extension and behind/ahead items. Never pad with new content.
3. **At most 8 moves in total, hw included.** Merge v9 moves of the same phase into one card move; list every merged id in
   `covers`. A v9 move may be covered by more than one card move. Extensions that do not fit go to Full details (they
   stay in v9), but **no must-happen move is ever dropped**.
4. **Each move:** `do` = one bold action, **one breath: ≤ 70 characters**, a verb first, read aloud without a pause
   (judge 10A: a teacher finds the next move in two seconds); `how` = one line of how
   (≤ 120); `say` = one "Say:" line in quotes (≤ 90). `mistake` ≤ 150. The caps are ceilings, not targets: the whole card
   should be about 2,000 characters of visible text, or it will not print on one page. Answers are short (`35 ÷ 7 = 5`,
   not the working); `correct` is one line. On a day whose v9 plan has a video, the build adds a Video row under Words by itself
   (never write it); it costs about 25 px of the page, so leave room. A teacher reads it standing in front of 80
   children; detail belongs in Full details, not on the card. The gate counts characters (tags not counted).
5. **Peer talk lives in We Do only.** No pair, partner, buddy or neighbour talk in `open`, `explain` or `check`: warm-ups
   stay choral (turn a v9 buddy warm-up into whole-class call-and-response), and the exit ticket is answered alone and
   aloud (rule 8). You Do may end with the swap-and-check (neighbours swap books and tick).
6. **We Do** carries the routine (`GUIDED_PRACTICE_v10_CORPUS.md` §3) in at most 3 moves:
   - a move with `"chip": "I START, YOU FINISH"`: teacher works an item on the board aloud, class finishes it chorally;
   - **exactly one** move with `"chip": "ONE NEIGHBOUR TURN"`: one timed minute in seats, with a frame ("I think ___
     because ___"), then 2 pairs share aloud. It carries `"turn"`: `first` (≤ 20, who starts, a seat rule a teacher
     can say: "Window side", "Front row", "Taller child"), `a` (≤ 70, the first child's line, filled in with this day's
     content), `b` (≤ 70, the reply: repeat, check or add a reason, not "good"), `stop` (≤ 40, the signal that
     ends it: "one clap, eyes on me"). The card prints "<first> first: “a” → Reply: “b” · Stop: …". (Judge pilot2:
     without who starts, both lines and the stop, the turn lost 5B, 9E-9G.) **English and Urdu** turns also carry `help`
     (≤ 45, required): the teacher's fixed repair line for a stuck child, tied to this turn ("Say the first word; they
     finish."). It prints as "· Stuck? …" (judge 9G, bd-v0toag.27.7.1.8).
   - a written item in the book, and the teacher checks 5 books (put this in the `how` of one of the two moves or as a
     third move). **No groups, no slates, children stay in their seats.**
7. **You Do is written, alone, in the book.** One move with `"clock": "⏱ NN′ stop explaining"` (NN = open + explain + we
   minutes, the minute You Do starts), items numbered in `do`/`how`, with one harder item for children who finish. Then:
   - `answers`: `[[item, answer], …]`, one per item, the real answers from the v9 plan/textbook (work Maths answers
     out and double-check them);
   - `mistake`: the likely mistake and what the teacher says to fix it, one or two sentences, with `<b>Ask:</b>`;
   - `stuck` (≤ 110): **what the teacher does for a child who cannot start**, one line, from v9's "if stuck" /
     differentiation / support text (a smaller number, a board model to point at, a sentence starter). The card
     prints it as "If stuck: …" under the You Do move. Never invent a strategy v9 does not support.
8. **Check** (exit ticket) is **oral, never written** (Urdu reviewer 13 Oct, all subjects by Amena the same day):
   children answer alone and aloud (the teacher hears five), or show fingers, or a thumb. The teacher may write the item
   on the board; children write nothing. **Thumbs up/down judge a statement** ("We hold the bat with our hands."),
   never a question. One move, plus `correct`: what counts as a correct answer, plus `success` (≤ 80): the
   success line the class reads aloud before the exit ticket, **starting "I can"** (Urdu: میں … سکتا/سکتی ہوں), from
   v9's success criteria / goal. The card prints it as "Success: “I can …” 👍 or ✊ first": children show a thumb to
   predict, then do the ticket. (Judge pilot 12 Oct: without these two lines the card lost 5D and 4A/9G.)
   Also `ask` (≤ 90): **one open question** the teacher asks before the ticket, a why/how/what-if question that a
   child answers in their own words, not yes/no and not the ticket again; and `listen` (≤ 110): what a good answer
   sounds like, with the idea a teacher accepts in any words. The card prints "Ask: “…” → Listen for: …".
   (Judge 2F: no open check question with an expected answer.)
9. **Pictures: every v9 diagram becomes a picture** (count the `<figure class="dg"` blocks in the v9 HTML; the card
   needs at least that many). Each picture: `{"id": "dg1", "after": "<section>", "kind": …, "title": …}`.
   - `faces`: `items` = `[[emoji, label], …]` (feelings, objects, simple pictures).
   - `steps`: `items` = `[[big text, small label], …]` (a word split into sounds, a number sentence step by step, a
     letter + its joins).
   - `svg`: one inline `<svg viewBox=…>…</svg>` for anything that needs a drawing (arrays, number lines, shapes,
     place-value, a chart). No script, no event handlers, no foreignObject; keep it under 3 KB, text in `<text>`.
   - `line`: optional board sentence under the picture. Leave it out when the picture already says it.
   - Keep pictures flat: lay groups out in one row where they fit (an svg about 300 × 90), not a tall grid.
   - Redraw it better if you can, but **never turn a picture into words**. Title starts "THE BOARD BY THE END · ".
   - **A teacher copies it to the board without reading anything else** (judge 10C at 4). So: draw the thing, not a
     list about it (a text list or three emoji tiles is not a board; `faces` only when the lesson IS feelings or
     objects); show the build-up a teacher draws in order (2-4 stages left to right: the groups, then the sum, then the
     answer), not only the end state; labels big (svg `<text>` font-size ≥ 14 in a ~320-wide viewBox, `steps` big text
     ≤ 12 characters); one picture per idea, no decoration.
   - **White space:** print ≤ 2,000 is the limit; ≤ 1,900 is only an aim. **Never cut a Say line, a think-aloud or a
     teaching step to win white space** (pilot4: cutting them cost more teaching marks than design gained). Cut
     repeated words, never pictures.
   - **Bold sparingly** (10B at 4): `<b>` at most once per move, on the one word that matters; the bold `do` already
     stands out.
10. **Language.** Urdu lessons: every teacher-facing string in Urdu (as the v9 Urdu plan is), `"lang": "ur"`. English
    and Maths: English, as the v9 plan is. Keep v9's Urdu glosses for Science-type new words only where v9 has them.
11. **Nothing "design pending"**, no placeholders, no TODO.
12. `header`: grade, subject, chapter (`"Ch.N <chapter title from v9>"`), day (the seg number), minutes 40, title (the v9
    lesson title), goal (one sentence; what children can do by the end, `<b>` on the key verb). `bring`: one line of
    materials, from v9, books and pencils always. `words`: the v9 key words (≤ 6), **exactly as v9 writes them**, formal term included ("total (dividend)"); never shorten a key word to fit print.
13. **Names: one girl and one boy.** `"names": {"girl": …, "boy": …}`, everyday Pakistani first names (Urdu cards:
    in Urdu script), different from day to day where you can. **Use both** in the card's text: in an example, a word
    problem, a model sentence or "Ayesha and Bilal show it first" (the gate checks each appears outside `names`). If v9
    already names children, keep its names. (Judge 6B: no named children of both genders.)
14. **Maths: the opening is a number-sense warm-up.** One `open` move has `"sense": true` (the card prints a NUMBER
    SENSE chip unless the move has its own chip): 2-3 minutes, whole class, choral, with **this day's numbers**:
    compose and decompose ("7 is 5 and ___", "36 is 30 and ___"), make a number two ways, estimate before working,
    or a quick number talk (one item, children say how they got it). It replaces a recall-only warm-up; v9's fact recall
    may stay as one quick line in `how`. No pair talk (rule 5); no new topic, only numbers the lesson uses. Cover the v9
    warm-up move ids in it. (Judge 9A: the v9 warm-ups recall facts and build no number sense.)
    Also one `open` move has `yesterday` (≤ 90): one line the teacher says linking today to yesterday's lesson, from
    v9's recap / previous-knowledge text ("Yesterday we split 24 into tens and ones. Today we …"); on day 1 of a
    chapter, the skill of the last chapter's final lesson (open its v9 plan), never a list of facts. The card prints it as "Yesterday: …" above the move. (Judge 2L.)
15. **I Do thinks aloud.** One `explain` move has `think` (≤ 140): the teacher's reasoning said aloud while modelling,
    in the first person: what I notice, so what I do, how I check ("I see 3 groups of 4, so I add 4 three times: 4, 8,
    12. I check: 3 × 4 = 12."). Not the answer alone and not an instruction to children; it is the step a child
    cannot see from the board. From v9's I Do script / think-aloud / modelling lines. The card prints "Think aloud:
    “…”". (Judge 2C, lost on 5 of 6 pilot4 cards: the teacher shows the answer but never says how.)

## Check your own card

Run, from `v10-build/workbench/card/`:

```
python3 build_card.py ../../cards/g{G}_ch{C}/{Subject}_seg{N}.card.json "<v9_html path>" --moves "<moves path>"
```

`ok …` means it passed the content gates; `REFUSED` lists each reason; fix the card.json and run it again until it says ok. Then the page gate, from `v10-build/renders/`:

```
NODE_PATH=~/.npm/_npx/b234c773f454f454/node_modules node ../workbench/card/shots.js g{G}_ch{C}/<stem>.v10-card.html; echo exit $?
```

It must print `"print"` ≤ 2000 and `exit 0` (one printed page, no sideways scroll); aim for about 3.5 screens at 390.
Then report: the card path, the move count, the minutes per section, which v9 move ids each card move covers, and
anything in v9 you could not carry (it must still be reachable through Full details).
