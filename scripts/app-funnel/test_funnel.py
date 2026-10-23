#!/usr/bin/env python3
"""bd-4r3rei — unit tests for funnel.py's pure part: rows in, funnel + drop-off pages out. No network."""
import json, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import funnel  # noqa: E402

T = '2026-10-13T10:%02d:00Z'
_n = [0]


def row(event, j=None, minute=0, user='u1', **kw):
    _n[0] += 1
    r = {'_time': T % minute, 'event': event, 'journeyId': j, 'userId': user, '_rowId': str(_n[0])}
    r.update(kw)
    return r


def bot(event, j, minute, feature, **kw):
    # the bot's rows keep everything but the core fields inside data_json
    data = {'feature': feature}
    data.update(kw)
    return row(event, j, minute, data_json=json.dumps(data))


def journey_full(j, feature='lesson_plan', user='u1', pages=('/portal/teacher/lessons',), action=None, m=0):
    rows = [bot('app_funnel.command', j, m, feature, door='command', verdict='link'),
            bot('app_funnel.link_sent', j, m, feature, via='cta_url'),
            row('app_link.open', j, m + 1, user=user, outcome='ok', feature=feature)]
    for i, p in enumerate(pages):
        rows.append(row('app_funnel.page_view', j, m + 2 + i, user=user, route=p, feature=feature))
    if action:
        rows.append(row('app_funnel.action', j, m + 8, user=user, action=action, feature=feature))
    return rows


class Funnel(unittest.TestCase):
    def test_counts_each_step_for_one_starting_command(self):
        rows = []
        rows += journey_full('j_a', pages=('/portal/teacher/lessons', '/portal/teacher/lessons/open'), action='lesson_plan.opened')
        rows += journey_full('j_b', pages=('/portal/teacher/lessons',))
        rows += journey_full('j_c', pages=())  # opened, never a page
        rows += [bot('app_funnel.command', 'j_d', 0, 'lesson_plan', door='command', verdict='link'),
                 bot('app_funnel.link_sent', 'j_d', 0, 'lesson_plan', via='cta_url')]  # never opened
        rows += [bot('app_funnel.command', 'j_e', 0, 'lesson_plan', door='intent', verdict='whatsapp', why='not_registered')]
        rows += [bot('app_funnel.command', 'j_f', 0, 'lesson_plan', door='command', verdict='link'),
                 bot('app_funnel.link_failed', 'j_f', 0, 'lesson_plan', reason='send_refused')]
        res = funnel.build(rows)
        lp = res['by_feature']['lesson_plan']
        self.assertEqual([(s['name'], s['n']) for s in lp['steps']], [
            ('asked', 6), ('link_sent', 4), ('opened', 3), ('landed', 2), ('went_deeper', 1), ('acted', 1)])
        self.assertEqual(lp['kept_on_whatsapp'], {'not_registered': 1})
        self.assertEqual(lp['link_failed'], {'send_refused': 1})

    def test_drop_offs_name_the_last_page(self):
        rows = []
        rows += journey_full('j_a', pages=('/portal/teacher/lessons',))
        rows += journey_full('j_b', pages=('/portal/teacher', '/portal/teacher/lessons'))
        rows += journey_full('j_c', pages=('/portal/teacher/lessons',))
        rows += journey_full('j_d', pages=())
        res = funnel.build(rows)
        lp = res['by_feature']['lesson_plan']
        self.assertEqual(lp['last_pages'][:2], [('/portal/teacher/lessons', 3), ('(never landed)', 1)])

    def test_last_page_is_the_latest_view_or_resume_not_the_first(self):
        rows = journey_full('j_a', pages=('/portal/teacher', '/portal/teacher/classes', '/portal/teacher/lessons'))
        rows.append(row('app_funnel.page_leave', 'j_a', 30, route='/portal/teacher/lessons', dwellMs=5000, how='hidden'))
        res = funnel.build(rows)
        self.assertEqual(res['by_feature']['lesson_plan']['last_pages'], [('/portal/teacher/lessons', 1)])

    def test_acted_journeys_are_not_drop_offs(self):
        rows = journey_full('j_a', pages=('/portal/teacher/lessons',), action='lesson_plan.opened')
        rows += journey_full('j_b', pages=('/portal/teacher/lessons',))
        lp = funnel.build(rows)['by_feature']['lesson_plan']
        self.assertEqual(lp['last_pages'], [('/portal/teacher/lessons', 1)])  # only j_b dropped
        self.assertEqual(lp['actions'], {'lesson_plan.opened': 1})

    def test_separate_starting_commands_are_separate_funnels(self):
        rows = journey_full('j_a', feature='menu', pages=('/portal/teacher',)) + journey_full('j_b', feature='classes', pages=('/portal/teacher/classes',))
        res = funnel.build(rows)
        self.assertEqual(sorted(res['by_feature']), ['classes', 'menu'])

    def test_the_feature_filter_keeps_a_commands_coach_and_leader_funnels(self):
        # bd-zcgpkx: `--feature lesson_plan` must still show lesson_plan@leader (and menu must keep menu@coach).
        keys = ['lesson_plan', 'lesson_plan@leader', 'menu', 'menu@coach', 'lesson_plans_extra']
        self.assertEqual([k for k in keys if funnel.feature_matches(k, 'lesson_plan')], ['lesson_plan', 'lesson_plan@leader'])
        self.assertEqual([k for k in keys if funnel.feature_matches(k, 'menu@coach')], ['menu@coach'])

    def test_a_leader_or_coach_journey_is_its_own_funnel_never_mixed_into_the_teachers(self):
        # bd-zcgpkx: leaders' lesson-plan asks landed on Send a lesson plan (bd-a73p5m: the Lesson Plans tab now, see the
        # next test), not the teacher app; mixed in, ~7% of the lesson_plan asks would skew the teachers' rates.
        rows = journey_full('j_t', pages=('/portal/teacher/lessons',))
        rows += [bot('app_funnel.command', 'j_l', 0, 'lesson_plan', door='bare_command', verdict='link', audience='leader'),
                 bot('app_funnel.link_sent', 'j_l', 0, 'lesson_plan', via='cta_url', audience='leader'),
                 row('app_link.open', 'j_l', 1, outcome='ok', feature='fln:send'),
                 row('app_funnel.page_view', 'j_l', 2, route='/portal/fln/send', feature='lesson_plan'),
                 row('app_funnel.action', 'j_l', 5, action='fln.sent', feature='lesson_plan')]
        rows += [bot('app_funnel.command', 'j_c', 0, 'teacher_training', door='command', verdict='link', audience='coach')]
        rows += [bot('app_funnel.command', 'j_x', 0, 'lesson_plan', door='command', verdict='link', audience='teacher')]
        res = funnel.build(rows)
        self.assertEqual(sorted(res['by_feature']), ['lesson_plan', 'lesson_plan@leader', 'teacher_training@coach'])
        self.assertEqual(res['by_feature']['lesson_plan']['steps'][0], {'name': 'asked', 'n': 2, **{k: v for k, v in res['by_feature']['lesson_plan']['steps'][0].items() if k not in ('name', 'n')}})
        leader = dict((s['name'], s['n']) for s in res['by_feature']['lesson_plan@leader']['steps'])
        self.assertEqual((leader['asked'], leader['acted']), (1, 1))

    def test_a_leader_on_the_lesson_plans_tab_is_lesson_plan_at_leader_never_a_teacher(self):
        # bd-a73p5m: a leader's link now lands on the SAME page a teacher's does (/portal/teacher/lessons). The route
        # cannot tell them apart; the journey's command row (audience leader) does. A leader reading a plan there is a
        # lesson_plan@leader act, and the teachers' funnel neither grows nor shrinks by it.
        teacher = journey_full('j_t', pages=('/portal/teacher/lessons', '/portal/teacher/lessons/open'), action='lesson_plan.opened')
        before = funnel.build(teacher)['by_feature']['lesson_plan']
        rows = teacher + [
            bot('app_funnel.command', 'j_l', 0, 'lesson_plan', door='bare_command', verdict='link', audience='leader'),
            bot('app_funnel.link_sent', 'j_l', 0, 'lesson_plan', via='cta_url', audience='leader'),
            row('app_link.open', 'j_l', 1, user='u2', outcome='ok', feature='leader_lessons'),
            row('app_funnel.page_view', 'j_l', 2, user='u2', route='/portal/teacher/lessons', feature='lesson_plan', linkFeature='leader_lessons'),
            row('app_funnel.page_view', 'j_l', 3, user='u2', route='/portal/teacher/lessons/plan', feature='lesson_plan', linkFeature='leader_lessons'),
            row('app_funnel.action', 'j_l', 4, user='u2', action='lesson_plan.opened', feature='lesson_plan', lane='k5'),
        ]
        res = funnel.build(rows)
        self.assertEqual(res['by_feature']['lesson_plan'], before)
        leader = dict((s['name'], s['n']) for s in res['by_feature']['lesson_plan@leader']['steps'])
        self.assertEqual(leader, {'asked': 1, 'link_sent': 1, 'opened': 1, 'landed': 1, 'went_deeper': 1, 'acted': 1})
        self.assertEqual(res['by_feature']['lesson_plan@leader']['actions'], {'lesson_plan.opened': 1})

    def test_journeys_are_counted_once_even_when_the_link_is_tapped_twice(self):
        rows = journey_full('j_a', pages=('/portal/teacher/lessons',))
        rows.append(row('app_link.open', 'j_a', 20, outcome='ok', feature='lesson_plan'))
        rows.append(row('app_funnel.page_view', 'j_a', 21, route='/portal/teacher/lessons'))
        lp = funnel.build(rows)['by_feature']['lesson_plan']
        self.assertEqual(dict((s['name'], s['n']) for s in lp['steps'])['opened'], 1)

    def test_a_failed_open_is_not_an_open(self):
        rows = [bot('app_funnel.command', 'j_a', 0, 'menu', door='menu_command', verdict='link'),
                bot('app_funnel.link_sent', 'j_a', 0, 'menu', via='cta_url'),
                row('app_link.open', 'j_a', 1, outcome='invalid')]
        menu = funnel.build(rows)['by_feature']['menu']
        self.assertEqual(dict((s['name'], s['n']) for s in menu['steps'])['opened'], 0)
        self.assertEqual(menu['open_outcomes'], {'invalid': 1})

    def test_direct_sessions_are_reported_apart(self):
        rows = journey_full('j_a', pages=('/portal/teacher/lessons',))
        rows += [row('app_funnel.page_view', None, 5, user='u9', route='/portal/teacher', appSessionId='s1'),
                 row('app_funnel.page_view', None, 6, user='u9', route='/portal/teacher/classes', appSessionId='s1'),
                 row('app_funnel.page_view', None, 7, user='u8', route='/portal/dashboard', appSessionId='s2')]
        res = funnel.build(rows)
        self.assertEqual(res['direct'], {'sessions': 2, 'users': 2, 'views': 3})

    def test_rows_without_a_journey_never_enter_the_funnel(self):
        rows = [row('app_funnel.page_view', None, 1, route='/portal/teacher')]
        self.assertEqual(funnel.build(rows)['by_feature'], {})

    def test_telemetry_rows_for_journeys_with_no_command_row_are_orphans_not_funnels(self):
        # e.g. the command fell before the window: the page rows alone cannot say which command started it
        rows = [row('app_link.open', 'j_x', 1, outcome='ok', feature='lesson_plan'), row('app_funnel.page_view', 'j_x', 2, route='/portal/teacher/lessons')]
        res = funnel.build(rows)
        self.assertEqual(res['by_feature'], {})
        self.assertEqual(res['orphan_journeys'], 1)

    def test_door_breakdown(self):
        rows = []
        rows += journey_full('j_a', feature='lesson_plan')
        rows += [bot('app_funnel.command', 'j_b', 0, 'lesson_plan', door='intent', verdict='link'), bot('app_funnel.link_sent', 'j_b', 0, 'lesson_plan', via='cta_url')]
        doors = funnel.build(rows)['by_feature']['lesson_plan']['doors']
        self.assertEqual(doors, {'command': 1, 'intent': 1})

    def test_render_is_text_and_names_every_step(self):
        out = funnel.render(funnel.build(journey_full('j_a', pages=('/portal/teacher/lessons',))), label='unit')
        for word in ('lesson_plan', 'asked', 'link_sent', 'opened', 'landed', 'went_deeper', 'acted', '/portal/teacher/lessons'):
            self.assertIn(word, out)


class Rows(unittest.TestCase):
    def test_data_json_is_merged_and_top_level_wins(self):
        r = funnel.flat({'event': 'x', 'feature': 'menu', 'data_json': json.dumps({'feature': 'classes', 'door': 'chip'})})
        self.assertEqual((r['feature'], r['door']), ('menu', 'chip'))

    def test_bad_data_json_is_ignored(self):
        self.assertEqual(funnel.flat({'event': 'x', 'data_json': '{nope'})['event'], 'x')

    def test_time_bounds_for_a_pk_day(self):
        a, b = funnel.pk_day_bounds('2026-10-13')
        self.assertEqual((a, b), ('2026-10-12T19:00:00Z', '2026-10-13T19:00:00Z'))


if __name__ == '__main__':
    unittest.main()
