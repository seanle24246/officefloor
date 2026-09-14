"""Chromium-independent ASTRA contracts, applied to served and wheel sources."""
import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def function(source, name):
    return next(n for n in ast.walk(ast.parse(source))
                if isinstance(n, ast.FunctionDef) and n.name == name)


def check_sources(read):
    # Parse the distributed resolver, not a separately imported checkout copy.
    resolver = ast.unparse(function(read('server/roots.py'), 'state_dir'))
    assert "directory / 'demo' if is_demo else directory" in resolver, 'demo override isolation'
    assert "os.environ.get('OFFICE_STATE')" in resolver, 'environment precedence'
    assert "if not is_demo and legacy.is_dir():" in resolver, 'live legacy root preserved'
    assert "hashlib.sha256" in resolver, 'org-specific default state'
    assert resolver.index('STATE_AUTHORITY_MARKER') < resolver.index('legacy.is_dir()'), 'recorded default survives later legacy directory'
    marker = ast.unparse(function(read('server/roots.py'), 'remember_state_dir'))
    assert 'dir_fd=' not in marker and 'safe_fs' not in marker, 'launch marker uses portable file operations'
    assert "with open(temporary, 'xb') as output:" in marker
    assert 'os.replace(temporary, marker)' in marker, 'atomic cross-platform publication'
    assert marker.index('output.flush()') < marker.index('os.replace(temporary, marker)'), 'publish only a complete marker'
    assert "os.name != 'nt'" in marker and "hasattr(os, 'O_DIRECTORY')" in marker and "hasattr(os, 'fsync')" in marker, 'optional platform durability'
    assert 'except Exception as exc:' in marker and 'continuing' in marker and 'file=sys.stderr' in marker, 'marker failure cannot abort startup'
    assert 'roots.state_dir(ctx)' in ast.unparse(function(read('server/ledger.py'), 'default_path'))
    assert 'roots.remember_state_dir(launch_world.ctx' in read('serve.py')
    store = ast.unparse(function(read('server/customization_store.py'), 'for_ctx'))
    assert 'directory = roots.state_dir(ctx)' in store, 'customization uses shared state resolver'
    http = read('server/http.py')
    directory = ast.unparse(function(http, '_floor_config_directory'))
    assert 'roots.state_dir(target_world.ctx)' in directory, 'selected floor state authority'
    migration = ast.unparse(function(http, '_floor_config_for_layout'))
    assert "getattr(target_world, 'demo', False)" in migration and migration.index("getattr(target_world, 'demo', False)") < migration.index('legacy ='), 'demo cannot consume legacy'
    assert 'with type(self)._floor_config_lock, _floor_config_file_lock(directory):' in migration
    assert migration.index('_floor_config_file_lock(directory)') < migration.index('floor_config.load('), 'GET locks before any destination read'
    assert migration.index('_floor_config_file_lock(directory)') < migration.index('legacy.exists()'), 'GET locks before migration inspection'
    assert 'with type(self)._floor_config_lock, _floor_config_file_lock(config_dir):' in ast.unparse(function(http, '_post_floor_config'))
    lock = ast.unparse(function(http, '_floor_config_file_lock'))
    assert "directory / '.floor-config.lock'" in lock and 'fcntl.flock' in lock and 'msvcrt.locking' in lock
    assert 'legacy.rename(retired)' in migration and '.exists()' in migration, 'one-time migration preserves newer saves'
    assert migration.index('floor_config.save(') < migration.index('_fsync_floor_config_directory(directory)') < migration.index('legacy.rename(retired)'), 'destination durable before retirement'
    assert migration.index('_claim_floor_config_migration(') < migration.index('floor_config.save('), 'upgrade bound to one org before save'
    notice = read('static/nux.setup.js')
    assert 'meta[name="officefloor-version"]' in notice
    assert 'It reads your repos and never writes to them.' in notice
    assert 'Settings stay in this browser.' in notice and 'are on by default.' in notice
    assert 'officefloor-version' in read('serve.py') and 'version_string()' in read('serve.py')
    state = read('static/office.state.js')
    assert 'claims: root.OFFICE.webgl.getRuntime().sceneSpec.spatial.claims' in state
    assert 'spatialSnapshot: placementSpatialSnapshot' in state
    adapter = read('static/office.webgl.adapter.js')
    assert 'claims: sourceWorldClaims.get(world)' in adapter
    assert "authority: editFrozen ? 'edit-frozen' : 'published'" in adapter
    scene = read('static/office.webgl.scene.js').split('export function refreshEditProjection(sources)', 1)[1]
    assert 'if (frozen) runtime.floorFrozen = true' in scene and scene.index('if (frozen) runtime.floorFrozen = true') < scene.index('builder(sceneSpec'), 'synchronous freeze precedes registry build'
    theme = read('static/office.theme.js')
    assert "'Officefloor — '" in theme
    options = theme.split("key: 'theme'", 1)[1].split('});', 1)[0]
    assert 'tokyo' not in options and "key !== 'tokyo'" in theme and '.filter(isSelectableTheme)' in theme, 'public themes exclude Tokyo'


class AstraStaticTests(unittest.TestCase):
    def test_served_sources(self):
        check_sources(lambda name: (ROOT / name).read_text())

    def test_mutations_are_rejected(self):
        cases = (
            ('server/roots.py', "directory / \"demo\" if is_demo else directory", 'directory'),
            ('server/roots.py', 'os.replace(temporary, marker)', 'os.rename(temporary, marker)'),
            ('server/customization_store.py', 'directory = roots.state_dir(ctx)', 'directory = ctx.ceo'),
            ('server/http.py', 'getattr(target_world, "demo", False)', 'False'),
            ('server/http.py', '_floor_config_file_lock(config_dir)', 'nullcontext()'),
            ('static/office.webgl.scene.js', 'if (frozen) runtime.floorFrozen = true;', ''),
        )
        for filename, old, new in cases:
            with self.subTest(filename=filename, mutation=old):
                self.assertIn(old, (ROOT / filename).read_text())
                def read(name):
                    text = (ROOT / name).read_text()
                    return text.replace(old, new) if name == filename else text
                with self.assertRaises(AssertionError):
                    check_sources(read)


if __name__ == '__main__':
    unittest.main()
