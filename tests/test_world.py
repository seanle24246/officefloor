"""SEATING-01: desk holds that any capacity fix must preserve."""
import tempfile
import unittest
from pathlib import Path
from server import roots
from server.world import World


def seat(lane):
    return {'lane': lane, 'role': '', 'name': lane, 'emoji': '', 'engine': 'unknown', 'model': ''}


class DeskHoldTests(unittest.TestCase):
    def test_holds_keep_sticky_claim_and_stand_down_releases_it(self):
        with tempfile.TemporaryDirectory() as raw:
            world = World(ctx=roots.OrgCtx.from_root(Path(raw)), seats=[seat('research')])
            agent = {'lane': 'research', 'state': 'working', 'alive': True}
            world._seat_bullpen([agent])
            first = dict(agent['desk'])
            for state, alive in [('reading', True), ('dead', False),
                                 ('asking', False), ('delivering', False)]:
                agent.update(state=state, alive=alive)
                world._seat_bullpen([agent])
                self.assertEqual(agent['desk'], first)
                self.assertEqual(world.desk_claims, {'research': 0})
            agent.update(state='bench', alive=False)
            world._seat_bullpen([agent])
            self.assertEqual(agent['desk']['kind'], 'none')
            self.assertEqual(world.desk_claims, {})

    def test_recency_orders_new_claims_without_eviction(self):
        with tempfile.TemporaryDirectory() as raw:
            lanes = [f'a{i:02}' for i in range(10)] + ['z-new', 'missing']
            world = World(ctx=roots.OrgCtx.from_root(Path(raw)), seats=[seat(x) for x in lanes])
            agents = [dict(lane=x, state='working', alive=True,
                           status_mins=1497, ctx_age_min=None) for x in lanes[:-1]]
            agents.append(dict(lane='missing', state='working', alive=True))
            agents[-2]['ctx_age_min'] = 1
            world._seat_bullpen(agents)
            self.assertEqual(world.desk_claims['z-new'], 0)
            self.assertNotIn('a09', world.desk_claims)
            self.assertNotIn('missing', world.desk_claims)
            first = dict(world.desk_claims)
            agents[-1]['status_mins'] = 0
            agents[0]['state'] = 'frozen'
            world._seat_bullpen(list(reversed(agents)))
            self.assertEqual(world.desk_claims, first)
            agents[0].update(state='bench', alive=True)
            world._seat_bullpen(agents)
            self.assertNotIn('a00', world.desk_claims)
            self.assertEqual(world.desk_claims['missing'], first['a00'])
            self.assertNotEqual(agents[0]['offduty'], 'no desk free')

    def test_reading_hold_absence_and_removed_desks(self):
        with tempfile.TemporaryDirectory() as raw:
            world = World(ctx=roots.OrgCtx.from_root(Path(raw)), seats=[seat('research')])
            agent = dict(lane='research', state='reading', alive=False)
            world._seat_bullpen([agent])
            self.assertEqual(world.desk_claims, {'research': 0})
            world.removed_bullpen_desks = frozenset({0})
            world._seat_bullpen([agent])
            self.assertEqual(world.desk_claims, {'research': 1})
            agent.update(state='absent', alive=True)
            world._seat_bullpen([agent])
            self.assertEqual(world.desk_claims, {})
