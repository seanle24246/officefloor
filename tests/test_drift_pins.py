import unittest

class StatusFieldsLiteralPin(unittest.TestCase):
    """An upstream widening or rename breaks HERE, in our gates, not silently on the shared floor."""

    def test_status_fields(self):
        from server import lanesource
        self.assertEqual(lanesource.STATUS_FIELDS, (
            "present", "alive", "liveness_known", "frozen", "ready_for_pr",
            "blocked", "owes_reply", "done", "last_output_age",
            "decision_needed", "branch", "task", "blockers", "next"
        ))

class DoctrineMatrix(unittest.TestCase):
    """GL-18 P3: literal classify() verdicts for the canonical field combos.

    These verdicts are the shared-floor doctrine. A drift in states.classify()
    lands as a RED here, in our gates, not silently on the floor. Flip any one
    expected verdict and this test turns RED.
    """

    @staticmethod
    def agent(**over):
        base = {
            "present": True, "alive": True, "liveness_known": True,
            "frozen": False, "ready_for_pr": False, "blocked": False,
            "owes_reply": False, "decision_needed": "",
        }
        base.update(over)
        return base

    def test_canonical_verdicts(self):
        from server import states
        cases = [
            # (label, agent-fields, expected verdict)
            ("absent",                dict(present=False),                                   "absent"),
            ("alive+claimed-ready",   dict(ready_for_pr=True),                               "delivering"),
            ("alive+asking",          dict(decision_needed="blocked on X"),                  "asking"),
            ("alive+blocked",         dict(blocked=True),                                    "blocked"),
            ("alive+owed",            dict(owes_reply=True),                                 "reading"),
            ("alive+working",         dict(last_output_age=10),                              "working"),
            ("alive+idle",            dict(last_output_age=600),                             "idle"),
            ("alive+done+quiet",      dict(done=True, last_output_age=60),                   "idle"),
            ("alive+done+sweep-wins", dict(done=True, last_output_age=10),                   "working"),
            ("alive+frozen",          dict(frozen=True),                                     "frozen"),
            ("no-lsof+blocked",       dict(liveness_known=False, blocked=True),              "blocked"),
            ("no-lsof+unblocked",     dict(liveness_known=False),                            "unknown"),
            # ghosted states: the OF-12 fold has already cleared ready_for_pr /
            # decision_needed and set alive=False before classify runs.
            ("ghost+was-delivering",  dict(alive=False, ready_for_pr=False,
                                           decision_needed="", owes_reply=False),            "bench"),
            ("ghost+owed",            dict(alive=False, owes_reply=True),                    "dead"),
        ]
        for label, over, expected in cases:
            with self.subTest(label=label):
                self.assertEqual(states.classify(self.agent(**over)), expected,
                                 f"{label}: expected {expected}")
