"""The shared admission boundary; admitted lane names are opaque literals."""

import unicodedata


def valid_lane_name(name: object) -> bool:
    """A lane is one visible filesystem component, never a qualified key."""
    return (isinstance(name, str) and bool(name) and not name.startswith('.')
            and name == name.strip()
            and not any(unicodedata.category(ch) == 'Cc' for ch in name)
            and not any(character in name for character in (':', '/', '\\', '\0')))
