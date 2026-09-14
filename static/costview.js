/* CV-4 — standalone, response-driven CostView overview. */
(function installCostView(root, factory) {
  const api = factory(root);
  root.CostView = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    } else {
      api.mount();
    }
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const ENDPOINT = '/api/costview';
  const POLL_MS = 15_000;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const KINDS = Object.freeze([
    Object.freeze({ key: 'input', className: 'input-bar', label: 'input' }),
    Object.freeze({ key: 'output', className: 'output-bar', label: 'output' }),
    Object.freeze({ key: 'cache_create', className: 'cache-create-bar', label: 'cache create' }),
    Object.freeze({ key: 'cache_read', className: 'cache-read-bar', label: 'cache read' }),
  ]);
  const numberFormat = new Intl.NumberFormat('en-US');
  const compactFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, notation: 'compact' });
  const timeFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  function decimal(value) {
    if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function estimateDecimal(value) {
    const parsed = decimal(value);
    return parsed !== null && parsed >= 0 ? parsed : null;
  }

  function formatInteger(value) {
    return Number.isSafeInteger(value) && value >= 0 ? numberFormat.format(value) : 'unavailable';
  }

  function formatDecimal(value, suffix = '') {
    return finite(value)
      ? `${numberFormat.format(value)}${suffix}`
      : 'unavailable';
  }

  function formatTimestamp(value) {
    if (typeof value !== 'string') return 'unavailable';
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? `${timeFormat.format(parsed)} UTC` : 'unavailable';
  }

  function formatCost(estimate) {
    const value = estimateDecimal(estimate?.usd);
    return value === null ? 'unpriced — no published rate' : `$${estimate.usd} (EST)`;
  }

  function buildUrl(model = '', provider = '') {
    const query = new URLSearchParams();
    if (model) query.set('model', model);
    if (provider) query.set('provider', provider);
    const encoded = query.toString();
    return encoded ? `${ENDPOINT}?${encoded}` : ENDPOINT;
  }

  function validTokenKinds(tokens) {
    if (!tokens || typeof tokens !== 'object') return false;
    const values = KINDS.map((kind) => tokens[kind.key]);
    return values.every((value) => Number.isSafeInteger(value) && value >= 0)
      && Number.isSafeInteger(tokens.total)
      && tokens.total === values.reduce((sum, value) => sum + value, 0);
  }

  function validEstimate(estimate) {
    return Boolean(
      estimate && typeof estimate === 'object' && estimate.est === true
      && (estimate.usd === null || estimateDecimal(estimate.usd) !== null)
      && Number.isSafeInteger(estimate.priced_events) && estimate.priced_events >= 0
      && Number.isSafeInteger(estimate.total_events) && estimate.total_events >= 0
      && estimate.priced_events <= estimate.total_events
    );
  }

  function validSeriesPoint(point) {
    return Boolean(
      point && typeof point === 'object'
      && typeof point.bucket_start === 'string'
      && typeof point.bucket_end === 'string'
      && validTokenKinds(point.tokens)
      && finite(point.tokens_per_minute)
      && Number.isSafeInteger(point.usage_turns) && point.usage_turns >= 0
      && finite(point.usage_turns_per_minute)
      && point.cost && KINDS.every((kind) => validEstimate(point.cost[kind.key]))
      && validEstimate(point.cost.total)
    );
  }

  function validAgent(agent) {
    const runtime = agent?.runtime;
    const context = agent?.prompt_context_remaining_p50_pct_est;
    return Boolean(
      agent && typeof agent.lane === 'string' && agent.lane
      && Array.isArray(agent.models) && agent.models.every((value) => typeof value === 'string' && value)
      && Array.isArray(agent.providers) && agent.providers.every((value) => typeof value === 'string' && value)
      && validTokenKinds(agent.tokens)
      && runtime && (runtime.observed_turn_interval_p95_ms === null || finite(runtime.observed_turn_interval_p95_ms))
      && Number.isSafeInteger(runtime.measured_events) && runtime.measured_events >= 0
      && Number.isSafeInteger(runtime.total_events) && runtime.total_events >= runtime.measured_events
      && validEstimate(agent.cost)
      && (context === null || (finite(context) && context <= 100))
      && typeof agent.last_seen === 'string'
    );
  }

  function validBudgetForecast(value) {
    const budget = value?.budget;
    const remaining = value?.remaining;
    const forecast = value?.forecast;
    const alert = value?.over_budget_alert;
    return Boolean(
      value && budget && remaining && forecast
      && (budget.limit_usd === null || estimateDecimal(budget.limit_usd) !== null)
      && (budget.period_start === null || typeof budget.period_start === 'string')
      && (budget.period_end === null || typeof budget.period_end === 'string')
      && validEstimate(value.spent)
      && remaining.est === true
      && (remaining.usd === null || decimal(remaining.usd) !== null)
      && forecast.est === true
      && typeof forecast.label === 'string' && forecast.label
      && typeof forecast.method === 'string' && forecast.method
      && (forecast.usd === null || estimateDecimal(forecast.usd) !== null)
      && (forecast.as_of === null || typeof forecast.as_of === 'string')
      && typeof forecast.coverage_complete === 'boolean'
      && (alert === null || (
        alert && alert.active === true && alert.est === true
        && estimateDecimal(alert.over_by_usd_est) !== null
      ))
    );
  }

  function validSource(coverage, fresh) {
    const coverageKeys = [
      'roots_configured', 'roots_readable', 'files_seen', 'files_readable',
      'events_accepted', 'events_rejected', 'events_unpriced', 'events_unattributed',
    ];
    return Boolean(
      coverage && coverageKeys.every((key) => Number.isSafeInteger(coverage[key]) && coverage[key] >= 0)
      && fresh && ['fresh', 'stale', 'unknown', 'unavailable'].includes(fresh.state)
      && (fresh.last_seen === null || typeof fresh.last_seen === 'string')
      && typeof fresh.freshness_checked_at === 'string'
      && (fresh.age_seconds === null || finite(fresh.age_seconds))
      && Number.isSafeInteger(fresh.stale_after_seconds) && fresh.stale_after_seconds > 0
    );
  }

  function validateSnapshot(payload) {
    return Boolean(
      payload
      && payload.schema === 'costview.v1'
      && ['ready', 'partial', 'unavailable'].includes(payload.status)
      && payload.currency === 'USD'
      && (payload.as_of === null || typeof payload.as_of === 'string')
      && payload.window && Number.isSafeInteger(payload.window.bucket_seconds)
      && payload.window.bucket_seconds > 0
      && (payload.window.start === null || typeof payload.window.start === 'string')
      && (payload.window.end === null || typeof payload.window.end === 'string')
      && Number.isSafeInteger(payload.refresh_hint_ms) && payload.refresh_hint_ms > 0
      && Number.isSafeInteger(payload.agents_with_usage) && payload.agents_with_usage >= 0
      && validTokenKinds(payload.total_tokens)
      && validEstimate(payload.total_cost)
      && Array.isArray(payload.series) && payload.series.every(validSeriesPoint)
      && Array.isArray(payload.agents) && payload.agents.every(validAgent)
      && Array.isArray(payload.models)
      && payload.models.every((row) => typeof row?.model === 'string' && row.model)
      && Array.isArray(payload.providers)
      && payload.providers.every((row) => typeof row?.provider === 'string' && row.provider)
      && validBudgetForecast(payload.budget_forecast)
      && validSource(payload.source_coverage, payload.source_fresh)
    );
  }

  function clear(node) {
    while (node?.firstChild) node.removeChild(node.firstChild);
  }

  function svgNode(name, attributes = {}, text = null) {
    const node = root.document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== null) node.textContent = text;
    return node;
  }

  function appendTitle(parent, text) {
    parent.appendChild(svgNode('title', {}, text));
  }

  function drawGrid(svg, bounds, labels, formatter) {
    const { left, top, width, height } = bounds;
    for (let index = 0; index <= labels; index += 1) {
      const ratio = index / labels;
      const y = top + height - (height * ratio);
      svg.appendChild(svgNode('line', {
        x1: left, y1: y, x2: left + width, y2: y, class: 'grid-line',
      }));
      svg.appendChild(svgNode('text', {
        x: left - 9, y: y + 3, 'text-anchor': 'end', class: 'axis-label',
      }, formatter(ratio)));
    }
  }

  function drawXAxis(svg, series, bounds) {
    if (!series.length) return;
    const { left, top, width, height } = bounds;
    const indexes = Array.from(new Set([0, Math.floor((series.length - 1) / 2), series.length - 1]));
    indexes.forEach((index) => {
      const x = left + ((index + .5) * width / series.length);
      svg.appendChild(svgNode('text', {
        x, y: top + height + 24, 'text-anchor': 'middle', class: 'axis-label',
      }, formatTimestamp(series[index].bucket_start)));
    });
  }

  function drawEmpty(svg, message) {
    clear(svg);
    svg.appendChild(svgNode('text', {
      x: 480, y: 150, 'text-anchor': 'middle', class: 'empty-label',
    }, message));
  }

  function costParts(point) {
    return KINDS.map((kind) => ({
      ...kind,
      value: estimateDecimal(point?.cost?.[kind.key]?.usd),
    }));
  }

  function drawCostChart(svg, series) {
    if (!svg) return;
    if (!series.length) return drawEmpty(svg, 'No accepted usage in this selection.');
    clear(svg);
    const bounds = { left: 68, top: 20, width: 866, height: 224 };
    const totals = series.map((point) => costParts(point)
      .reduce((sum, part) => sum + (part.value === null ? 0 : part.value), 0));
    const maximum = Math.max(0, ...totals);
    const scaleMaximum = maximum > 0 ? maximum : 1;
    drawGrid(svg, bounds, 4, (ratio) => `$${(scaleMaximum * ratio).toFixed(6)}`);
    const slot = bounds.width / series.length;
    const barWidth = Math.max(3, Math.min(54, slot * .68));
    series.forEach((point, index) => {
      const x = bounds.left + (slot * index) + ((slot - barWidth) / 2);
      const parts = costParts(point);
      const label = `${formatTimestamp(point.bucket_start)}: ${formatCost(point.cost?.total)}`;
      const unpriced = parts.some((part) => part.value === null);
      if (unpriced) {
        const mark = svgNode('text', {
          x: x + (barWidth / 2), y: bounds.top + 10,
          'text-anchor': 'middle', class: 'unpriced-mark',
        }, 'UNPRICED');
        appendTitle(mark, label);
        svg.appendChild(mark);
      }
      let y = bounds.top + bounds.height;
      parts.filter((part) => part.value !== null).forEach((part) => {
        const height = part.value * bounds.height / scaleMaximum;
        y -= height;
        const rect = svgNode('rect', {
          x, y, width: barWidth, height: Math.max(0, height), class: part.className,
        });
        appendTitle(rect, `${formatTimestamp(point.bucket_start)} · ${part.label}: $${part.value.toFixed(6)} (EST)`);
        svg.appendChild(rect);
      });
    });
    drawXAxis(svg, series, bounds);
  }

  function drawThroughputChart(svg, series) {
    if (!svg) return;
    if (!series.length) return drawEmpty(svg, 'No accepted usage in this selection.');
    clear(svg);
    const bounds = { left: 68, top: 20, width: 866, height: 224 };
    const tokenTotals = series.map((point) => finite(point?.tokens?.total) ? point.tokens.total : 0);
    const throughput = series.map((point) => finite(point?.tokens_per_minute) ? point.tokens_per_minute : 0);
    const maxTokens = Math.max(1, ...tokenTotals);
    const maxThroughput = Math.max(1, ...throughput);
    drawGrid(svg, bounds, 4, (ratio) => compactFormat.format(maxTokens * ratio));
    const slot = bounds.width / series.length;
    const barWidth = Math.max(3, Math.min(54, slot * .68));
    const points = [];
    series.forEach((point, index) => {
      const x = bounds.left + (slot * index) + ((slot - barWidth) / 2);
      let y = bounds.top + bounds.height;
      KINDS.forEach((kind) => {
        const value = finite(point?.tokens?.[kind.key]) ? point.tokens[kind.key] : 0;
        const height = value * bounds.height / maxTokens;
        y -= height;
        const rect = svgNode('rect', {
          x, y, width: barWidth, height: Math.max(0, height), class: kind.className,
        });
        appendTitle(rect, `${formatTimestamp(point.bucket_start)} · ${kind.label}: ${formatInteger(value)} tokens`);
        svg.appendChild(rect);
      });
      const pointX = x + (barWidth / 2);
      const pointY = bounds.top + bounds.height - (throughput[index] * bounds.height / maxThroughput);
      points.push(`${pointX},${pointY}`);
    });
    if (points.length) {
      const line = svgNode('polyline', { points: points.join(' '), class: 'throughput-line' });
      appendTitle(line, `Tokens per minute; maximum ${numberFormat.format(maxThroughput)}.`);
      svg.appendChild(line);
      points.forEach((coordinates, index) => {
        const [cx, cy] = coordinates.split(',');
        const circle = svgNode('circle', { cx, cy, r: 4, class: 'throughput-point' });
        appendTitle(circle,
          `${formatTimestamp(series[index].bucket_start)} · ${numberFormat.format(throughput[index])} tokens/minute · ${numberFormat.format(series[index].usage_turns_per_minute)} usage turns/minute`);
        svg.appendChild(circle);
      });
    }
    svg.appendChild(svgNode('text', {
      x: bounds.left + bounds.width, y: bounds.top - 6, 'text-anchor': 'end', class: 'axis-label',
    }, `throughput max ${numberFormat.format(maxThroughput)} tokens/min`));
    drawXAxis(svg, series, bounds);
  }

  function makeCell(row, className = '') {
    const cell = (row.ownerDocument || root.document).createElement('td');
    if (className) cell.className = className;
    row.appendChild(cell);
    return cell;
  }

  function appendLine(parent, text, small = false) {
    const line = (parent.ownerDocument || root.document).createElement(small ? 'small' : 'span');
    line.textContent = text;
    parent.appendChild(line);
  }

  function renderAgents(document, agents) {
    const body = document.getElementById('agent-rows');
    const empty = document.getElementById('agent-empty');
    const count = document.getElementById('agent-count');
    if (!body || !empty) return;
    clear(body);
    empty.hidden = agents.length !== 0;
    if (count) count.textContent = `${formatInteger(agents.length)} attributed agent rows`;
    agents.forEach((agent) => {
      const row = document.createElement('tr');
      const lane = makeCell(row, 'agent-lane');
      lane.textContent = typeof agent.lane === 'string' ? agent.lane : 'unavailable';

      const dimensions = makeCell(row, 'cell-list');
      appendLine(dimensions, Array.isArray(agent.models) && agent.models.length
        ? agent.models.join(', ') : 'models unavailable');
      appendLine(dimensions, Array.isArray(agent.providers) && agent.providers.length
        ? agent.providers.join(', ') : 'providers unavailable', true);

      const tokens = makeCell(row, 'cell-list');
      appendLine(tokens, `IN ${formatInteger(agent.tokens?.input)} · OUT ${formatInteger(agent.tokens?.output)}`);
      appendLine(tokens,
        `CACHE CREATE ${formatInteger(agent.tokens?.cache_create)} · READ ${formatInteger(agent.tokens?.cache_read)}`,
        true);

      const runtime = makeCell(row, 'cell-list');
      const p95 = agent.runtime?.observed_turn_interval_p95_ms;
      appendLine(runtime, finite(p95) ? `${numberFormat.format(p95)} ms` : 'unavailable');
      appendLine(runtime,
        `${formatInteger(agent.runtime?.measured_events)} measured / ${formatInteger(agent.runtime?.total_events)} events`,
        true);

      const cost = makeCell(row,
        estimateDecimal(agent.cost?.usd) === null ? 'cost-cell unpriced' : 'cost-cell');
      cost.textContent = formatCost(agent.cost);

      const context = makeCell(row, 'context-est');
      const contextValue = agent.prompt_context_remaining_p50_pct_est;
      context.textContent = finite(contextValue)
        ? `${numberFormat.format(contextValue)}% (EST)`
        : 'unavailable (EST)';

      const seen = makeCell(row);
      seen.textContent = formatTimestamp(agent.last_seen);
      body.appendChild(row);
    });
  }

  function setText(document, id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function renderBudget(document, budgetForecast) {
    const budget = budgetForecast?.budget || {};
    const remaining = budgetForecast?.remaining || {};
    const forecast = budgetForecast?.forecast || {};
    setText(document, 'budget-limit', estimateDecimal(budget.limit_usd) === null
      ? 'unavailable' : `$${budget.limit_usd}`);
    setText(document, 'budget-spent', formatCost(budgetForecast?.spent));
    setText(document, 'budget-remaining', decimal(remaining.usd) === null
      ? 'unavailable (EST)' : `$${remaining.usd} (EST)`);
    setText(document, 'budget-period', budget.period_start && budget.period_end
      ? `${formatTimestamp(budget.period_start)} → ${formatTimestamp(budget.period_end)}`
      : 'No configured budget period');
    setText(document, 'forecast-label', `${forecast.label} · projection`);
    setText(document, 'forecast-value', estimateDecimal(forecast.usd) === null
      ? 'unavailable' : `$${forecast.usd}`);
    setText(document, 'forecast-as-of', forecast.as_of
      ? `as of ${formatTimestamp(forecast.as_of)} · ${forecast.method || 'method unavailable'}`
      : `${forecast.method || 'method unavailable'} · projection unavailable`);
    const alert = document.getElementById('budget-alert');
    if (alert) {
      const active = budgetForecast?.over_budget_alert?.active === true;
      alert.hidden = !active;
      const overBy = estimateDecimal(budgetForecast?.over_budget_alert?.over_by_usd_est);
      alert.hidden = !active || overBy === null;
      alert.textContent = active && overBy !== null
        ? `Projected token cost exceeds the configured budget by $${budgetForecast.over_budget_alert.over_by_usd_est} (EST).`
        : '';
    }
  }

  function renderCoverage(document, coverage, fresh) {
    setText(document, 'coverage-summary',
      `${formatInteger(coverage.roots_readable)} / ${formatInteger(coverage.roots_configured)} roots readable · ${formatInteger(coverage.files_readable)} / ${formatInteger(coverage.files_seen)} files readable · ${formatInteger(coverage.events_accepted)} events accepted · ${formatInteger(coverage.events_rejected)} rejected · ${formatInteger(coverage.events_unpriced)} unpriced · ${formatInteger(coverage.events_unattributed)} unattributed`);
    const age = finite(fresh.age_seconds) ? `${numberFormat.format(fresh.age_seconds)}s old` : 'age unavailable';
    setText(document, 'freshness-summary',
      `${String(fresh.state || 'unknown').toUpperCase()} · last seen ${formatTimestamp(fresh.last_seen)} · ${age} · stale after ${formatInteger(fresh.stale_after_seconds)}s · checked ${formatTimestamp(fresh.freshness_checked_at)}`);
  }

  function countText(value, singular, plural = `${singular}s`) {
    return `${formatInteger(value)} ${value === 1 ? singular : plural}`;
  }

  function sourceExplanation(coverage, fresh, status, totalCost) {
    const details = [];
    if (coverage.roots_failed) details.push(`${countText(coverage.roots_failed, 'configured root')} unreadable`);
    if (coverage.files_failed) details.push(`${countText(coverage.files_failed, 'transcript file')} unreadable`);
    if (coverage.events_rejected) details.push(`${countText(coverage.events_rejected, 'usage record')} rejected for invalid required fields`);
    if (coverage.events_unattributed) details.push(`${countText(coverage.events_unattributed, 'accepted event')} unattributed`);
    if (coverage.events_unmapped_provider) details.push(`${countText(coverage.events_unmapped_provider, 'event')} with no mapped provider`);
    if (coverage.events_unpriced) details.push(`${countText(coverage.events_unpriced, 'event')} with no published rate`);

    const freshness = status === 'unavailable'
      ? (coverage.roots_readable === 0
        ? 'The source is unavailable because no configured transcript root is readable.'
        : 'The source is unavailable because no accepted transcript events were found.')
      : (fresh.state === 'unknown'
        ? (fresh.last_seen
          ? 'Freshness is unknown because the latest accepted transcript timestamp is later than the check time.'
          : 'Freshness is unknown because no accepted transcript timestamp is available.')
        : '');
    const estimate = estimateDecimal(totalCost?.usd) === null
      ? (totalCost?.total_events
        ? `The selected total is unpriced: ${countText(totalCost.total_events - totalCost.priced_events, 'selected event')} lack a published rate.`
        : 'No selected events have a published-rate estimate.')
      : `The dollar amount is an estimate from published token rates for all ${countText(totalCost.total_events, 'selected event')}.`;
    const completeness = status === 'partial' && details.length
      ? `This view is partial because ${details.join('; ')}.`
      : '';
    return [
      'Reads Claude Code session transcript JSONL from configured roots (default: ~/.claude/projects/**/*.jsonl, within ~/.claude/**/*.jsonl).',
      completeness,
      freshness,
      estimate,
    ].filter(Boolean).join(' ');
  }

  function render(document, payload) {
    const status = document.getElementById('connection-status');
    if (status) {
      status.dataset.state = payload.status;
      status.textContent = `${payload.status.toUpperCase()} · as of ${formatTimestamp(payload.as_of)}`;
    }
    setText(document, 'summary-cost', formatCost(payload.total_cost));
    setText(document, 'summary-agents', formatInteger(payload.agents_with_usage));
    setText(document, 'summary-tokens', formatInteger(payload.total_tokens?.total));
    setText(document, 'summary-source', String(payload.source_fresh?.state || payload.status).toUpperCase());
    setText(document, 'source-explainer', sourceExplanation(
      payload.source_coverage, payload.source_fresh, payload.status, payload.total_cost
    ));
    const start = formatTimestamp(payload.window?.start);
    const end = formatTimestamp(payload.window?.end);
    setText(document, 'cost-chart-note', `${start} → ${end} · USD (EST)`);
    const latest = payload.series[payload.series.length - 1];
    setText(document, 'throughput-chart-note', latest
      ? `Latest bucket: ${formatDecimal(latest.tokens_per_minute, ' tokens/min')} · ${formatDecimal(latest.usage_turns_per_minute, ' usage turns/min')}`
      : `${start} → ${end}`);
    drawCostChart(document.getElementById('cost-chart'), payload.series);
    drawThroughputChart(document.getElementById('throughput-chart'), payload.series);
    renderBudget(document, payload.budget_forecast);
    renderAgents(document, payload.agents);
    renderCoverage(document, payload.source_coverage, payload.source_fresh);
  }

  function observedValues(payload, key, field) {
    const rows = Array.isArray(payload?.[key]) ? payload[key] : [];
    return Array.from(new Set(rows
      .map((row) => row?.[field])
      .filter((value) => typeof value === 'string' && value)))
      .sort();
  }

  function updateSelect(select, values, allLabel) {
    if (!select) return '';
    const selected = select.value;
    clear(select);
    const document = select.ownerDocument || root.document;
    const all = document.createElement('option');
    all.value = '';
    all.textContent = allLabel;
    select.appendChild(all);
    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = values.includes(selected) ? selected : '';
    return select.value;
  }

  async function requestJson(request, url) {
    const response = await request(url, {
      method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    if (!response?.ok) throw new Error(`CostView returned HTTP ${response?.status || 'unknown'}`);
    const payload = await response.json();
    if (!validateSnapshot(payload)) throw new Error('CostView response contract mismatch');
    return payload;
  }

  // CostView is deliberately fail-closed: observed usage data is a live-only
  // launch surface, and a missing or malformed release bootstrap is never
  // permission to request it.
  function liveEnabled() {
    try {
      return root.OfficeFeatureFlags?.enabled?.('costview_live') === true;
    } catch (_) {
      return false;
    }
  }

  function comingSoonCard(document, close) {
    const card = document.createElement('section');
    card.className = 'office-costview-card office-costview-coming-soon-card';
    card.setAttribute('aria-label', 'CostView — coming soon');
    const eyebrow = document.createElement('p');
    eyebrow.className = 'office-costview-kicker';
    eyebrow.textContent = 'OBSERVED USAGE';
    const title = document.createElement('h2');
    title.textContent = 'CostView';
    const status = document.createElement('p');
    status.className = 'office-costview-coming-soon-status';
    status.textContent = 'COMING SOON';
    const copy = document.createElement('p');
    copy.className = 'office-costview-coming-soon-copy';
    copy.textContent = 'Measured tokens and published-rate estimates will appear here.';
    card.append(eyebrow, title, status, copy);
    if (close) card.append(close);
    return card;
  }

  function renderComingSoon(document) {
    const shell = document.getElementById?.('officeCostView');
    if (shell) {
      const close = shell.querySelector?.('[data-modal-close]') || null;
      const card = comingSoonCard(document, close);
      shell.replaceChildren(card);
      shell.dataset.costviewMounted = 'coming-soon';
      return card;
    }

    // The standalone document is not given release bootstrap data, so it uses
    // the same fail-closed launch card until a live release hosts the panel.
    const main = document.getElementById?.('costview-main');
    if (!main) return null;
    const card = comingSoonCard(document, null);
    main.replaceChildren(card);
    return card;
  }

  function mount(document = root.document, request = root.fetch?.bind(root)) {
    if (!document) return null;
    if (!liveEnabled()) return renderComingSoon(document);
    if (typeof request !== 'function') return null;
    const model = document.getElementById('model-filter');
    const provider = document.getElementById('provider-filter');
    const refreshButton = document.getElementById('refresh-view');
    if (!model || !provider || !refreshButton || document.body?.dataset.costviewMounted === 'true') {
      return null;
    }
    document.body.dataset.costviewMounted = 'true';
    let generation = 0;

    async function refresh() {
      const current = ++generation;
      refreshButton.disabled = true;
      try {
        const observed = await requestJson(request, ENDPOINT);
        if (current !== generation) return;
        const selectedModel = updateSelect(
          model, observedValues(observed, 'models', 'model'), 'All observed models'
        );
        const selectedProvider = updateSelect(
          provider, observedValues(observed, 'providers', 'provider'), 'All observed providers'
        );
        const filtered = selectedModel || selectedProvider
          ? await requestJson(request, buildUrl(selectedModel, selectedProvider))
          : observed;
        if (current === generation) render(document, filtered);
      } catch {
        if (current !== generation) return;
        const status = document.getElementById('connection-status');
        if (status) {
          status.dataset.state = 'error';
          status.textContent = 'SOURCE UNAVAILABLE · retrying automatically';
        }
      } finally {
        if (current === generation) refreshButton.disabled = false;
      }
    }

    model.addEventListener('change', refresh);
    provider.addEventListener('change', refresh);
    refreshButton.addEventListener('click', refresh);
    const timer = root.setInterval(refresh, POLL_MS);
    refresh();
    return Object.freeze({ refresh, timer });
  }

  return Object.freeze({
    ENDPOINT,
    POLL_MS,
    KINDS,
    decimal,
    formatCost,
    sourceExplanation,
    buildUrl,
    validateSnapshot,
    observedValues,
    drawCostChart,
    drawThroughputChart,
    render,
    liveEnabled,
    renderComingSoon,
    mount,
  });
}));
