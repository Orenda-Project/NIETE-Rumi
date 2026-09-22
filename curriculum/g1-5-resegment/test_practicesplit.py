# -*- coding: utf-8 -*-
"""The refusals that make a day split safe. Pure: no corpus, no key."""
import unittest

import practicesplit as ps


def prob(page, words=10):
    return {"prompt": "p.%d Q1: %s" % (page, " ".join(["ask"] * words)),
            "solution": "answer"}


def counter(per_item):
    """A lesson's practice word count: `per_item` words for each problem."""
    return lambda problems: per_item * len(problems)


class Move(unittest.TestCase):

    def setUp(self):
        self.donor = [prob(78), prob(75), prob(76)]
        self.recv = [prob(79)]
        self.pages = [78, 79, 80]

    def legal(self, **kw):
        a = dict(donor=self.donor, receiver=self.recv, index=0,
                 recv_pages=self.pages, donor_words=counter(130),
                 recv_words=counter(100), cap=350)
        a.update(kw)
        return ps.move(**a)

    def test_a_legal_move_relocates_the_item(self):
        d, r = self.legal()
        self.assertEqual(len(d), 2)
        self.assertEqual(len(r), 2)
        self.assertEqual(r[-1], self.donor[0])

    def test_nothing_is_lost_or_duplicated(self):
        d, r = self.legal()
        self.assertEqual(len(d) + len(r), len(self.donor) + len(self.recv))

    def test_the_caller_s_lists_are_not_mutated(self):
        self.legal()
        self.assertEqual(len(self.donor), 3)
        self.assertEqual(len(self.recv), 1)

    def test_a_page_the_receiver_does_not_teach_is_refused(self):
        with self.assertRaises(ps.Refused) as e:
            self.legal(index=1)          # p.75, receiver teaches 78-80
        self.assertIn("75", str(e.exception))

    def test_an_item_citing_no_page_is_refused(self):
        with self.assertRaises(ps.Refused):
            self.legal(donor=[{"prompt": "count on from four"}] + self.donor)

    def test_a_donor_still_over_cap_is_refused(self):
        with self.assertRaises(ps.Refused) as e:
            self.legal(donor_words=counter(200))   # 3 items 600 -> 2 items 400
        self.assertIn("donor", str(e.exception))

    def test_a_receiver_pushed_over_cap_is_refused(self):
        with self.assertRaises(ps.Refused) as e:
            self.legal(recv_words=counter(180))    # 1 item 180 -> 2 items 360
        self.assertIn("receiver", str(e.exception))

    def test_a_donor_already_under_cap_is_refused(self):
        with self.assertRaises(ps.Refused) as e:
            self.legal(donor_words=counter(50))    # 3 items 150, nothing to fix
        self.assertIn("under", str(e.exception))

    def test_an_index_out_of_range_is_refused(self):
        with self.assertRaises(ps.Refused):
            self.legal(index=9)

    def test_the_boundary_is_at_cap_not_over_it(self):
        d, r = self.legal(recv_words=counter(175))  # receiver lands exactly 350
        self.assertEqual(len(r), 2)


class CitedPage(unittest.TestCase):

    def test_it_reads_the_printed_page_off_the_prompt(self):
        self.assertEqual(ps.cited_page({"prompt": "p.78 Q2a: borrowed 578"}), 78)

    def test_a_space_and_a_missing_dot_still_read(self):
        self.assertEqual(ps.cited_page({"prompt": "p 206 Q1"}), 206)
        self.assertEqual(ps.cited_page({"prompt": "pp.94-95 practice"}), 94)

    def test_a_number_that_is_not_a_page_is_not_read(self):
        self.assertIsNone(ps.cited_page({"prompt": "578 minus 265"}))


if __name__ == "__main__":
    unittest.main()
