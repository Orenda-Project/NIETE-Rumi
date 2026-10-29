# -*- coding: utf-8 -*-
"""Section O, on its own. Extracted from `test_d0_primary` behaviour, not invented:
these are the four things `_objectives` did before the split, plus the array form.

Run: /usr/bin/python3 -W ignore -m pytest test_d0_objectives.py -q
"""

import d0_arrayform as af
import d0_blocks as B
import d0_objectives as O
from test_d0_arrayfit import PLAIN


def test_the_outcome_is_the_key_fact():
    assert O.build({"keyFact": "Pupils sort shapes by side count"})["outcome"] == \
        "Pupils sort shapes by side count"


def test_the_slo_statement_is_the_fallback_outcome():
    """Only when keyFact is absent. The citation is better than an empty box."""
    o = O.build({"slo_statement": "Identify 2-D shapes by their properties"})
    assert o["outcome"] == "Identify 2-D shapes by their properties"


def test_the_first_slo_ref_is_cited_and_the_objective_stays_dark():
    o = O.build({"keyFact": "x", "slo_refs": ["M-01-B-02", "M-01-B-03"]})
    assert o["items"] == [{"text": B.DESIGN_PENDING, "slo_code": "M-01-B-02"}]


def test_an_empty_slo_ref_list_cites_nothing_rather_than_an_empty_string():
    assert O.build({"keyFact": "x", "slo_refs": ["", None]})["items"][0]["slo_code"] is None


def test_no_enrichment_at_all_still_builds_a_valid_section():
    o = O.build({})
    assert o["outcome"] == "" and o["items"][0]["text"] == B.DESIGN_PENDING


def test_a_two_sentence_outcome_is_offered_to_the_splitter():
    got = O.build({"keyFact": PLAIN})["outcome"]
    assert isinstance(got, list) and " ".join(got) == af.normalise(PLAIN)
