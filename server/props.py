"""Render-only office prop registrations."""

# Wall-mounted props (those with an "edge") hang on a back wall and are drawn
# with the walls; everything else is furniture and gets depth-sorted with the
# avatars. The renderer switches on "type" — adding a prop is a line here.
PROPS = [
    # the corner office
    {"type": "art",        "x": 5,    "y": 1,    "edge": "n", "kind": "crown"},
    # the boardroom
    {"type": "whiteboard", "x": 15,   "y": 1,    "edge": "n"},
    # the bullpen
    {"type": "clock",      "x": 9,    "y": 10,   "edge": "n"},
    {"type": "rack",       "x": 1.15, "y": 15.1},
    # the lounge
    {"type": "couch",      "x": 24,   "y": 11,   "w": 3.0, "d": 1.0},
    # the kitchen
    # Explicit legacy ids keep saved authored overrides aimed at the same props
    # after the former authored:prop:5 ping-pong table was removed.
    {"id": 6,  "type": "counter",    "x": 3,    "y": 20,   "w": 5.0, "d": 1.0},
    {"id": 7,  "type": "espresso",   "x": 3.3,  "y": 20.1},
    {"id": 8,  "type": "fridge",     "x": 9,    "y": 20},
    {"id": 9,  "type": "crate",      "x": 10.4, "y": 20.2},
    {"id": 10, "type": "cooler",     "x": 1.1,  "y": 20.1},
    {"id": 11, "type": "table",      "x": 4,    "y": 22},
    {"id": 12, "type": "table",      "x": 7,    "y": 22},
    # F1/F2 — append-only, render-only amenities; collector behavior is unchanged.
    {"id": 13, "type": "smashscreen", "x": 19.1, "y": 19,   "edge": "n"},
    {"id": 14, "type": "smashcouch",  "x": 18.1, "y": 23.1, "w": 3.2, "d": 0.7},
    {"id": 15, "type": "beerpong",    "x": 4,    "y": 22,   "w": 4.0, "d": 1.0},
]
