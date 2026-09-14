"""SEATING-01: default room eligibility must work for unconfigured orgs."""
import copy
import unittest
from server import floorplan


class RoomEligibilityTests(unittest.TestCase):
    def test_stranger_lanes_default_to_bullpen(self):
        for lane in ('research', 'api', 'notes', 'codex-office-review-david'):
            with self.subTest(lane=lane):
                self.assertEqual(floorplan.room_for('', lane), 'bullpen')

    def test_pool_roles_default_to_bullpen(self):
        self.assertEqual(floorplan.room_for(
            'sol xhigh — idle, provisioned 2026-09-04',
            'codex-office-sol-creed'), 'bullpen')

    def test_authored_roles_keep_their_room(self):
        for role, room in [('REVIEW — audit', 'review'), ('CEO', 'ceo'), ('CTO', 'csuite')]:
            with self.subTest(role=role):
                self.assertEqual(floorplan.room_for(role, 'research'), room)

    def test_ruled_capacity_fallback_preserves_aisles_and_chairs(self):
        # B authorizes pitch tightening only, keeping the authored first row.
        # A desk tile plus chair tile needs pitch >=3 for a one-tile aisle.
        room = next(r for r in floorplan.ROOMS if r[0] == 'bullpen')
        desks = floorplan.BULLPEN_DESKS
        self.assertEqual(len(desks), 10)
        ys = sorted({d['y'] for d in desks})
        self.assertEqual(ys, [12, 15])
        self.assertGreaterEqual(ys[1] - ys[0] - 2, 1)
        for d in desks:
            self.assertGreaterEqual(d['x'], room[2])
            self.assertLessEqual(d['x'] + 2, room[2] + room[4])
            self.assertGreaterEqual(d['y'], room[3])
            self.assertLessEqual(d['y'] + 2, room[3] + room[5])
        max_three_row_pitch = (room[3] + room[5] - 2 - ys[0]) / 2
        self.assertEqual(max_three_row_pitch, 2)
        self.assertLess(max_three_row_pitch, 3)


class QueueCandidateTests(unittest.TestCase):
    def setUp(self):
        seats = [
            {'lane': 'ceo', 'role': 'CEO'},
            {'lane': 'reviewer', 'role': 'REVIEW — audit'},
        ]
        self.layout = floorplan.build_layout(seats, [])

    def test_authored_tiles_lead_then_remaining_tiles_use_reading_order(self):
        candidates = floorplan.queue_candidates('review', self.layout)
        authored = [dict(point) for point in floorplan.REVIEW_QUEUE]
        self.assertEqual(candidates[:len(authored)], authored)
        remaining = candidates[len(authored):]
        self.assertEqual(
            [(point['x'], point['y']) for point in remaining],
            sorted([(point['x'], point['y']) for point in remaining],
                   key=lambda point: (point[1], point[0])),
        )
        self.assertEqual(len(candidates), len({(p['x'], p['y']) for p in candidates}))

        occupied = {
            (self.layout['desks']['reviewer']['x'],
             self.layout['desks']['reviewer']['y']),
            (self.layout['seats']['reviewer']['x'],
             self.layout['seats']['reviewer']['y']),
        }
        self.assertTrue(occupied.isdisjoint((p['x'], p['y']) for p in candidates))

    def test_ceo_candidates_avoid_furniture_props_and_doors(self):
        candidates = floorplan.queue_candidates('ceo', self.layout)
        points = {(point['x'], point['y']) for point in candidates}
        self.assertEqual(
            candidates[:len(floorplan.DOOR_QUEUE)],
            [dict(point) for point in floorplan.DOOR_QUEUE],
        )
        for blocked in (
            self.layout['ceo_desk'], self.layout['ceo_seat'],
            self.layout['founder_door'], self.layout['doors'][0],
        ):
            with self.subTest(blocked=blocked):
                self.assertNotIn((int(blocked['x']), int(blocked['y'])), points)

    def test_validator_accepts_authored_layout_and_rejects_illegal_mutation(self):
        self.assertIsNone(floorplan.validate_queues(self.layout))
        mutated = copy.deepcopy(self.layout)
        mutated['props'].append({
            'type': 'fixture',
            **floorplan.REVIEW_QUEUE[0],
        })
        with self.assertRaisesRegex(AssertionError, 'review queue tile 0 is not legal'):
            floorplan.validate_queues(mutated)

    def test_waiting_margin_excludes_all_four_edges_in_every_room(self):
        for room in self.layout['rooms']:
            if room.get('outdoor'):
                continue
            for y in range(room['y'], room['y'] + room['h']):
                for x in range(room['x'], room['x'] + room['w']):
                    expected = (room['x'] < x < room['x'] + room['w'] - 1
                                and room['y'] < y < room['y'] + room['h'] - 1)
                    with self.subTest(room=room['id'], tile=(x, y)):
                        self.assertEqual(
                            floorplan._queue_tile_is_legal(room, (x, y), set()),
                            expected,
                        )

    def test_capacity_and_authored_wall_tile_rejection(self):
        layout = floorplan.build_layout([], [])
        self.assertEqual(len(floorplan.queue_candidates('review', layout)), 49)
        self.assertEqual(len(floorplan.queue_candidates('ceo', layout)), 53)
        for point in ({'x': 25, 'y': 0}, {'x': 23, 'y': 4},
                      {'x': 31, 'y': 4}, {'x': 25, 'y': 8}):
            mutated = copy.deepcopy(layout)
            mutated['ceo_queue'][0] = point
            with self.subTest(point=point):
                self.assertNotIn(point, floorplan.queue_candidates('review', mutated))
                with self.assertRaisesRegex(AssertionError, 'not legal'):
                    floorplan.validate_queues(mutated)

    def test_validator_rejects_duplicate_authored_tiles(self):
        mutated = copy.deepcopy(self.layout)
        mutated['door_queue'][1] = dict(mutated['door_queue'][0])
        with self.assertRaisesRegex(AssertionError, 'duplicates authored tile'):
            floorplan.validate_queues(mutated)
