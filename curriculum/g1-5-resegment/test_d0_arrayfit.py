# -*- coding: utf-8 -*-
"""Stage D0 — the adapter that offers ONE authored string to the array splitter.

`d0_arrayform` decides. `d0_arrayfit` is the only thing the authoring modules call,
and it exists to make two mistakes impossible rather than merely discouraged:

  * a REFUSAL must hand back the authored string itself, not a repaired one;
  * a slot must be asked for BY NAME, and a name the splitter does not know must
    raise -- because an unknown name silently falls through to DEFAULT_POLICY, and
    for the hook that means bullet-pointing a narrated read-aloud story.

The hook fixtures below are REAL: they are the strings d0_hook actually emits for
g1_ch10/English_seg2 and g1_ch10/Maths_seg1 in the ch9-10 corpus.

Run: /usr/bin/python3 -W ignore -m pytest test_d0_arrayfit.py -q
"""

import pytest

import d0_arrayfit as A
import d0_arrayform as af

# g1_ch10/English_seg1 -- the measured worst case. Under "ask#hook.question" this is
# refused (narrated); under DEFAULT_POLICY the very same string comes back as FOUR
# bullets. 129 of the corpus's 193 narrated hooks behave exactly like this.
NARRATED = (
    "On page 124, the elderly narrator looks out from his speech bubble and greets the "
    "class: 'Hi, kids! After peeking at the title and the colourful picture, can you "
    "guess what our story is about?' Beside him is a wide sunny scene: Pinky, wearing her "
    "pink headscarf and purple top, stands with her mouth open in surprise, looking up at "
    "a yellow songbird perched on a tree branch. A small child in an orange top and "
    "glasses stands near her, and the elderly man points toward the bird as if inviting "
    "the children to notice it too. A little further down the page, Pinky appears again, "
    "this time holding a light-blue kitchen blender up to her mouth, announcing that it "
    "is no ordinary blender — it is a special 'blender for words' that the class will use "
    "to blend sounds into whole words.")

# g1_ch10/English_seg2 -- narrated too, but the default policy happens to refuse it
# for an unrelated reason (short_element). Kept so the hook policy is shown holding
# on more than one real story.
NARRATED_2 = (

    "One sunny day, Pinky saw a small bird on the ground. 'Look, Jojo,' she said. "
    "'This bird is hurt.' Jojo looked and replied, 'We should leave it, Pinky. Birds "
    "find their way.' Pinky thought for a moment and said, 'No, Jojo. We must help! "
    "It's the right thing to do.' With love, Pinky cared for the bird — she gave it "
    "water, food, and warmth. Days passed. The bird felt better and sang sweet songs. "
    "Pinky and Jojo smiled, hearing the music. Sir Riaz then asks the class: 'What is "
    "your favourite bird?'")

# g1_ch10/Maths_seg1 -- three plain sentences, no quoted speech anywhere.
PLAIN = (
    "On textbook p.244, a boy and a girl stand in a street scene. They can spot shapes "
    "in the houses, the rectangular billboard, the square-backed STOP sign, the round "
    "clock face, and the triangular roofs. Today students become shape spotters: they "
    "look carefully, trace a shape's boundary with a finger, and use sides and corners "
    "to identify it.")

# g1_ch10/Urdu_seg2. Terminals U+06D4 and U+061F; the curly pair is never opened here,
# so parity holds and the three sentences are free to cut.
URDU = (
    "بلال کی چھوٹی "
    "ریل کے ڈبے میز "
    "پر گر کر بکھر گئے "
    "ہیں! اسے حروف کے "
    "ڈبے جوڑ کر اپنی "
    "لفظوں کی ریل "
    "دوبارہ بنانی ہے "
    "— بالکل ویسے جیسے "
    "کتاب کے صفحہ ۸۶ "
    "پر دکھایا گیا ہے۔ "
    "کیا آپ بلال کی "
    "مدد کریں گے؟")


def test_every_slot_name_this_module_exports_is_one_the_splitter_knows():
    """A constant naming a slot the splitter has never heard of is the failure mode
    this module exists to stop, so it is checked rather than reviewed."""
    names = [getattr(A, n) for n in dir(A) if n.isupper() and not n.startswith("_")]
    assert names and all(n in af.SLOT_POLICY for n in names)


def test_an_unregistered_slot_raises_instead_of_falling_through_to_the_default():
    """THE LANDMINE. `ask.question` is not a key in SLOT_POLICY; `policy_for` returns
    DEFAULT_POLICY for it, and DEFAULT_POLICY does not refuse narration. A caller who
    guesses the slot name must be stopped here, not discovered on a printed page."""
    with pytest.raises(KeyError):
        A.fit(PLAIN, "ask.question")
    with pytest.raises(KeyError):
        A.fit(PLAIN, None)


def test_a_refusal_hands_back_the_authored_string_itself_untouched():
    """Not normalised, not repaired, not a one-element list -- the same object."""
    spaced = "No boundary   here at all"
    got = A.fit(spaced, A.EXIT_Q)
    assert got is spaced


def test_an_accepted_split_is_a_list_that_rejoins_to_the_original():
    parts = A.fit(PLAIN, A.HOOK)
    assert isinstance(parts, list) and len(parts) == 3
    assert " ".join(parts) == af.normalise(PLAIN)


def test_a_value_that_is_not_a_string_is_returned_as_it_came():
    """page2 hands this module a DESIGN_PENDING constant and, one day, a list."""
    already = ["a", "b"]
    assert A.fit(already, A.STUCK) is already
    assert A.fit(None, A.STUCK) is None


def test_the_hook_helper_refuses_a_narrated_read_aloud_story():
    """THE LANDMINE, from the other side. 193 of 335 hooks are narrated scenes with
    quoted dialogue; bullet-pointing one is worse than the dense block it replaced."""
    assert A.hook_question(NARRATED) is NARRATED
    assert A.hook_question(NARRATED_2) is NARRATED_2
    assert af.split_field(NARRATED, A.HOOK).reason == "narrated"


def test_the_same_narrated_hook_WOULD_be_shredded_under_any_other_policy():
    """The proof that the hook helper is doing work: under the default policy the very
    same string comes back as bullets. This is why the hook may not be fitted by hand."""
    shredded = A.fit(NARRATED, A.WE_CFU)
    assert isinstance(shredded, list) and len(shredded) == 4


def test_the_hook_helper_still_splits_a_hook_that_is_not_narrated():
    assert A.hook_question(PLAIN) == af.split_field(PLAIN, A.HOOK).parts


def test_urdu_is_split_at_its_own_terminals_and_measured_in_code_points():
    """Rule 20. U+06D4 and U+061F end a sentence; no Latin stop appears in this string."""
    parts = A.fit(URDU, A.HOOK)
    assert isinstance(parts, list) and len(parts) == 3
    assert parts[0].endswith("!")
    assert parts[1].endswith("۔")
    assert parts[2].endswith("؟")
    assert " ".join(parts) == af.normalise(URDU)
    assert sum(len([*p]) for p in parts) + len(parts) - 1 == len([*af.normalise(URDU)])
