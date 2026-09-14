# OfficeFloor

OfficeFloor is a live, isometric floor view of an AI-agent organization. It
turns a directory of agent lanes into a local visual workspace: see who is
working, what needs attention, and how the organization is moving.

```bash
pip install officefloor && officefloor --demo
```

Open <http://127.0.0.1:8788>. Demo mode starts immediately with a built-in
synthetic team, so you can explore the floor without configuring an agent org.

![OfficeFloor demo](https://officefloor.ai/og.jpg)

## What ships

- Provider-agnostic agent support: Claude Code, Codex, and local models.
- Selectable public themes are off and Manhattan.
- Real placeable furniture, cars in the lot, and an ambient NPC cast.
- The `officefloor` launcher binds to localhost and sends no telemetry. Office edits are on by default; --no-actions turns them off. Communication features require --allow-comms. Office state is stored under ~/.local/state/officefloor/<org>/.
- No third-party runtime dependencies; Python 3.10 or newer is required.
- FSL-1.1-ALv2-licensed code, with bundled asset notices included in the package.

The marketplace is coming soon.

To view your own organization, point OfficeFloor at the directory containing
its agent lanes:

```bash
officefloor --org /path/to/agent-lanes
```

## Wiring up your own agents

Visit [officefloor.ai](https://officefloor.ai) for the exact agent reporting
contract, then append paste-ready instructions to your agent configuration:

```bash
officefloor --agent-md >> your-agent/CLAUDE.md
```

Learn more at [officefloor.ai](https://officefloor.ai).
