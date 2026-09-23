"""bd-t4iur -- the warm-up's METHOD, on the page, without its prohibition. Unit tests.

`warmUp.script` is the only authored field that says HOW the retrieval questions are
actually run, and until now nothing rendered it: `template.js`'s `warmupBody` prints
`strategy` (a 60-character name chip) and the `items` rows, and the schema's `warmup`
object is `additionalProperties: false` with no `script` in it. So the teacher read a
strategy NAME and three questions and was never told to have the children write, walk,
clap and self-mark.

OPERATOR, on what the band should carry: *"It should just hold the scriopt WRITE the
word in your copy. When I clap, the whole class says it together and you tick or fix
your own"*. That is English_seg2's script with its first three clauses gone -- the
recap, the announcement, and `Do not call out and do not tell a neighbour`. The
POSITIVE INSTRUCTION ONLY. Two reasons the prohibition goes:

  * it is already ENFORCED. bd-c5miz put lint gate 10e (`PEER_TALK`) in front of every
    string in the document, so a plan that tells children to talk to each other fails
    the gate. Printing the rule on every page after that costs a teacher a line of
    reading per lesson and buys nothing.
  * she has asked three times for LESS script, not more: *"there is alot of script to
    go through"*, *"save space Claude!!!"*, *"NO duplication and repetition pls"*.

Run: python3 -m pytest test_d0_warmscript.py -q
"""

import re

import d0_crux
import d0_warmscript as W

# The operator's own sentence, verbatim, and the script it is buried in
# (`work/enr/English_seg2_grade_3_english_ch2_seg2.json`, `generated.warmUp.script`).
WANTED = ("WRITE the word in your copy. When I clap, the whole class says it "
          "together and you tick or fix your own.")
SEG2 = (
    "Say: 'Yesterday you met three new words and made a prediction about today's "
    "story. I will say a definition. Do not call out and do not tell a neighbour "
    "— WRITE the word in your copy. When I clap, the whole class says it "
    "together and you tick or fix your own.' Say 'being the only one of its kind; "
    "different from everything else' [ten seconds, walk a row] [clap] -- expected: "
    "'unique'. Say 'to laugh softly or amusedly' [ten seconds] [clap] -- expected: "
    "'chuckle'.")


class TestTheOperatorsLine:
    def test_her_sentence_is_what_comes_out_of_the_live_script(self):
        assert W.method_of(SEG2) == WANTED

    def test_the_prohibition_is_not_in_it(self):
        assert "neighbour" not in W.method_of(SEG2)

    def test_the_recap_and_the_announcement_are_not_in_it(self):
        out = W.method_of(SEG2)
        assert "Yesterday" not in out and "I will say a definition" not in out

    def test_the_questions_are_not_in_it_they_are_the_item_rows(self):
        # `warmUp.items` already prints every prompt and answer. OPERATOR: *"NO
        # duplication and repetition pls"*.
        assert "unique" not in W.method_of(SEG2)


class TestTheProhibitionIsCutWhereverItSits:
    def test_a_leading_clause_before_the_dash_goes(self):
        s = "Do not call out and do not tell a neighbour -- WRITE it in your copy."
        assert W.method_of(s) == "WRITE it in your copy."

    def test_a_trailing_clause_after_the_dash_goes(self):
        s = ('Say: "I will ask a question. Write your answer on your slate -- do not '
             'call out and do not show a neighbour." Ask: "What is 700 + 90 + 4?"')
        assert W.method_of(s) == "Write your answer on your slate."

    def test_a_sentence_that_is_nothing_but_the_prohibition_goes(self):
        s = ("Say: 'Write one full sentence in your copy. Do not call out and do not "
             "tell a neighbour. [ten seconds] [clap]")
        assert W.method_of(s) == "Write one full sentence in your copy."

    def test_no_talking_and_nobody_speaks_are_both_cut(self):
        for ban in ("No talking.", "Nobody speaks.", "No speaking.", "Nobody talks."):
            assert W.method_of("Write the answer in your copy. " + ban) == \
                "Write the answer in your copy."

    def test_the_ban_vocabulary_covers_everything_d0_crux_cuts(self):
        # d0_crux._BAN cuts the same rule off the 140-character crux (bd-xa8cf,
        # OPERATOR: *"You cant add No talking in the We Do tag"*). Two matchers, one
        # rule -- so this pins them together rather than refactoring d0_crux, whose
        # own fix is newer than this module.
        for phrase in ("No talking.", "No speaking.", "Nobody talks.", "Nobody speaks."):
            assert d0_crux._BAN.match(phrase), "fixture no longer exercises d0_crux"
            assert W.is_prohibition(phrase), phrase


class TestWhereTheMethodStopsBeingTheMethod:
    def test_a_bracketed_stage_direction_ends_it(self):
        s = "Write your own number. [ten seconds, walk a row] [clap] -- expected: '5'."
        assert W.method_of(s) == "Write your own number."

    def test_an_expected_answer_ends_it(self):
        s = "Write the answer on your slate. Expected answer: '600.'"
        assert W.method_of(s) == "Write the answer on your slate."

    def test_the_second_quoting_verb_ends_it_and_the_first_does_not(self):
        s = ("Say: 'Write on your slate, then one clap and we all say it together.' "
             "Ask: 'In 4,582, what does the 5 mean?'")
        assert W.method_of(s) == \
            "Write on your slate, then one clap and we all say it together."


class TestWhatIsRefusedRatherThanGuessedAt:
    def test_a_strategy_restatement_is_not_a_method(self):
        # English_seg10/11 and English_seg9 author the strategy NAME in the script
        # field. Seating it prints the `strategy` chip a second time.
        s = ("A FINAL calm cumulative retrieval before the worksheet begins -- "
             "silent write, walk, reveal, no new content.")
        assert W.method_of(s) == ""

    def test_no_script_is_no_block(self):
        assert W.method_of("") == "" and W.method_of(None) == ""

    def test_a_method_longer_than_the_cap_is_refused_whole_not_truncated(self):
        # The house rule: a spec that cannot be seated is DROPPED WHOLE and says why
        # (d0_diagram, d0_crux). Half a method is worse than a named gap.
        s = "Write it in your copy. " + " ".join("and walk the row" for _ in range(40))
        assert W.method_of(s) == ""


class TestUrdu:
    def test_urdu_writes_its_method_too(self):
        s = ("ساٹھ سیکنڈ میں "
             "یہ بارہ اَلفاظ "
             "تیزی سے پڑھیں گے۔ "
             "بورْڈ پر لِکھیں۔")
        assert "ل" in W.method_of(s)

    def test_urdu_negation_that_is_not_a_prohibition_survives(self):
        # *"آگے نہیں جُڑتے"* -- "the letters that do NOT join" -- is the
        # lesson's content, not a classroom rule. A bare نہیں must not cut a clause.
        s = ("اَپنی کاپی میں "
             "لِکھیں — وہ حُروف "
             "جو آگے نہیں جُڑتے۔")
        assert "جُڑتے" in W.method_of(s)


class TestTheBlockItSeats:
    def _sections(self):
        return [{"id": "introduction", "blocks": [
            {"type": "paragraph", "id": "routine", "text": "Class in, books out."},
            {"type": "ask", "id": "hook", "prompt": "Why?"}]}]

    def test_it_lands_in_the_opening_under_the_routine_line(self):
        secs = self._sections()
        assert W.apply_method(secs, {"script": SEG2}) == []
        ids = [b["id"] for b in secs[0]["blocks"]]
        assert ids == ["routine", W.BLOCK_ID, "hook"]

    def test_it_is_a_paragraph_because_the_block_enum_is_closed(self):
        secs = self._sections()
        W.apply_method(secs, {"script": SEG2})
        blk = secs[0]["blocks"][1]
        assert blk["type"] == "paragraph" and blk["text"] == WANTED

    def test_no_usable_method_seats_nothing_and_says_why(self):
        secs = self._sections()
        gaps = W.apply_method(secs, {"script": "A FINAL calm cumulative retrieval."})
        assert [b["id"] for b in secs[0]["blocks"]] == ["routine", "hook"]
        assert gaps and "warmUp.script" in gaps[0]

    def test_an_absent_script_is_additive_and_silent(self):
        secs = self._sections()
        assert W.apply_method(secs, {"items": []}) == []
        assert W.apply_method(secs, None) == []
        assert [b["id"] for b in secs[0]["blocks"]] == ["routine", "hook"]

    def test_it_never_seats_the_block_twice(self):
        secs = self._sections()
        W.apply_method(secs, {"script": SEG2})
        W.apply_method(secs, {"script": SEG2})
        assert [b["id"] for b in secs[0]["blocks"]].count(W.BLOCK_ID) == 1


class TestTheWiring:
    def test_d0_primary_calls_it(self):
        import d0_primary
        src = open(d0_primary.__file__, encoding="utf-8").read()
        assert "d0_warmscript.apply_method" in src

    def test_its_gaps_reach_notes(self):
        import d0_primary
        src = open(d0_primary.__file__, encoding="utf-8").read()
        assert re.search(r"\+\s*warm_gaps", src)


class TestTheTwoShapesNothingElseCatches:
    def test_a_board_write_of_item_one_ends_it(self):
        # `Write: 4,568 + 9; ...` is Maths_seg2's first item, put on the board. No
        # `Say:` introduces it and no question mark closes it.
        s = ("Write the jumps yourself, then one clap and we say it together. "
             "Write: 4,568 + 9; 3,989 + 12; 5,609 + 34.")
        assert W.method_of(s) == \
            "Write the jumps yourself, then one clap and we say it together."

    def test_the_opening_instruction_may_itself_carry_numbers(self):
        # The rule above must not eat the sentence that STARTS the method.
        s = "Write your answer on your slate: 700 + 90 + 4."
        assert W.method_of(s) == "Write your answer on your slate: 700 + 90 + 4."

    def test_a_leading_choral_answer_is_dropped(self):
        # Urdu_seg5 opens the method sentence with the previous question's answer in a
        # parenthesis: *"(جماعت: ...) پھِر کہیں: ..."*.
        s = ("(جماعت: نَعْت) "
             "اَپنی کاپی میں "
             "لِکھیں۔")
        assert W.method_of(s).startswith("ا")


class TestTheLiveDocuments:
    CORPUS = ("/Users/amenaahmed/rumi/Rumi 10 April 2026/10_Grades 1-5 LP Build/"
              "renders/g3-ch2-trio/work/enr")

    def _scripts(self):
        import glob
        import json
        import os
        out = []
        for p in sorted(glob.glob(os.path.join(self.CORPUS, "*.json"))):
            with open(p, encoding="utf-8") as fh:
                g = (json.load(fh).get("generated") or {}).get("warmUp") or {}
            if g.get("script"):
                out.append((os.path.basename(p), g["script"]))
        return out

    def test_the_corpus_is_still_there(self):
        assert len(self._scripts()) >= 20

    def test_no_seated_method_prints_a_prohibition(self):
        # The whole point of the trim. If this ever fails, name the document.
        bad = [n for n, s in self._scripts()
               if re.search(r"do not (?:call out|tell|show|talk)|nobody (?:talks|speaks)"
                            r"|no talking", W.method_of(s), re.I)]
        assert bad == []

    def test_no_seated_method_is_over_the_cap(self):
        over = [(n, len(W.method_of(s).split())) for n, s in self._scripts()
                if len(W.method_of(s).split()) > W.MAX_WORDS]
        assert over == []

    def test_the_urdu_documents_carry_a_method_too(self):
        # If the answer had been "Urdu has no script", this feature would ship half
        # built. It does not: every Urdu enrichment authors one.
        urdu = [(n, W.method_of(s)) for n, s in self._scripts() if n.startswith("Urdu")]
        assert len(urdu) >= 8
        assert sum(1 for _, m in urdu if m) >= 5
