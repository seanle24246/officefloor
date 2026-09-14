"""AGNOSTIC-01: filesystem admission and engine badges are independent."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from server import roster, roots
from server.collector_source import SessionSource


class AgnosticDiscovery(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.org = self.root / 'org'
        self.org.mkdir()
        self.ctx = roots.OrgCtx.from_root(self.org)
        for target, value in ((roots, {'HERE': self.root}),
                              (SessionSource, {'PROJECTS_ROOT': self.root / 'projects'})):
            for key, val in value.items():
                p = patch.object(target, key, val)
                p.start()
                self.addCleanup(p.stop)
        p = patch.dict(os.environ, {}, clear=True)
        p.start()
        self.addCleanup(p.stop)
        os.environ['CODEX_HOME'] = str(self.root / 'codex-home')

    def lane(self, name, outbox=True):
        d = self.org / name
        d.mkdir()
        if outbox:
            (d / 'OUTBOX.md').write_text('STATUS\nready_for_pr: true\n')
        return d

    def seats(self):
        return {s['lane']: s['engine'] for s in roster.load_roster(ctx=self.ctx, evidence=None)}

    def test_arbitrary_names_and_no_invention(self):
        expected = {'frontend': 'unknown', 'my-agent': 'opencode',
                    'gemini-worker': 'gemini', 'cursor_lane': 'cursor',
                    "Émilie's repo": 'unknown', 'codex-office-x': 'codex'}
        for name in expected:
            self.lane(name)
        (self.org / 'my-agent' / 'identity.env').write_text('ENGINE=opencode\n')
        self.lane('codex-just-a-name', False)
        plain = self.lane('plain-git', False)
        (plain / '.git').mkdir()
        self.assertEqual(self.seats(), expected)
        self.assertEqual(roster.ignored_outbox_folders(self.ctx), [])

    def test_reserved_names_are_skipped_before_any_adapter_or_lane_read(self):
        """AGNOSTIC-20: one boundary covers walk-ins, manifests and diagnostics."""
        import serve
        from server.lane_names import valid_lane_name
        valid = ['plain worker', "Émilie's repo", 'worker**tmp', '[x]', '?',
                 'worker__other', 'worker', 'worker2']
        reserved = ['a:b', '.hidden', 'x\\y', 'x/y', '.']
        whitespace = [' worker ', 'worker ', ' worker', ' ', '\t', 'control\x01name', 'control\x85name']
        for name in whitespace:
            self.lane(name)
        for name in valid + reserved[:3]:
            self.lane(name)
        (self.org / 'x/y').mkdir(parents=True)
        (self.org / 'x/y/OUTBOX.md').write_text('STATUS\n')
        self.ctx.ceo.mkdir()
        (self.ctx.ceo / 'bootstrap.sh').write_text(
            "cat <<'ROSTER'\n" + ''.join(
                f'codex | {name} | Fixture | X | IC | model\n' for name in reserved)
            + 'ROSTER\n')
        self.assertTrue(all(valid_lane_name(name) for name in valid))
        self.assertTrue(all(not valid_lane_name(name) for name in reserved + whitespace))
        for evidence in (False, None):
            with patch.object(roster, 'agent_signals', return_value=set()) as adapter:
                seats = roster.load_roster(ctx=self.ctx, evidence=evidence)
                self.assertEqual({s['lane'] for s in seats}, set(valid))
                self.assertTrue(all(valid_lane_name(call.args[0].name)
                                    for call in adapter.call_args_list))
        self.assertEqual(roster.reserved_lane_names(self.ctx), sorted(reserved + whitespace))
        lines = serve.startup_log_lines(seats, self.ctx, '127.0.0.1', 8787)
        diagnostics = [line for line in lines if 'skipped: reserved character' in line]
        self.assertEqual(len(diagnostics), 1)
        self.assertTrue(all(repr(name) in diagnostics[0] for name in reserved + whitespace))
        self.assertFalse(any('roster filters' in line for line in lines))
        for name in reserved[:3]:
            self.assertFalse(roster.is_agent_lane(self.org / name, {'codex'}))

    def test_repo_signals_and_external_claude_trace(self):
        for engine in roster.AGENT_DIRS:
            d = self.lane(f'plain-{engine}', False)
            (d / '.git').mkdir()
            (d / f'.{engine}').mkdir()
        d = self.lane('session-only', False)
        (d / '.git').write_text('gitdir: elsewhere')  # worktree .git is a file
        project = SessionSource().project_dir(d.resolve())
        project.mkdir(parents=True)
        (project / 'synthetic.jsonl').write_text(json.dumps({
            'type': 'user', 'timestamp': '2026-09-04T00:00:00Z',
            'cwd': str(d.resolve()), 'message': {'content': []}}) + '\n')
        self.assertEqual(self.seats(), {'session-only': 'claude'})

    def test_empty_and_config_only_directories_do_not_admit(self):
        for engine in roster.AGENT_DIRS:
            lane = self.lane(f'plain-{engine}', False)
            (lane / '.git').mkdir()
            config = lane / f'.{engine}'
            config.mkdir()
            self.assertFalse(roster.is_agent_lane(lane))
            (config / 'settings.json').write_text('{}\n')
            (config / 'identity.env').write_text(f'ENGINE={engine}\n')
            self.assertFalse(roster.is_agent_lane(lane))
        self.assertEqual(self.seats(), {})
        self.assertEqual(roster.ignored_outbox_folders(self.ctx), [])

    def test_outbox_admits_and_configuration_only_infers_badge(self):
        lane = self.lane('frontend')
        (lane / '.cursor').mkdir()
        (lane / 'OUTBOX.md').write_text('STATUS\nready_for_pr: false\n')
        self.assertEqual(self.seats(), {'frontend': 'cursor'})
        (lane / '.claude').mkdir()
        self.assertEqual(self.seats(), {'frontend': 'unknown'})
        (lane / 'identity.env').write_text('ENGINE=gemini\n')
        self.assertEqual(self.seats(), {'frontend': 'gemini'})


    def test_explicit_identity_and_conflicting_metadata(self):
        d = self.lane('codex-hint')
        (d / '.claude').mkdir()
        self.assertEqual(self.seats()['codex-hint'], 'claude')
        (d / '.codex').mkdir()
        self.assertEqual(self.seats()['codex-hint'], 'unknown')
        (d / 'identity.env').write_text('ENGINE=my-engine\nNAME=Somebody\n')
        self.assertEqual(self.seats()['codex-hint'], 'my-engine')

    def test_harvest_exemption_survives_safe_identity_reads(self):
        """AGNOSTIC-24: explicit identity and the legacy alias reach both world paths."""
        from server.world import World

        # CEO ruling 00:36: the legacy name alias remains alongside identity keys.
        expected = {'mr-pen-unmarked': True}
        self.lane('mr-pen-unmarked')
        for index, relative in enumerate(('identity.env', *(
                f'.{engine}/identity.env' for engine in roster.AGENT_DIRS))):
            name = f'plain worker {index}'
            lane = self.lane(name)
            identity = lane / relative
            identity.parent.mkdir(exist_ok=True)
            identity.write_text('NAME=Fixture\nHARVEST_EXEMPT="true"\n')
            self.assertEqual(roster.read_identity(lane)['HARVEST_EXEMPT'], 'true')
            expected[name] = True

        # A root-level explicit false must override an engine-level true.
        lane = self.lane('root override')
        (lane / '.claude').mkdir()
        (lane / '.claude/identity.env').write_text('HARVEST_EXEMPT=true\n')
        (lane / 'identity.env').write_text('HARVEST_EXEMPT=false\n')
        expected[lane.name] = False
        with patch.object(World, '_refresh_git'), patch.object(World, '_refresh_prs'), \
                patch.object(World, '_refresh_tmux'):
            world = World(ctx=self.ctx)
            for agents in (world._live_agents({'tmux': {}, 'processes': {}}),
                           world._demo_agents()):
                self.assertEqual({a['lane']: a['harvest_exempt'] for a in agents}, expected)

    def test_claude_slug_collision_requires_exact_session_cwd(self):
        """AGNOSTIC-03: a transcript may admit only its exact resolved cwd."""
        owner = self.lane('api_client', False)
        collision = self.lane('api-client', False)
        for lane in (owner, collision):
            (lane / '.git').mkdir()
        source = SessionSource()
        project = source.project_dir(owner.resolve())
        self.assertEqual(project, source.project_dir(collision.resolve()))
        project.mkdir(parents=True)
        transcript = project / 'synthetic.jsonl'
        event = {'type': 'user', 'timestamp': '2026-09-04T00:00:00Z'}
        for payload in ('{}\n', 'garbage\n', json.dumps(event) + '\n',
                        json.dumps(dict(event, cwd='api_client')) + '\n',
                        json.dumps(dict(event, cwd=str(owner / 'nested'))) + '\n'):
            transcript.write_text(payload)
            self.assertEqual(self.seats(), {})
        transcript.write_text(json.dumps(dict(event, cwd=str(owner.resolve()))) + '\n')
        self.assertEqual(self.seats(), {'api_client': 'claude'})
        transcript.write_text(json.dumps(dict(event, cwd=str(collision.resolve()))) + '\n')
        self.assertEqual(self.seats(), {'api-client': 'claude'})

    def test_admission_does_not_reuse_legacy_cwd_fallback_cache(self):
        lane = self.lane('legacy', False)
        (lane / '.git').mkdir()
        source = SessionSource()
        project = source.project_dir(lane.resolve())
        project.mkdir(parents=True)
        (project / 'synthetic.jsonl').write_text(json.dumps({
            'type': 'user', 'timestamp': '2026-09-04T00:00:00Z'}) + '\n')
        self.assertTrue(source.read_meta(lane.resolve())['evidence'])
        self.assertFalse(source.read_meta(lane.resolve(), require_explicit_cwd=True)['evidence'])

    def test_codex_session_without_outbox_requires_exact_metadata(self):
        """AGNOSTIC-05: session-only Codex repos survive roster reloads."""
        owner = self.lane('frontend', False)
        other = self.lane('frontend-other', False)
        for lane in (owner, other):
            (lane / '.git').mkdir()
        sessions = Path(os.environ['CODEX_HOME']) / 'sessions/2026/09/04'
        sessions.mkdir(parents=True)
        transcript = sessions / 'rollout-synthetic.jsonl'
        header = {'type': 'session_meta', 'timestamp': '2026-09-04T00:00:00Z',
                  'payload': {'cwd': str(owner.resolve())}}
        for record in ({}, dict(header, type='response_item'),
                       dict(header, timestamp='invalid'),
                       dict(header, payload={'cwd': 'frontend'}),
                       dict(header, payload={'cwd': str(owner / 'nested')}),
                       dict(header, payload={'input': {'cwd': str(owner.resolve())}})):
            transcript.write_text(json.dumps(record) + '\n')
            self.assertEqual(self.seats(), {})
        transcript.write_text(json.dumps(header) + '\n' + 'unread body\n' * 10000)
        for _ in range(2):
            self.assertEqual(self.seats(), {'frontend': 'codex'})
            self.assertFalse((owner / 'OUTBOX.md').exists())
        transcript.unlink()
        self.assertEqual(self.seats(), {})

    def test_codex_header_boundaries_and_symlinks(self):
        lane = self.lane('frontend', False)
        (lane / '.git').mkdir()
        sessions = Path(os.environ['CODEX_HOME']) / 'sessions'
        sessions.mkdir(parents=True)
        target = self.root / 'header.jsonl'
        header = json.dumps({'type': 'session_meta', 'timestamp': '2026-09-04T00:00:00Z',
                             'payload': {'cwd': str(lane.resolve())}})
        target.write_text(header + '\n')
        transcript = sessions / 'rollout-synthetic.jsonl'
        transcript.symlink_to(target)
        self.assertEqual(self.seats(), {})
        transcript.unlink()
        for content in (header, ' ' * 65536 + header + '\n'):
            transcript.write_text(content)
            self.assertEqual(self.seats(), {})
        transcript.unlink()
        os.mkfifo(transcript)
        self.assertEqual(self.seats(), {})

    def test_startup_without_posix_session_capabilities(self):
        """AGNOSTIC-07: optional adapters cannot break OUTBOX startup."""
        from contextlib import ExitStack
        from server.session_evidence import ClaudeEvidence, CodexEvidence
        from server.world import World
        lane = self.lane('frontend')
        (lane / '.git').mkdir()
        empty = self.lane('empty-repo', False)
        (empty / '.git').mkdir()
        for absent in (('O_DIRECTORY',), ('O_NOFOLLOW',),
                       ('O_DIRECTORY', 'O_NOFOLLOW', 'O_NONBLOCK')):
            with self.subTest(absent=absent), ExitStack() as stack:
                for name in absent:
                    stack.enter_context(patch.object(os, name, create=True))
                    delattr(os, name)
                self.assertFalse(CodexEvidence().matches(lane.resolve()))
                # A second adapter can also be unavailable on this platform.
                stack.enter_context(patch.object(ClaudeEvidence, 'matches',
                                                  side_effect=NotImplementedError))
                for method in ('_refresh_git', '_refresh_prs', '_refresh_tmux'):
                    stack.enter_context(patch.object(World, method))
                self.assertEqual(self.seats(), {'frontend': 'unknown'})
                world = World(ctx=self.ctx)
                agents = world._live_agents({'tmux': {}, 'processes': {}})
                self.assertEqual([a['lane'] for a in agents], ['frontend'])

    def test_unavailable_adapter_does_not_hide_other_session_evidence(self):
        from server.session_evidence import ClaudeEvidence, CodexEvidence
        lane = self.lane('session-only', False)
        (lane / '.git').mkdir()
        with patch.object(ClaudeEvidence, 'matches', side_effect=NotImplementedError), \
                patch.object(CodexEvidence, 'matches', return_value=True):
            self.assertEqual(self.seats(), {'session-only': 'codex'})

    def test_hostile_transcripts_cannot_abort_outbox_startup(self):
        """AGNOSTIC-08: corrupt and huge transcripts never erase real seats."""
        from server.world import World
        lane = self.lane('frontend')
        (lane / '.git').mkdir()
        other = self.lane('no-evidence', False)
        (other / '.git').mkdir()
        project = SessionSource().project_dir(lane.resolve())
        project.mkdir(parents=True)
        claude = project / 'hostile.jsonl'
        sessions = Path(os.environ['CODEX_HOME']) / 'sessions'
        sessions.mkdir(parents=True)
        codex = sessions / 'rollout-hostile.jsonl'
        for fixture in ('nested', '200mb', 'directory', 'oversized-line'):
            with self.subTest(fixture=fixture):
                for transcript in (claude, codex):
                    if fixture == 'nested':
                        transcript.write_text('[' * 1100 + ']' * 1100 + '\n')
                    elif fixture == '200mb':
                        with transcript.open('wb') as stream:
                            stream.truncate(200 * 1024 * 1024)
                    elif fixture == 'directory':
                        transcript.unlink()
                        transcript.mkdir()
                    else:
                        transcript.rmdir()
                        transcript.write_bytes(b' ' * 65536 + b'{}\n')
                with patch.object(World, '_refresh_git'), patch.object(World, '_refresh_prs'), \
                        patch.object(World, '_refresh_tmux'), \
                        patch('server.collector_source.os.read', wraps=os.read) as read:
                    world = World(ctx=self.ctx)
                    agents = world._live_agents({'tmux': {}, 'processes': {}})
                    self.assertEqual([a['lane'] for a in agents], ['frontend'])
                    self.assertEqual(world.seats[0]['engine'], 'unknown')
                    self.assertTrue(all(call.args[1] <= SessionSource.MAX_POLL_BYTES
                                        for call in read.call_args_list))
                self.assertFalse(SessionSource().read_meta(lane)['evidence'])

    def test_every_adapter_exception_is_absent_evidence(self):
        from server.session_evidence import ClaudeEvidence, CodexEvidence, SessionEvidence
        lane = self.lane('frontend')
        errors = (RecursionError, UnicodeError, OSError, MemoryError, ValueError, RuntimeError)
        for adapter in (ClaudeEvidence, CodexEvidence):
            for error in errors:
                with self.subTest(adapter=adapter.engine, error=error.__name__), \
                        patch.object(adapter, 'matches', side_effect=error):
                    self.assertEqual(SessionEvidence().signals(lane), set())
                    self.assertEqual(self.seats(), {'frontend': 'unknown'})
        with patch.object(ClaudeEvidence, '__init__', side_effect=MemoryError), \
                patch.object(CodexEvidence, 'matches', return_value=True):
            self.assertEqual(SessionEvidence().signals(lane), {'codex'})

    def test_adapter_read_failures_close_every_descriptor(self):
        from server.session_evidence import SessionEvidence
        lane = self.lane('frontend')
        project = SessionSource().project_dir(lane.resolve())
        project.mkdir(parents=True)
        (project / 'synthetic.jsonl').write_text('{}\n')
        sessions = Path(os.environ['CODEX_HOME']) / 'sessions/2026/09/04'
        sessions.mkdir(parents=True)
        (sessions / 'rollout-synthetic.jsonl').write_text('{}\n')
        real_open = os.open
        for failing_call in ('server.collector_source.json.loads',
                             'server.collector_source.os.fstat',
                             'server.session_evidence.os.fdopen'):
            for error in (RecursionError, MemoryError, OSError):
                opened = []

                def track_open(*args, **kwargs):
                    fd = real_open(*args, **kwargs)
                    opened.append(fd)
                    return fd

                with self.subTest(call=failing_call, error=error.__name__), \
                        patch('os.open', side_effect=track_open), \
                        patch(failing_call, side_effect=error):
                    self.assertEqual(SessionEvidence().signals(lane), set())
                self.assertTrue(opened)
                for fd in opened:
                    with self.assertRaises(OSError):
                        os.fstat(fd)

    def test_session_only_paths_with_spaces_and_unicode(self):
        """AGNOSTIC-06: valid path characters never decide admission."""
        names = ('plain worker', "Émilie's repo")
        # Literal harness keys, independent of the production mapper.
        suffixes = ('plain-worker', '-milie-s-repo')
        prefix = str(self.org.resolve()).replace('/', '-').replace('_', '-').replace('.', '-')
        collision = self.lane('plain-worker', False)
        (collision / '.git').mkdir()
        for name, suffix in zip(names, suffixes):
            lane = self.lane(name, False)
            (lane / '.git').mkdir()
            project = self.root / 'projects' / (prefix + '-' + suffix)
            project.mkdir(parents=True)
            (project / 'synthetic.jsonl').write_text(json.dumps({
                'type': 'user', 'timestamp': '2026-09-04T00:00:00Z',
                'cwd': str(lane.resolve())}) + '\n')
            self.assertTrue(SessionSource().read_meta(
                lane.resolve(), require_explicit_cwd=True)['evidence'])
            self.assertFalse((lane / 'OUTBOX.md').exists())
        self.assertEqual(self.seats(), {name: 'claude' for name in names})
        sessions = Path(os.environ['CODEX_HOME']) / 'sessions'
        sessions.mkdir(parents=True)
        for index, name in enumerate(names):
            (sessions / f'rollout-{index}.jsonl').write_text(json.dumps({
                'type': 'session_meta', 'timestamp': '2026-09-04T00:00:00Z',
                'payload': {'cwd': str((self.org / name).resolve())}}) + '\n')
        # Two evidenced engines are ambiguous, never a fabricated badge.
        self.assertEqual(self.seats(), {name: 'unknown' for name in names})

    def test_one_session_index_for_discovery_and_diagnostics(self):
        """AGNOSTIC-09: 100 unsignaled repos build one index per pass."""
        from server.session_evidence import SessionEvidence, CodexEvidence
        from server.world import World
        from serve import startup_log_lines
        for index in range(100):
            lane = self.lane(f'plain-{index}', False)
            (lane / '.git').mkdir()
        sessions = Path(os.environ['CODEX_HOME']) / 'sessions'
        sessions.mkdir(parents=True)
        self.lane('outbox-worker')
        original_headers = CodexEvidence._headers
        scans = []

        def headers(adapter, directory_fd, depth=0):
            if depth == 0:
                scans.append(directory_fd)
            yield from original_headers(adapter, directory_fd, depth)

        with patch('server.session_evidence.SessionEvidence', wraps=SessionEvidence) as factory, \
                patch.object(CodexEvidence, '_headers', headers):
            world = World(ctx=self.ctx)
            lines = startup_log_lines(world.seats, self.ctx, '127.0.0.1', 8787,
                                      evidence=world.session_evidence)
            self.assertEqual(factory.call_count, 0)
            self.assertEqual(len(scans), 0)
            self.assertIn('1 lanes found', lines[0])
            self.assertEqual(len(lines), 1)
            # Standalone diagnostics must also share their evidence with the
            # implicit roster load, including when known_lanes is omitted.
            for known in (None, {'outbox-worker'}):
                factory.reset_mock()
                scans.clear()
                self.assertEqual(roster.ignored_outbox_folders(self.ctx, known, evidence=None), [])
                self.assertEqual(factory.call_count, 1)
                self.assertEqual(len(scans), 1)
        # Fresh discovery observes a newly written session; no global cache.
        (sessions / 'rollout-new.jsonl').write_text(json.dumps({
            'type': 'session_meta', 'timestamp': '2026-09-04T00:00:00Z',
            'payload': {'cwd': str((self.org / 'plain-0').resolve())}}) + '\n')
        self.assertEqual(self.seats(), {'outbox-worker': 'unknown', 'plain-0': 'codex'})

    def test_startup_skips_discovery_and_discovery_joins_next_poll(self):
        """AGNOSTIC-10: HTTP startup does zero session I/O, regardless of archive."""
        import socket
        import subprocess
        import sys
        import time
        from server.world import World
        self.lane('outbox-worker')
        session_lane = self.lane('plain-session', False)
        (session_lane / '.git').mkdir()
        sessions = Path(os.environ['CODEX_HOME']) / 'sessions'
        sessions.mkdir(parents=True)

        def startup():
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            started = time.monotonic()
            proc = subprocess.Popen([sys.executable, 'serve.py', '--allrepos',
                                     str(self.org), '--port', str(port)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                while time.monotonic() - started < 5:
                    try:
                        with socket.create_connection(('127.0.0.1', port), timeout=.1):
                            return time.monotonic() - started
                    except OSError:
                        if proc.poll() is not None:
                            raise RuntimeError(proc.stderr.read().decode())
                        time.sleep(.01)
                raise TimeoutError('HTTP did not listen within five seconds')
            finally:
                proc.terminate()
                proc.wait(timeout=5)
                proc.stderr.close()

        def report_startup(label):
            try:
                print(f'REPORT AGNOSTIC-10 HTTP listen {label}: {startup():.3f}s')
            except (OSError, RuntimeError, TimeoutError, subprocess.TimeoutExpired) as error:
                print(f'REPORT AGNOSTIC-10 HTTP listen {label}: SKIP ({error})')

        report_startup('empty')
        header = json.dumps({'type': 'session_meta', 'timestamp': '2026-09-04T00:00:00Z',
                             'payload': {'cwd': str(session_lane.resolve())}}) + '\n'
        # Archive size cannot affect a path that never invokes discovery. Keep
        # the normal suite small; timing measurements are observations only.
        for index in range(32):
            (sessions / f'rollout-{index}.jsonl').write_text(header)
        report_startup('32 transcripts')
        with patch('server.session_evidence.SessionEvidence') as discovery, \
                patch('server.world.threading.Thread') as thread:
            for enabled in (False, True):
                with self.subTest(session_discovery=enabled):
                    world = World(ctx=self.ctx, session_discovery=enabled)
                    discovery.assert_not_called()
                    thread.assert_not_called()
                    self.assertEqual([s['lane'] for s in world.seats], ['outbox-worker'])
        world._poll_session_discovery()
        world._discovery_job.join(timeout=4)
        self.assertFalse(world._discovery_job.is_alive())
        self.assertEqual([s['lane'] for s in world.seats], ['outbox-worker'])
        world._poll_session_discovery()
        self.assertIn('plain-session', [s['lane'] for s in world.seats])
        self.assertLessEqual(5000 - world.session_evidence.budget.entries, 5000)

    def test_completed_discovery_cannot_overwrite_a_new_manifest(self):
        from server.world import World
        self.lane('frontend')
        ceo = self.lane('ceo', False)
        world = World(ctx=self.ctx, session_discovery=True)
        world._poll_session_discovery()
        world._discovery_job.join(timeout=4)
        self.assertFalse(world._discovery_job.is_alive())
        (ceo / 'bootstrap.sh').write_text("cat <<'ROSTER'\ncodex | new-seat | Ada | A | IC | model\nROSTER\n")
        world._poll_session_discovery()
        world._refresh_roster()
        self.assertIn('new-seat', [s['lane'] for s in world.seats])

    def test_lane_file_hazards_are_absent_and_never_block_startup(self):
        """AGNOSTIC-11: FIFO identity and 2 GB sparse OUTBOX remain bounded."""
        import subprocess
        import sys
        from server.safe_read import safe_read
        from server.lanes import read_status_block
        lane = self.lane('frontend')
        os.mkfifo(lane / 'identity.env')
        oversized = self.lane('huge-outbox')
        with (oversized / 'OUTBOX.md').open('wb') as stream:
            stream.truncate(2 * 1024 ** 3)
        result = subprocess.run([sys.executable, 'serve.py', '--allrepos', str(self.org),
                                 '--once', '--json'], capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([a['lane'] for a in json.loads(result.stdout)['agents']], ['frontend'])
        self.assertEqual(read_status_block(oversized / 'OUTBOX.md'), ({}, []))
        with patch('server.safe_read.os.read', side_effect=AssertionError('must not read')):
            self.assertIsNone(safe_read(lane / 'identity.env'))
            self.assertIsNone(safe_read(oversized / 'OUTBOX.md'))
            self.assertIsNone(safe_read(lane))
        for name in ('INBOX.md', 'STATUS', 'transcript.jsonl'):
            path = lane / name
            os.mkfifo(path)
            self.assertIsNone(safe_read(path))
            path.unlink()
            path.write_bytes(b'bad utf8 \xff')
            self.assertIsNone(safe_read(path))
        print('AGNOSTIC-11 FIFO identity + sparse 2 GB OUTBOX: real CLI startup PASS')

    def test_admission_continues_past_newer_unusable_transcripts(self):
        """AGNOSTIC-12: matching cwd alone cannot hide older usable evidence."""
        from server.discovery_budget import DiscoveryBudget
        lane = self.lane('plain worker', False)
        (lane / '.git').mkdir()
        prefix = str(self.org.resolve()).replace('/', '-').replace('_', '-').replace('.', '-')
        project = self.root / 'projects' / (prefix + '-plain-worker')
        project.mkdir(parents=True)
        good = {'type': 'user', 'timestamp': '2026-09-04T00:00:00Z', 'cwd': str(lane.resolve())}
        older, newer = project / 'older.jsonl', project / 'newer.jsonl'
        older.write_text(json.dumps(good) + '\n')
        newer.write_text(json.dumps(dict(good, timestamp='invalid')) + '\n')
        os.utime(older, (1, 1))
        os.utime(newer, (2, 2))
        source = SessionSource()
        for _ in range(2):  # also exercise the cached-negative candidate
            self.assertTrue(source.read_meta(lane.resolve(), require_explicit_cwd=True)['evidence'])
        self.assertEqual(self.seats(), {'plain worker': 'claude'})
        self.assertFalse(SessionSource().read_meta(lane.resolve(), require_explicit_cwd=True,
                        budget=DiscoveryBudget(bytes_limit=1))['evidence'])
        older.unlink()
        self.assertEqual(self.seats(), {})

    def test_discovery_budget_is_shared_and_lazy(self):
        from server.discovery_budget import DiscoveryBudget
        from server.session_evidence import SessionEvidence
        budget = DiscoveryBudget(entries=3, bytes_limit=10, seconds=1)
        evidence = SessionEvidence(budget)
        self.assertTrue(all(adapter.budget is budget for adapter in evidence.adapters))
        for index in range(10):
            (self.root / f'entry-{index}').touch()
        self.assertEqual(len(list(budget.names(self.root))), 3)
        self.assertEqual(budget.entries, 0)
        self.assertTrue(budget.available())
        self.assertTrue(budget.take_bytes(1))
        self.assertFalse(budget.take_bytes(10))

    def test_session_discovery_is_explicitly_opt_in(self):
        """AGNOSTIC-13: 5,000 transcripts cause zero default discovery work."""
        from server.session_evidence import SessionEvidence, ClaudeEvidence, CodexEvidence
        from server.world import World
        from serve import startup_log_lines
        from office_cli import parse_args, friends_defaults, serve_command, usage_text
        lane = self.lane('plain-session', False)
        (lane / '.git').mkdir()
        self.lane('frontend')
        sessions = Path(os.environ['CODEX_HOME']) / 'sessions'
        sessions.mkdir(parents=True)
        header = json.dumps({'type': 'session_meta', 'timestamp': '2026-09-04T00:00:00Z',
                             'payload': {'cwd': str(lane.resolve())}}) + '\n'
        for index in range(5000):
            (sessions / f'rollout-{index}.jsonl').write_text(header)
        with patch('server.session_evidence.SessionEvidence', wraps=SessionEvidence) as factory, \
                patch.object(ClaudeEvidence, 'matches') as claude, \
                patch.object(CodexEvidence, 'matches') as codex, \
                patch('server.world.threading.Thread') as thread, \
                patch.object(World, '_refresh_git'), patch.object(World, '_refresh_prs'), \
                patch.object(World, '_refresh_tmux'):
            world = World(ctx=self.ctx)
            for _ in range(3):
                agents = world._live_agents({'tmux': {}, 'processes': {}})
                self.assertEqual([a['lane'] for a in agents], ['frontend'])
            self.assertEqual([s['lane'] for s in roster.load_roster(ctx=self.ctx)], ['frontend'])
            self.assertEqual(roster.ignored_outbox_folders(self.ctx), [])
            self.assertIn('1 lanes found', startup_log_lines(
                world.seats, self.ctx, '127.0.0.1', 8787)[0])
            self.assertEqual(factory.call_count, 0)
            claude.assert_not_called()
            codex.assert_not_called()
            thread.assert_not_called()
        for argv, enabled in (([], False), (['--session-discovery'], True)):
            config = friends_defaults(parse_args(['--allrepos', str(self.org)] + argv))
            self.assertEqual(config['session_discovery'], enabled)
            self.assertEqual('--session-discovery' in serve_command(config, 'serve.py'), enabled)
        self.assertIn('experimental', usage_text())
        print('AGNOSTIC-13 5,000-transcript default: index=0 adapters=0 threads=0; OUTBOX admitted')

    def test_opt_in_once_json_includes_session_only_lane(self):
        """AGNOSTIC-14: actual CLI consumes the bounded result before output."""
        import subprocess
        import sys
        lane = self.lane('plain-session', False)
        (lane / '.git').mkdir()
        self.lane('frontend')
        sessions = Path(os.environ['CODEX_HOME']) / 'sessions'
        sessions.mkdir(parents=True)
        (sessions / 'rollout-synthetic.jsonl').write_text(json.dumps({
            'type': 'session_meta', 'timestamp': '2026-09-04T00:00:00Z',
            'payload': {'cwd': str(lane.resolve())}}) + '\n')
        for flags, expected in (([], {'frontend': 'unknown'}),
                                (['--session-discovery'], {'frontend': 'unknown', 'plain-session': 'codex'})):
            for roots_args in (['--allrepos', str(self.org)], ['--floor', f'Example={self.org}']):
                result = subprocess.run([sys.executable, 'serve.py', '--once', '--json']
                                        + roots_args + flags, capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, 0, result.stderr)
                snap = json.loads(result.stdout)
                self.assertEqual({a['lane']: a['engine'] for a in snap['agents']}, expected)
        print('AGNOSTIC-14 default/opt-in --once --json, single/building: PASS')

    def test_codex_complete_header_survives_partial_utf8_body(self):
        """AGNOSTIC-15: a complete valid header is independent of body decoding."""
        from server.session_evidence import CodexEvidence
        lane = self.lane('plain-session', False)
        (lane / '.git').mkdir()
        sessions = Path(os.environ['CODEX_HOME']) / 'sessions'
        sessions.mkdir(parents=True)
        transcript = sessions / 'rollout-synthetic.jsonl'
        header = (json.dumps({'type': 'session_meta', 'timestamp': '2026-09-04T00:00:00Z',
                             'payload': {'cwd': str(lane.resolve())}}) + '\n').encode()
        for split in (1, 2):
            transcript.write_bytes(header + b' ' * (65537 - len(header) - split)
                                   + '€'.encode() + b'\n')
            self.assertTrue(CodexEvidence().matches(lane.resolve()))
        transcript.write_bytes(header.replace(b'session_meta', b'\xffsession_meta') + b'\n')
        self.assertFalse(CodexEvidence().matches(lane.resolve()))
        transcript.write_bytes(header[:-1])
        self.assertFalse(CodexEvidence().matches(lane.resolve()))

    def test_enumeration_exhaustion_preserves_candidate_read_budget(self):
        """AGNOSTIC-16: 5,000 Claude transcripts cannot starve their own reads."""
        from server.discovery_budget import DiscoveryBudget
        lane = self.lane('plain worker', False)
        (lane / '.git').mkdir()
        prefix = str(self.org.resolve()).replace('/', '-').replace('_', '-').replace('.', '-')
        project = self.root / 'projects' / (prefix + '-plain-worker')
        project.mkdir(parents=True)
        record = json.dumps({'type': 'user', 'timestamp': '2026-09-04T00:00:00Z',
                             'cwd': str(lane.resolve())}) + '\n'
        for index in range(5000):
            (project / f'{index}.jsonl').write_text(record)
        budget = DiscoveryBudget()
        with patch('server.safe_read.os.read', wraps=os.read) as read:
            meta = SessionSource().read_meta(lane.resolve(), require_explicit_cwd=True, budget=budget)
        self.assertEqual(budget.entries, 0)
        self.assertTrue(meta['evidence'])
        self.assertGreater(read.call_count, 0)
        print('AGNOSTIC-16 5,000 Claude transcripts: evidence present, read budget survives enumeration')

    def test_manifest_and_filters_remain_authoritative(self):
        ceo = self.lane('ceo', False)
        (ceo / 'bootstrap.sh').write_text("cat <<'ROSTER'\ncodex | authored | Ada | A | IC | model\nROSTER\n")
        self.lane('walk in')
        self.assertEqual(self.seats(), {'authored': 'codex', 'walk in': 'unknown'})
        with patch.dict(os.environ, {'OFFICE_ROSTER_ONLY': '1'}):
            self.assertEqual(self.seats(), {'authored': 'codex'})
            self.assertEqual(roster.ignored_outbox_folders(self.ctx, {'authored'}), ['walk in'])

    def test_unmatched_engines_have_unknown_liveness(self):
        """AGNOSTIC-04: unread work is not proof an unprobed engine died."""
        from server import procs, states
        from server.world import World
        for engine in ('gemini', 'cursor', 'opencode', 'unknown', 'codex', 'claude'):
            lane = self.lane(engine)
            (lane / 'OUTBOX.md').write_text('STATUS\nready_for_pr: false\n')
            (lane / 'identity.env').write_text(f'ENGINE={engine}\n')
            (lane / 'INBOX.md').write_text('Please reply\n')
            os.utime(lane / 'OUTBOX.md', (1, 1))
        with patch.object(World, '_refresh_git'), patch.object(World, '_refresh_prs'), \
                patch.object(World, '_refresh_tmux'), patch.object(procs, 'HAVE_LSOF', True), \
                patch.object(procs, 'ENGINE_MATCHERS', {'claude': ('claude',), 'codex': ('codex',)}):
            world = World(ctx=self.ctx)

            def agents(processes=None):
                return {a['lane']: a for a in world._live_agents(
                    {'tmux': {}, 'processes': processes or {}})}

            observed = agents()
            for engine in ('gemini', 'cursor', 'opencode', 'unknown'):
                self.assertFalse(observed[engine]['liveness_known'])
                self.assertTrue(observed[engine]['owes_reply'])
                self.assertEqual(states.classify(observed[engine]), 'unknown')
            self.assertTrue(observed['codex']['liveness_known'])
            self.assertEqual(states.classify(observed['codex']), 'dead')
            with patch.dict(procs.ENGINE_MATCHERS, {'gemini': ('gemini',)}):
                self.assertTrue(agents()['gemini']['liveness_known'])
            with patch.object(procs, 'HAVE_LSOF', False):
                self.assertFalse(agents()['codex']['liveness_known'])
            matched = agents({'unknown': ('1234', '00:01')})['unknown']
            self.assertTrue(matched['alive'])
            self.assertTrue(matched['liveness_known'])
            self.assertEqual(states.classify(matched), 'reading')

    def test_live_world_threads_done_and_outbox_age_into_states_classifier(self):
        """SEAT-IDLE-01: the normal --org path reaches states.classify()."""
        from server import procs, states
        from server.world import World

        lane = self.lane('idle-worker')
        (lane / 'identity.env').write_text('ENGINE=codex\n')
        outbox = lane / 'OUTBOX.md'
        outbox.write_text(
            'STATUS\nready_for_pr: false\ndecision_needed: null\n'
            'done: true\nblockers: none\n'
        )
        os.utime(outbox, (930, 930))

        with patch.object(World, '_refresh_git'), patch.object(World, '_refresh_prs'), \
                patch.object(World, '_refresh_tmux'), \
                patch.object(procs, 'HAVE_LSOF', True), \
                patch('server.world.time.time', return_value=1_000):
            world = World(ctx=self.ctx)
            agents = world._live_agents({
                'tmux': {}, 'processes': {'idle-worker': ('123', '00:01')},
            })

        self.assertEqual(len(agents), 1)
        self.assertTrue(agents[0]['done'])
        self.assertEqual(agents[0]['last_output_age'], 70)
        self.assertEqual(states.classify(agents[0]), 'idle')


if __name__ == '__main__':
    unittest.main()
