"""Stage D0 - authored string -> array elements. Unit tests.

Run: /usr/bin/python3 -W ignore -m pytest test_d0_arrayform.py -q

The invariant under test everywhere: " ".join(parts) == normalise(original), exactly.
The renderer re-joins a rejected array with a bare " ", so an exact round-trip is what
makes a rejected array reproduce the authored text character for character.
"""

import re

import d0_arrayform as af

NARRATED = (
    "One sunny day, Pinky saw a small bird on the ground. 'Look, Jojo,' she said. "
    "'This bird is hurt.' Jojo looked and replied, 'We should leave it, Pinky. "
    "Birds find their way.'"
)
PROVOCATION = (
    "Fatima wonders aloud: which planet do YOU think is the HOTTEST in our whole solar "
    "system - the one closest to the Sun, or a different one? And where does Bilal think "
    "Earth sits in the line-up of planets? Write your two guesses in your notebook now, "
    "and one reason for each, before we check together."
)
URDU = (  # g1_ch10/Urdu_seg2 hook, verbatim from the ch9-10 corpus
    "بلال کی چھوٹی ریل کے ڈبے میز پر گر کر بکھر گئے ہیں! اسے حروف کے ڈبے جوڑ کر اپنی لفظوں کی ریل دوبارہ بنانی ہے — بالکل ویسے جیسے کتاب کے صفحہ ۸۶ پر دکھایا گیا ہے۔ کیا آپ بلال کی مدد کریں گے؟"
)


def _tokens(s):
    return re.sub(r"\s+", " ", s).strip().split(" ")


# -- the invariant ---------------------------------------------------------

def test_join_reproduces_the_normalised_original():
    for text in (NARRATED, PROVOCATION, URDU, "A. one. B. two.", "See p. 12. Now read."):
        parts = af.sentences(text)
        assert " ".join(parts) == af.normalise(text)


def test_no_word_is_dropped_added_or_reordered():
    for text in (NARRATED, PROVOCATION, URDU):
        joined = [t for p in af.sentences(text) for t in p.split(" ")]
        assert joined == _tokens(text)


def test_whitespace_is_the_only_permitted_change():
    text = "One.  Two.\n\tThree.  "
    assert af.normalise(text) == "One. Two. Three."
    assert af.sentences(text) == ["One.", "Two.", "Three."]


def test_the_terminal_mark_stays_with_the_element_it_ends():
    assert af.sentences("Count the beans. Draw the sack? Yes!") == [
        "Count the beans.", "Draw the sack?", "Yes!"]


def test_a_check_of_the_round_trip_is_made_not_assumed():
    assert af.round_trips("One. Two.", ["One.", "Two."]) is True
    assert af.round_trips("One.  Two.\n", ["One.", "Two."]) is True
    assert af.round_trips("One. Two.", ["One.", "Two"]) is False
    assert af.round_trips("One. Two.", ["One.Two."]) is False
    assert af.round_trips("One. Two.", ["Two.", "One."]) is False


def test_an_empty_or_blank_field_yields_one_element_and_is_refused():
    assert af.sentences("") == [""]
    assert af.sentences("   \n ") == [""]
    assert af.split_field("   ", "exit_ticket[].q") == af.Split(None, "empty")


# -- Urdu is first class ---------------------------------------------------

def test_the_urdu_full_stop_and_arabic_question_mark_both_split():
    parts = af.sentences(URDU)
    assert len(parts) == 3
    assert parts[1].endswith("۔") and parts[-1].endswith("؟")


def test_lengths_are_counted_in_code_points_not_bytes_or_units():
    astral = "\U0001f31e" * 30            # 30 code points, 120 UTF-8 bytes
    assert af.cp_len(astral) == 30
    assert af.cp_len("ہے۔") == 3


def test_urdu_reversed_curly_quotes_are_opaque():
    # Urdu logical order is ’ ... ‘ - the mirror of the Latin order.
    text = "اس پر ’چاند۔ پارٹی‘ "
    text += "لکھا ہے۔ اب پڑھیں۔"
    parts = af.sentences(text)
    assert len(parts) == 2
    assert " ".join(parts) == af.normalise(text)


def test_guillemets_are_opaque():
    parts = af.sentences("She read «go home. now» aloud. Then she sat.")
    assert parts == ["She read «go home. now» aloud.", "Then she sat."]


# -- quotes ----------------------------------------------------------------

def test_a_terminal_inside_quotes_is_not_a_boundary():
    for o, c in (('"', '"'), ("“", "”")):
        text = "He said %sgo home. now%s and sat. Then he read." % (o, c)
        assert af.sentences(text) == [
            "He said %sgo home. now%s and sat." % (o, c), "Then he read."]


def test_an_apostrophe_in_a_contraction_is_not_a_quote():
    assert af.sentences("It's hot. Then go.") == ["It's hot.", "Then go."]
    assert af.sentences("Don't stop. Don't wait. Don't ask.") == [
        "Don't stop.", "Don't wait.", "Don't ask."]


def test_an_odd_count_of_quotes_refuses_rather_than_guessing():
    text = "The boys' bags are wet. Now count them."
    assert af.sentences(text) == [af.normalise(text)]
    assert af.split_field(text, "exit_ticket[].q").reason == "unbalanced_quotes"


# -- brackets and enumerators ----------------------------------------------

def test_a_terminal_inside_parentheses_is_not_a_boundary():
    text = "Measure the wire (use a ruler. a long one) and record it. Then swap."
    assert af.sentences(text) == [
        "Measure the wire (use a ruler. a long one) and record it.", "Then swap."]


def test_urdu_enumerator_items_with_no_terminal_mark_refuse():
    text = ("ہر طالب علم "
            "(۱) لکھے، (۲) بولے")
    assert af.sentences(text) == [af.normalise(text)]
    assert af.split_field(text, "exit_ticket[].q").reason == "no_boundary"


def test_a_single_letter_enumerator_does_not_split():
    assert af.sentences("A. Count the beans. B. Draw the sack.") == [
        "A. Count the beans.", "B. Draw the sack."]


# -- abbreviations ---------------------------------------------------------

def test_the_measured_abbreviations_do_not_split():
    for abbr in ("p. 135", "pp. 148-150", "e.g. a ruler", "i.e. a metre",
                 "No. 4", "Mr. Khan", "Fig. 2", "etc. and more"):
        text = "Open the book at %s and read it. Then stop." % abbr
        assert len(af.sentences(text)) == 2, abbr


def test_units_are_not_abbreviations_the_corpus_ends_sentences_with_them():
    # MEASURED: cm./kg./m. end real sentences in the ch9-10 corpus; treating them
    # as abbreviations would suppress boundaries the operator wants.
    assert af.sentences("Record the length in cm. Then compare with your partner.") == [
        "Record the length in cm.", "Then compare with your partner."]
    assert len(af.sentences("The avocado scale records 1 kg. The bananas record 2 kg.")) == 2


def test_an_ellipsis_is_not_a_sentence_end():
    text = "Think about it... then tell your partner."
    assert af.sentences(text) == [af.normalise(text)]
    assert af.sentences("Write here ......... and stop.") == [af.normalise(
        "Write here ......... and stop.")]


# -- dialogue detection ----------------------------------------------------

def test_a_narrated_scene_carries_dialogue():
    assert af.carries_dialogue(NARRATED) is True


def test_neither_a_direct_provocation_nor_a_quoted_word_is_dialogue():
    assert af.carries_dialogue(PROVOCATION) is False
    assert af.carries_dialogue("Look at the word 'rat'. Now break it up.") is False


# -- split_field policy ----------------------------------------------------

def test_the_operator_complaint_hook_splits_into_its_three_moves():
    got = af.split_field(PROVOCATION, "ask#hook.question")
    assert got.reason == "ok"
    assert len(got.parts) == 3
    assert " ".join(got.parts) == af.normalise(PROVOCATION)


def test_a_narrated_hook_is_refused():
    got = af.split_field(NARRATED, "ask#hook.question")
    assert got.parts is None
    assert got.reason == "narrated"


def test_a_narrated_scene_is_not_refused_in_a_slot_that_allows_dialogue():
    assert af.split_field(NARRATED, "exit_ticket[].q").reason != "narrated"


def test_one_sentence_has_no_boundary_and_never_becomes_an_array():
    got = af.split_field("Only one sentence here, and it is a long one.", "objectives.outcome")
    assert got.parts is None and got.reason == "no_boundary"


def test_fewer_elements_than_the_policy_floor_refuses():
    pol = af.Policy(min_parts=3, max_parts=6, min_len=5)
    assert af.split_field("Alpha beta. Gamma delta.", policy=pol).reason == "too_few"
    assert af.split_field("Alpha beta. Gamma delta. Epsilon zeta.", policy=pol).reason == "ok"


def test_a_short_element_refuses_the_whole_field():
    pol = af.Policy(max_parts=6, min_len=25, refuse_dialogue=False)
    long_one = "This element is comfortably longer than the floor."
    assert af.split_field(long_one + " Yes. " + long_one, policy=pol).reason == "short_element"
    assert af.split_field(long_one + " " + long_one, policy=pol).reason == "ok"


def test_too_many_elements_refuses():
    pol = af.Policy(max_parts=3, min_len=5, refuse_dialogue=False)
    text = "Alpha beta. Gamma delta. Epsilon zeta. Eta theta."
    assert af.split_field(text, policy=pol).reason == "too_many"
    assert af.split_field(text, policy=af.Policy(max_parts=4, min_len=5)).reason == "ok"


def test_a_refusal_carries_no_parts_and_the_original_is_recoverable():
    got = af.split_field(NARRATED, "ask#hook.question")
    assert got.parts is None
    assert af.normalise(NARRATED) == " ".join(af.sentences(NARRATED))


def test_an_unknown_slot_falls_back_to_the_default_policy():
    assert af.policy_for("no.such.slot") == af.DEFAULT_POLICY
    assert af.policy_for("ask#hook.question") != af.DEFAULT_POLICY


def test_the_hook_is_capped_tighter_than_the_other_slots_and_refuses_dialogue():
    hook = af.policy_for("ask#hook.question")
    assert hook.refuse_dialogue is True
    assert hook.max_parts < af.DEFAULT_POLICY.max_parts
    assert all(not af.policy_for(s).refuse_dialogue
               for s in af.SLOT_POLICY if s != "ask#hook.question")


def test_every_widened_schema_slot_has_a_policy():
    assert set(af.SLOT_POLICY) == {
        "objectives.outcome", "exit_ticket[].q", "page2.differentiation.stuck",
        "page2.differentiation.early", "page2.coaching_reflection",
        "ask#hook.question", "worked_example.prompt", "worked_example.cfu",
        "faded_example.prompt"}


def test_an_element_of_a_split_will_not_split_again():
    parts = af.split_field(PROVOCATION, "ask#hook.question").parts
    for p in parts:
        assert af.split_field(p, "ask#hook.question").parts is None


def test_a_quoted_question_the_sentence_carries_on_past_is_not_a_boundary():
    # MEASURED: 81 candidate boundaries in the corpus are a quoted question
    # embedded mid-sentence. A lower-case Latin word after the mark continues it.
    assert af.sentences("Circulate asking 'What clue helped you?' and share it.") == [
        "Circulate asking 'What clue helped you?' and share it."]
    text = "Point to each full stop and say “Stop here!” together. Then return."
    assert af.sentences(text) == [
        "Point to each full stop and say “Stop here!” together.", "Then return."]


def test_an_urdu_teacher_script_counts_as_dialogue():
    said = "استاد: \"دیکھیں! "
    said += "یہ لمبی سڑک ہے۔\" "
    said += "اب پڑھیں۔"
    assert af.carries_dialogue(said) is True
    assert af.split_field(said, "ask#hook.question").reason == "narrated"


def test_an_urdu_provocation_splits_and_round_trips():
    got = af.split_field(URDU, "ask#hook.question")
    assert got.reason == "ok" and len(got.parts) == 3
    assert " ".join(got.parts) == af.normalise(URDU)
    assert got.parts[1].endswith("۔")


def test_the_two_example_prompts_allow_a_longer_step_list():
    for slot in ("worked_example.prompt", "faded_example.prompt"):
        assert af.policy_for(slot).max_parts > af.DEFAULT_POLICY.max_parts
        assert af.policy_for(slot).refuse_dialogue is False


def test_a_policy_argument_overrides_the_slot_table():
    wide = af.Policy(min_parts=2, max_parts=99, min_len=1, refuse_dialogue=False)
    assert af.split_field(NARRATED, "ask#hook.question", policy=wide).reason == "ok"



def test_a_cut_that_would_not_re_join_is_refused_not_repaired():
    # assemble() is the one gate the invariant is enforced at. Cut anywhere but a
    # single space and the elements can no longer reproduce the original.
    assert af.assemble("One. Two.", [4]) == (["One.", "Two."], "ok")
    assert af.assemble("One. Two.", [3]) == (["One. Two."], "roundtrip")
    assert af.assemble("One. Two.", [2]) == (["One. Two."], "roundtrip")
    assert af.assemble("One. Two. Three.", [4, 9]) == (
        ["One.", "Two.", "Three."], "ok")
