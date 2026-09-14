/* office.influence.events.js — client-only, default-off consequence proposal seam.
 *
 * Contract in: OfficeInfluenceCore.consequenceFor(outcome, ctx) -> bounded,
 * reversible, fictional proposal. Contract out: an approved proposal reaches
 * applyInfluenceProposal(proposal), the documented Mac office-events seam.
 *
 * This module owns no mood/vitals state and performs no I/O. A card answer is
 * the gate between proposal and apply. The default consumer is deliberately a
 * no-op until Mac's office-events mount owns real presentation/application.
 */
OFFICE.module('influence.events', [], () => {
'use strict';

const root = typeof window === 'undefined' ? globalThis : window;
const FLAG = 'agent_influence';

function enabled(flags = root.OfficeFeatureFlags) {
  return flags?.enabled?.(FLAG) === true;
}

function coreFor(options) {
  if (options?.core) return options.core;
  return root.OfficeInfluenceCore || null;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizedConsequence(value, core) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof core?.isBounded !== 'function' || core.isBounded(value) !== true) return null;
  if (typeof value.kind !== 'string' || typeof value.scope !== 'string'
      || !finite(value.magnitude) || !Number.isSafeInteger(value.ttl)
      || value.fiction !== true || value.reversible !== true) return null;
  return Object.freeze({
    kind: value.kind,
    scope: value.scope,
    magnitude: value.magnitude,
    target: typeof value.target === 'string' ? value.target : null,
    stat: typeof value.stat === 'string' ? value.stat : null,
    ttl: value.ttl,
    fiction: true,
    reversible: true,
    source: Object.freeze({ ...(value.source || {}) }),
  });
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function proposalId(outcome, consequence) {
  const outcomeId = typeof outcome?.id === 'string' ? outcome.id : '';
  return `influence-${hash([outcomeId, consequence.kind, consequence.target, consequence.ttl].join(':'))}`;
}

function nowFor(options) {
  const now = typeof options?.now === 'function' ? options.now() : Date.now() / 1000;
  return finite(now) ? now : null;
}

function isProposal(value) {
  return value && typeof value === 'object'
    && value.fiction === true
    && value.reversible === true
    && typeof value.id === 'string'
    && value.consequence && value.consequence.fiction === true
    && value.consequence.reversible === true
    && finite(value.expiresAt);
}

function consequenceFor(outcome, ctx, options = {}) {
  if (!enabled(options.flags)) return null;
  const core = coreFor(options);
  if (typeof core?.consequenceFor !== 'function' || typeof core?.isBounded !== 'function') return null;
  let consequence;
  try { consequence = core.consequenceFor(outcome, ctx); } catch (_) { return null; }
  return normalizedConsequence(consequence, core);
}

function proposalFor(outcome, ctx, options = {}) {
  const consequence = consequenceFor(outcome, ctx, options);
  const createdAt = nowFor(options);
  if (!consequence || createdAt === null) return null;
  return Object.freeze({
    id: proposalId(outcome, consequence),
    fiction: true,
    reversible: true,
    status: 'proposed',
    consequence,
    createdAt,
    expiresAt: createdAt + consequence.ttl,
  });
}

function decisionFor(proposal) {
  if (!isProposal(proposal)) return null;
  const { kind, magnitude, target, scope } = proposal.consequence;
  return Object.freeze({
    id: proposal.id,
    portrait: null,
    title: 'OFFICE EVENT',
    body: `Fictional ${kind} proposal for ${target || scope} (${magnitude}). Apply temporary effect?`,
    choices: Object.freeze([
      Object.freeze({ key: 'a', label: 'Apply fictional effect', tone: 'affirm' }),
      Object.freeze({ key: 'd', label: 'Decline', tone: 'decline' }),
    ]),
  });
}

function current(proposal, options) {
  const now = nowFor(options);
  return now !== null && now < proposal.expiresAt;
}

function applyInfluenceProposal(proposal) {
  // TODO(Mac office-events): mount card/mood application here. Until then this
  // truthful receipt records that approval happened without inventing a mood.
  return Object.freeze({ applied: false, reason: 'office-events-unwired', proposalId: proposal.id });
}

function revertInfluenceProposal(proposal) {
  // TODO(Mac office-events): reverse the matching temporary mood/vitals draw.
  return Object.freeze({ reverted: false, reason: 'office-events-unwired', proposalId: proposal.id });
}

function consumerFor(options) {
  return options?.applyInfluenceProposal || root.applyInfluenceProposal || applyInfluenceProposal;
}

function reverterFor(options) {
  return options?.revertInfluenceProposal || root.revertInfluenceProposal || revertInfluenceProposal;
}

function resolve(proposal, choice, options = {}) {
  if (!enabled(options.flags) || !isProposal(proposal)) return null;
  if (!current(proposal, options)) {
    return Object.freeze({ proposal, status: 'declined', reason: 'expired' });
  }
  if (choice !== 'a') {
    return Object.freeze({ proposal, status: 'declined', reason: 'declined' });
  }
  let receipt;
  try { receipt = consumerFor(options)(proposal); } catch (_) { return null; }
  return Object.freeze({
    ...proposal,
    status: receipt?.applied === true ? 'applied' : 'accepted',
    appliedAt: nowFor(options),
    receipt: receipt || null,
  });
}

function revert(applied, options = {}) {
  if (!enabled(options.flags) || !isProposal(applied) || applied.status !== 'applied') return null;
  let receipt;
  try { receipt = reverterFor(options)(applied); } catch (_) { return null; }
  return Object.freeze({ ...applied, status: receipt?.reverted === true ? 'reverted' : 'revert-pending', revertedAt: nowFor(options), receipt: receipt || null });
}

function cardFor(options) {
  if (options?.card) return options.card;
  return root.OFFICE?.vignette?.card || null;
}

function propose(outcome, ctx, options = {}) {
  const proposal = proposalFor(outcome, ctx, options);
  if (!proposal) return null;
  const card = cardFor(options);
  const decision = decisionFor(proposal);
  if (decision && typeof card?.show === 'function') {
    try { card.show(decision, (_, choice) => resolve(proposal, choice, options)); } catch (_) { /* event seam remains usable */ }
  }
  return proposal;
}

return Object.freeze({
  FLAG,
  enabled,
  consequenceFor,
  proposalFor,
  decisionFor,
  propose,
  resolve,
  revert,
  applyInfluenceProposal,
  revertInfluenceProposal,
});
});
