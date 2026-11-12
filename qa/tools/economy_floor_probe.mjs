#!/usr/bin/env node
/* QA-FIX-03: a two-floor economy feed stays on the selected floor.
 *
 * Starts an isolated demo server with the economy flags forced on, then pins:
 * - /api/economy?floor=product-lab returns product-lab's own book and lanes;
 * - an unknown floor is a 404, never a default-floor fallback;
 * - every active demo agent has the authoritative earned/balance fields, so
 *   the Economy model's AGENTS tile is a real sum rather than an em dash;
 * - the header module asks the same floor URL and renders that feed balance.
 *
 * No browser is needed: the header runs in a deliberately small DOM harness.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { ownTempDir, spawnServer } from './browser_process.mjs';
import resolvePython from './python_interpreter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const economyModel = require(path.join(ROOT, 'static', 'office.economy.model.js'));

function port() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitFor(url, child) {
  let last = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`demo server exited ${child.exitCode}: ${last || ''}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      last = `${response.status} ${await response.text()}`;
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`demo server did not become ready: ${last || 'no response'}`);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(false);

  return new Promise((resolve) => {
    let timer = null;
    const finish = (timedOut) => {
      child.removeListener('exit', onExit);
      if (timer) clearTimeout(timer);
      resolve(timedOut);
    };
    const onExit = () => finish(false);
    child.once('exit', onExit);

    // The process can finish between the initial status check and registering
    // the listener above. In that case, do not wait for an event that has
    // already fired.
    if (child.exitCode !== null || child.signalCode !== null) return finish(false);
    timer = setTimeout(() => finish(true), timeoutMs);
  });
}

async function stopChild(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  const termWait = waitForExit(child, timeoutMs);
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (!(await termWait) || child.exitCode !== null || child.signalCode !== null) return;

  const killWait = waitForExit(child, 1_000);
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGKILL');
  await killWait;
}

const settle = async () => {
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setImmediate(resolve));
};

function topbarBalanceProbe(feed) {
  const topbarSource = readFileSync(path.join(ROOT, 'static', 'office.hud.topbar.js'), 'utf8');
  const clientSource = readFileSync(path.join(ROOT, 'static', 'office.economy.js'), 'utf8');
  assert.match(clientSource, /OFFICE\?\.state\?\.world\?\.building\?\.floor/,
    'Economy client must derive its selector from the active state response');
  assert.match(clientSource, /\/api\/economy\?floor=\$\{encodeURIComponent\(floor\)\}/,
    'Economy client must send the active floor to /api/economy');
  assert.match(clientSource, /if \(floor !== currentFloor\(\)\) return;/,
    'a completed request for a previous floor must be discarded before render');
  assert.doesNotMatch(topbarSource, /office_wallet_usd|OfficeDemoEconomy/,
    'the header must not substitute cumulative earnings or a client demo book for the feed balance');
  assert.doesNotMatch(topbarSource, /\bfetch\s*\(/,
    'the baked topbar remains network-free; the served Economy module supplies its fetched feed');

  const nodes = new Map();
  const topbar = {
    appendChild(node) { nodes.set(node.id, node); return node; },
  };
  const document = {
    createElement() {
      return {
        id: '', className: '', textContent: '', dataset: {},
        setAttribute() {}, remove() { nodes.delete(this.id); },
      };
    },
    getElementById(id) { return id === 'topbar' ? topbar : nodes.get(id) || null; },
  };
  const hud = { renderCounters() {} };
  let api = null;
  const sandbox = {
    OFFICE: {
      state: { world: { mode: 'demo', building: { floor: 'product-lab' } } },
      module(_name, _deps, factory) {
        api = factory({ deriveFleetHealth: () => ({}) }, hud);
        return api;
      },
    },
    document,
    OfficeFeatureFlags: { enabled: (name) => name === 'agent_wallet' },
    OfficeHudShell: { adoptControl(node) { nodes.set(node.id, node); return true; } },
    setInterval: () => 1,
    clearInterval() {},
    encodeURIComponent,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(topbarSource, sandbox, { filename: 'office.hud.topbar.js' });
  hud.renderCounters();
  return settle().then(() => {
    const pill = nodes.get('officeWallet');
    assert.equal(pill?.textContent, '🏢 balance unavailable · DEMO',
      'the header must not invent a balance before the Economy feed arrives');
    assert.equal(api.setEconomyFeed(feed, 'product-lab'), true,
      'the served Economy feed must update the active floor pill');
    assert.equal(pill?.textContent,
      `🏢 $${feed.office.balance.toLocaleString('en-US')} · BALANCE · DEMO`,
      'header pill must display the feed balance with an explicit balance label');
    assert.equal(api.setEconomyFeed({ available: true, office: { balance: 1 } }, 'demo-hq'), false,
      'a stale prior-floor response must not replace the active pill');
  });
}

const stateRoot = ownTempDir(path.join(tmpdir(), 'office-economy-floor-'));
let child = null;
try {
  const selectedPort = await port();
  const base = `http://127.0.0.1:${selectedPort}`;
  child = spawnServer(resolvePython(process.env.PYTHON), [
    'qa/tools/economy_view_serve.py', '--demo', '--floors', '2', '--port', String(selectedPort), '--poll', '60',
  ], {
    cwd: ROOT,
    env: { ...process.env, XDG_STATE_HOME: path.join(stateRoot, 'state') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  const hqState = await (await waitFor(`${base}/api/state?floor=demo-hq`, child)).json();
  const labState = await (await waitFor(`${base}/api/state?floor=product-lab`, child)).json();
  const hqFeed = await (await waitFor(`${base}/api/economy?floor=demo-hq`, child)).json();
  const labFeed = await (await waitFor(`${base}/api/economy?floor=product-lab`, child)).json();
  const unknown = await fetch(`${base}/api/economy?floor=missing-floor`);

  assert.equal(labFeed.office.balance, labState.office_wallet_usd,
    'floor 2 feed balance must be floor 2 state, not another floor');
  assert.notEqual(labFeed.office.balance, hqFeed.office.balance,
    'fixture floors must prove the selected book differs from the default floor');
  assert.equal(hqFeed.office.balance, hqState.office_wallet_usd,
    'default request must retain the default floor book');
  assert.deepEqual(labFeed.agents.map((agent) => agent.lane).sort(),
    labState.agents.map((agent) => agent.lane).sort(),
    'floor 2 feed must contain only floor 2 wallets');
  assert.ok(labFeed.agents.length > 0 && labFeed.agents.every((agent) => (
    Number.isSafeInteger(agent.earned) && Number.isSafeInteger(agent.balance)
  )), 'active floor agents need earned and balance fields');
  const agentsTile = economyModel.miniView(labFeed).kpis.find((kpi) => kpi.label === 'AGENTS');
  assert.notEqual(agentsTile?.value, '—', 'AGENTS tile must sum measured balances');
  assert.equal(unknown.status, 404, 'unknown floor must not fall back to the default book');
  await topbarBalanceProbe(labFeed);

  console.log(`PASS economy_floor_probe: floor=product-lab balance=$${labFeed.office.balance} `
    + `agents=${labFeed.agents.length} agents_tile=${agentsTile.value} header=balance unknown=404`);
} finally {
  await stopChild(child);
  rmSync(stateRoot, { recursive: true, force: true });
}
