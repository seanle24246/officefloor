"""STATE-ROOT-01: precedence, lazy creation, org isolation and store routing."""
import hashlib
import contextlib
import io
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import subprocess
import sys
import textwrap
import unittest
from unittest.mock import patch

from server import roots, floor_config, officestate, customization_store, agent_identity, ledger
from server.http import Handler


class StateRootTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.ctx = roots.OrgCtx.from_root(self.base / 'org')
        self.ctx.allrepos.mkdir()
        self.env = patch.dict(os.environ, {'XDG_STATE_HOME': str(self.base / 'user-state')})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.no_override = patch.dict(os.environ)
        self.no_override.start()
        self.addCleanup(self.no_override.stop)
        os.environ.pop('OFFICE_STATE', None)
        self.saved = roots._STATE_OVERRIDE, roots._STATE_DEMO
        roots.configure_state()
        self.addCleanup(lambda: roots.configure_state(self.saved[0], demo=self.saved[1]))

    def test_precedence_and_no_creation(self):
        key = 'org-' + hashlib.sha256(str(self.ctx.allrepos).encode()).hexdigest()[:8]
        default = self.base / 'user-state' / 'officefloor' / key
        self.assertEqual(roots.state_dir(self.ctx), default)
        self.assertFalse(default.exists())
        legacy = self.ctx.ceo / 'state'
        legacy.mkdir(parents=True)
        self.assertEqual(roots.state_dir(self.ctx), legacy)
        env = self.base / 'env'
        os.environ['OFFICE_STATE'] = str(env)
        self.assertEqual(roots.state_dir(self.ctx), env)
        cli = self.base / 'cli'
        roots.configure_state(str(cli))
        self.assertEqual(roots.state_dir(self.ctx), cli)
        self.assertFalse(cli.exists())
        self.assertFalse(env.exists())

    def test_restart_with_comms_preserves_first_launch_authority(self):
        repo = Path(__file__).resolve().parents[1]
        command = [sys.executable, str(repo / 'serve.py'), '--allrepos',
                   str(self.ctx.allrepos), '--once', '--json']
        first = subprocess.run(command, capture_output=True, text=True, timeout=15)
        self.assertEqual(first.returncode, 0, first.stderr)
        directory = roots.state_dir(self.ctx)
        self.assertTrue((directory / roots.STATE_AUTHORITY_MARKER).is_file())
        design = {'version': 1, 'placements': [], 'authored_overrides': {}}
        floor_config.save(directory, 'default', design)
        second = subprocess.run(command + ['--allow-comms'], capture_output=True,
                                text=True, timeout=15)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(roots.state_dir(self.ctx), directory)
        self.assertEqual(floor_config.load(directory, 'default'), design)
        self.assertTrue((directory / 'office/actions.jsonl').is_file())
        self.assertFalse((self.ctx.ceo / 'state').exists())
        # Even a later external legacy-directory creation cannot flip authority.
        (self.ctx.ceo / 'state').mkdir(parents=True)
        self.assertEqual(roots.state_dir(self.ctx), directory)
        self.assertEqual(ledger.default_path(self.ctx), directory / 'office/actions.jsonl')
        self.assertEqual(ledger.Ledger(root=self.ctx.ceo).path,
                         self.ctx.ceo / ledger.LEDGER_RELATIVE_PATH)

    def test_demo_and_distinct_orgs(self):
        self.assertEqual(roots.state_dir(self.ctx, demo=True),
                         self.base / 'user-state/officefloor/demo')
        other = roots.OrgCtx.from_root(self.base / 'other/org')
        self.assertNotEqual(roots.state_dir(self.ctx), roots.state_dir(other))

    def test_marker_portability_and_failure_do_not_prevent_http_launch(self):
        """Normal/demo startup must reach a real HTTP response without POSIX APIs."""
        launcher = textwrap.dedent('''\
            import json, os, sys, threading, urllib.request
            from unittest.mock import patch
            import serve
            from server import roots

            scenario = sys.argv.pop(1)
            real_open = os.open
            def portable_open(path, flags, mode=0o777, *, dir_fd=None):
                if dir_fd is not None or os.path.isdir(path):
                    raise NotImplementedError('POSIX directory operations unavailable')
                return real_open(path, flags, mode)

            def exercise_http(server):
                results = []
                def request():
                    with urllib.request.urlopen(
                            'http://127.0.0.1:%d/api/state' % server.server_port,
                            timeout=5) as response:
                        results.append((response.status, json.load(response)))
                worker = threading.Thread(target=request, daemon=True)
                worker.start()
                server.timeout = 5
                server.handle_request()
                worker.join(timeout=6)
                server.server_close()
                assert results and results[0][0] == 200, results
                assert 'agents' in results[0][1], results
                print('PASS portable launch HTTP 200')

            # Simulate missing Windows directory APIs and optional fsync.
            for name in ('O_DIRECTORY', 'fsync'):
                if hasattr(os, name):
                    delattr(os, name)
            with patch.object(os, 'open', portable_open), \\
                 patch.object(serve.ThreadingHTTPServer, 'serve_forever', exercise_http):
                if scenario == 'write-failure':
                    with patch('server.roots.open', create=True,
                               side_effect=PermissionError('marker unavailable')):
                        result = serve.main()
                else:
                    result = serve.main()
            assert result == 0, result
            marker = roots.state_dir() / roots.STATE_AUTHORITY_MARKER
            assert marker.is_file() == (scenario == 'portable'), marker
        ''')
        for demo in (False, True):
            for scenario in ('portable', 'write-failure'):
                with self.subTest(demo=demo, scenario=scenario):
                    env = dict(os.environ, XDG_STATE_HOME=str(
                        self.base / f'launch-{demo}-{scenario}'))
                    command = [sys.executable, '-c', launcher, scenario,
                               '--allrepos', str(self.ctx.allrepos), '--port', '0']
                    if demo:
                        command.append('--demo')
                    result = subprocess.run(command, cwd=roots.HERE, env=env,
                                            capture_output=True, text=True, timeout=15)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn('PASS portable launch HTTP 200', result.stdout)
                    warnings = [line for line in result.stderr.splitlines()
                                if 'could not fully record state authority' in line]
                    self.assertEqual(len(warnings), int(scenario == 'write-failure'))

    def test_marker_failures_are_nonfatal_and_atomic(self):
        directory = roots.state_dir(self.ctx)
        for operation in ('mkdir', 'open', 'replace', 'fsync'):
            with self.subTest(operation=operation):
                target = {'mkdir': 'pathlib.Path.mkdir', 'open': 'server.roots.open',
                          'replace': 'server.roots.os.replace',
                          'fsync': 'server.roots.os.fsync'}[operation]
                with patch(target, create=True, side_effect=OSError('unavailable')), \
                     contextlib.redirect_stderr(io.StringIO()) as output:
                    self.assertEqual(roots.remember_state_dir(self.ctx), directory)
                self.assertEqual(len(output.getvalue().splitlines()), 1)
                marker = directory / roots.STATE_AUTHORITY_MARKER
                if operation == 'fsync':
                    self.assertEqual(marker.read_bytes(), b'officefloor state authority v1\n')
                else:
                    self.assertFalse(marker.exists(), 'failed write must not publish partial marker')
                self.assertEqual(list(directory.glob('*.tmp')), [])

    def test_directory_sync_failure_keeps_complete_marker(self):
        import stat
        real_fsync = os.fsync
        def no_directory_sync(descriptor):
            if stat.S_ISDIR(os.fstat(descriptor).st_mode):
                raise OSError('directory fsync unsupported')
            return real_fsync(descriptor)
        with patch.object(os, 'fsync', no_directory_sync), \
             contextlib.redirect_stderr(io.StringIO()) as output:
            directory = roots.remember_state_dir(self.ctx)
        self.assertEqual((directory / roots.STATE_AUTHORITY_MARKER).read_bytes(),
                         b'officefloor state authority v1\n')
        expected_warnings = int(os.name != 'nt' and hasattr(os, 'O_DIRECTORY'))
        self.assertEqual(len(output.getvalue().splitlines()), expected_warnings)

    def test_demo_isolates_every_override_before_opening_customization(self):
        os.environ['OFFICE_STATE'] = str(self.base / 'live-env')
        for cli in (None, str(self.base / 'live-cli')):
            with self.subTest(cli=cli):
                roots.configure_state(cli)
                live = customization_store.CustomizationStore.for_ctx(
                    self.ctx, 'sha256:' + 'a' * 64)
                roots.configure_state(cli, demo=True)
                demo = customization_store.CustomizationStore.for_ctx(
                    self.ctx, 'sha256:' + 'a' * 64)
                self.assertEqual(demo.path.parent, live.path.parent / 'demo')
                self.assertEqual(roots.state_dir(self.ctx), demo.path.parent)
                self.assertFalse(demo.path.parent.exists(), 'resolution remains lazy')
        self.assertEqual(roots.state_dir(self.ctx, override=str(self.base / 'direct')),
                         self.base / 'direct/demo')

    def test_private_write_and_all_product_stores_share_root(self):
        directory = roots.state_dir(self.ctx)
        store = customization_store.CustomizationStore.for_ctx(self.ctx, 'sha256:' + 'a' * 64)
        self.assertEqual(store.path.parent, directory)
        self.assertEqual(agent_identity.AgentIdentityRegistry.for_ctx(self.ctx).path.parent, directory)
        self.assertFalse(directory.exists())
        store.load()
        design = {'version': 2, 'placements': [], 'authored_overrides': {}, 'entity_overrides': {}}
        floor_config.save(directory, 'default', design)
        self.assertEqual(floor_config.load(directory, 'default'), design)
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(list(self.ctx.allrepos.iterdir()), [])
        roots.configure_state(str(directory))
        self.assertEqual(officestate._office_state_dir(''), directory)
        self.assertIsNone(officestate._office_state_dir(None), 'truth collector remains opt-in')

    def test_legacy_keeps_descriptor_guard_against_symlink(self):
        outside = self.base / 'outside'
        outside.mkdir()
        self.ctx.ceo.mkdir()
        (self.ctx.ceo / 'state').symlink_to(outside, target_is_directory=True)
        store = customization_store.CustomizationStore.for_ctx(self.ctx, 'sha256:' + 'a' * 64)
        with self.assertRaises(customization_store.InvalidStore):
            store.load()
        self.assertEqual(list(outside.iterdir()), [])

    def legacy_handler(self):
        class UpgradeHandler(Handler):
            floor_config_dir = None

        handler = object.__new__(UpgradeHandler)
        install = self.base / 'old-install'
        patcher = patch.object(roots, 'HERE', install)
        patcher.start()
        self.addCleanup(patcher.stop)
        design = {'version': 1, 'placements': [], 'authored_overrides': {
            'authored:bullpen-desk:1': {'id': 'authored:bullpen-desk:1', 'removed': True},
        }}
        floor_config.save(install / 'data', 'default', design)
        return handler, install / 'data' / 'floor-config.default.json', design

    def test_anonymous_legacy_save_migrates_once_across_orgs(self):
        handler, legacy, design = self.legacy_handler()
        first = SimpleNamespace(ctx=self.ctx)
        second = SimpleNamespace(ctx=roots.OrgCtx.from_root(self.base / 'other'))
        original = legacy.read_bytes()
        self.assertEqual(handler._floor_config_for_layout('default', first), design)
        self.assertEqual(floor_config.load(roots.state_dir(first.ctx), 'default'), design)
        self.assertFalse(legacy.exists())
        retired, = legacy.parent.glob(legacy.name + '.migrated-*')
        self.assertEqual(retired.read_bytes(), original)
        self.assertIsNone(handler._floor_config_for_layout('default', second))
        self.assertIsNone(floor_config.load(roots.state_dir(second.ctx), 'default'))
        # A new handler represents a later restart; retirement is durable.
        restarted = object.__new__(type(handler))
        self.assertIsNone(restarted._floor_config_for_layout('default', second))
        self.assertEqual(restarted._floor_config_for_layout('default', first), design)

    def test_demo_startup_leaves_legacy_for_first_live_startup(self):
        handler, legacy, design = self.legacy_handler()
        original = legacy.read_bytes()
        roots.configure_state(demo=True)
        demo = SimpleNamespace(ctx=self.ctx, demo=True)
        self.assertIsNone(handler._floor_config_for_layout('default', demo))
        self.assertEqual(legacy.read_bytes(), original)
        self.assertEqual(list(legacy.parent.glob('*.migrated-*')), [])
        self.assertIsNone(floor_config.load(roots.state_dir(self.ctx), 'default'))
        roots.configure_state()
        live = SimpleNamespace(ctx=self.ctx, demo=False)
        self.assertEqual(handler._floor_config_for_layout('default', live), design)
        self.assertFalse(legacy.exists())
        self.assertEqual(floor_config.load(roots.state_dir(self.ctx), 'default'), design)

    def test_migration_never_overwrites_a_newer_or_invalid_save(self):
        handler, legacy, design = self.legacy_handler()
        current = roots.state_dir(self.ctx)
        newer = {**design, 'authored_overrides': {}}
        floor_config.save(current, 'default', newer)
        for content, expected in ((None, newer), (b'invalid new save', None)):
            with self.subTest(content=content):
                floor_config.save(legacy.parent, 'default', design)
                if content is not None:
                    (current / legacy.name).write_bytes(content)
                before = (current / legacy.name).read_bytes()
                self.assertEqual(handler._floor_config_for_layout(
                    'default', SimpleNamespace(ctx=self.ctx)), expected)
                self.assertEqual((current / legacy.name).read_bytes(), before)
                self.assertFalse(legacy.exists())

    def test_interrupted_migration_retries_only_for_original_org(self):
        from server import http
        handler, legacy, design = self.legacy_handler()
        first = SimpleNamespace(ctx=self.ctx)
        other = SimpleNamespace(ctx=roots.OrgCtx.from_root(self.base / 'other'))
        directory = roots.state_dir(self.ctx)
        original_sync = http._fsync_floor_config_directory

        def interrupt_after_save(path):
            if path == directory:
                self.assertEqual(floor_config.load(directory, 'default'), design)
                self.assertTrue(legacy.exists(), 'legacy retired before destination fsync')
                raise SystemExit('simulated process interruption before directory fsync')
            original_sync(path)

        with patch.object(http, '_fsync_floor_config_directory', side_effect=interrupt_after_save):
            with self.assertRaises(SystemExit):
                handler._floor_config_for_layout('default', first)
        self.assertTrue(legacy.exists())
        self.assertIsNone(handler._floor_config_for_layout('default', other))
        self.assertTrue(legacy.exists(), 'another org must not consume the pending upgrade')
        restarted = object.__new__(type(handler))
        with patch.object(floor_config, 'save', side_effect=AssertionError('retry rewrote destination')):
            self.assertEqual(restarted._floor_config_for_layout('default', first), design)
        self.assertFalse(legacy.exists())
        self.assertEqual(len(list(legacy.parent.glob('*.migrated-*'))), 1)

    def test_interruption_before_destination_keeps_legacy_and_owner(self):
        handler, legacy, design = self.legacy_handler()
        first = SimpleNamespace(ctx=self.ctx)
        other = SimpleNamespace(ctx=roots.OrgCtx.from_root(self.base / 'other'))
        with patch.object(floor_config, 'save', side_effect=SystemExit('interrupted before save')):
            with self.assertRaises(SystemExit):
                handler._floor_config_for_layout('default', first)
        self.assertTrue(legacy.exists())
        self.assertIsNone(handler._floor_config_for_layout('default', other))
        self.assertEqual(handler._floor_config_for_layout('default', first), design)
        self.assertFalse(legacy.exists())

    def test_failed_migration_keeps_legacy_recoverable(self):
        handler, legacy, design = self.legacy_handler()
        first = SimpleNamespace(ctx=self.ctx)
        with patch.object(floor_config, 'save', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                handler._floor_config_for_layout('default', first)
        self.assertTrue(legacy.exists())
        self.assertEqual(list(legacy.parent.glob('*.migrated-*')), [])
        self.assertEqual(handler._floor_config_for_layout('default', first), design)


if __name__ == '__main__':
    unittest.main()
