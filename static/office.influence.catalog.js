/* office.influence.catalog.js — candidate consequence content for agent influence.
 *
 * Pure, deeply frozen definitions. This file deliberately does not register, apply, persist,
 * or serve consequences: the SEAT-D adapter has not landed, and CHOREO.md §5 keeps every
 * consequence a gated proposal. A future adapter may consume this bank only when the
 * agent_influence flag is explicitly true, validate the bounded template through the influence
 * core, and retain the proposal evidence below. No operational truth or personnel outcome lives
 * here; every effect is temporary, fictional, and paired with an inverse descriptor. Raw
 * definitions are inert like other content banks; forOutcome() is the only runtime-selection
 * seam and it fails closed unless the feature flag and complete proposal evidence are present.
 */
(function installInfluenceCatalog(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeInfluenceCatalog = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  'use strict';

  const FLAG = 'agent_influence';
  const BOUNDS = Object.freeze({
    mood: 0.15,
    buff: 0.30,
    debuff: 0.30,
    event_card: 0.15,
    ttl: 600,
  });
  const KINDS = new Set(['mood', 'buff', 'debuff', 'event_card']);
  const AGENT_STATS = new Set(['tiredness', 'drunkenness', 'wired', 'hunger', 'thirst']);
  const SURFACES = new Set(['office_mood', 'office_morale', 'agent_vitals', 'office_event_cards']);
  const EFFECT_INSTANCE = 'proposal.id';
  const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
    return Object.freeze(value);
  }

  function row({
    id,
    proposes,
    from,
    blastRadius,
    kind,
    scope,
    stat = null,
    magnitude,
    ttl,
    surface,
    title,
    body,
  }) {
    const content = { id, title, body };
    const reversible = kind === 'event_card'
      ? 'Remove only the event-card effect instance identified by the proposal id at expiry.'
      : 'Remove only the temporary modifier instance identified by the proposal id at expiry.';
    return {
      id,
      proposes,
      from_outcomes: from,
      evidence: ['outcome.id', 'outcome.seed', 'outcome.participants'],
      blast_radius: blastRadius,
      reversible,
      template: {
        kind,
        scope,
        target: scope === 'agent' ? 'participants[0]' : 'office',
        stat,
        magnitude,
        ttl,
        surface,
        fiction: true,
        reversible: true,
        // Adapters project active instances onto their own fictional surfaces. Removing the
        // exact proposal instance restores the prior state even when projection clamps at a
        // boundary, and overlapping instances cannot remove one another.
        apply: { op: 'add_effect', instance: EFFECT_INSTANCE },
        revert: { op: 'remove_effect', instance: EFFECT_INSTANCE },
      },
      content,
    };
  }

  const definitions = [
    row({
      id: 'watercooler-morale',
      proposes: 'Give the fictional office a small, temporary lift after a friendly hallway chat.',
      from: ['water-cooler-chat'],
      blastRadius: 'Office mood only; no agent truth, work, or standing changes.',
      kind: 'mood', scope: 'office', magnitude: 0.05, ttl: 300,
      surface: 'office_morale',
      title: 'Cooler Camaraderie',
      body: 'A good hallway chat gives the fictional office a brief morale lift.',
    }),
    row({
      id: 'coffee-focus',
      proposes: 'Give one fictional participant a short wired lift after a coffee run.',
      from: ['coffee-run'],
      blastRadius: 'First fictional participant\'s temporary wired value only.',
      kind: 'buff', scope: 'agent', stat: 'wired', magnitude: 0.10, ttl: 180,
      surface: 'agent_vitals',
      title: 'Fresh Pot',
      body: 'A fresh cup adds a short burst of fictional focus, followed by an ordinary reset.',
    }),
    row({
      id: 'shared-meal-belonging',
      proposes: 'Nudge fictional office morale upward after a shared meal.',
      from: ['shared-meal'],
      blastRadius: 'Office morale only, capped and temporary.',
      kind: 'mood', scope: 'office', magnitude: 0.06, ttl: 240,
      surface: 'office_morale',
      title: 'Table for Everyone',
      body: 'Sharing the table leaves the fictional room feeling a little more connected.',
    }),
    row({
      id: 'smoke-break-perspective',
      proposes: 'Apply a small fictional mood lift after a reflective outdoor conversation.',
      from: ['smoke-break-chat', 'smoking-route'],
      blastRadius: 'Office mood only; the vignette remains fiction and changes no real record.',
      kind: 'mood', scope: 'office', magnitude: 0.03, ttl: 180,
      surface: 'office_mood',
      title: 'Outside Perspective',
      body: 'A brief conversation outside softens the fictional room\'s mood for a moment.',
    }),
    row({
      id: 'rested-reset',
      proposes: 'Temporarily reduce one fictional participant\'s tiredness after a nap.',
      from: ['nap'],
      blastRadius: 'First fictional participant\'s tiredness value only.',
      kind: 'buff', scope: 'agent', stat: 'tiredness', magnitude: -0.20, ttl: 200,
      surface: 'agent_vitals',
      title: 'Rested Reset',
      body: 'A short nap clears some fictional tiredness until the rested window closes.',
    }),
    row({
      id: 'argument-cloud',
      proposes: 'Apply a small, temporary fictional morale dip after an argument.',
      from: ['argument'],
      blastRadius: 'Office morale only; no relationship, work, or personnel record changes.',
      kind: 'debuff', scope: 'office', magnitude: -0.07, ttl: 240,
      surface: 'office_morale',
      title: 'Tension in the Air',
      body: 'The fictional room stays a little tense, then returns to its prior morale.',
    }),
    row({
      id: 'visitor-buzz-card',
      proposes: 'Show a temporary fictional office-event card for a visitor arrival.',
      from: ['visitor-arrival'],
      blastRadius: 'One temporary office-event card; no admission, identity, or real-world claim.',
      kind: 'event_card', scope: 'office', magnitude: 0.08, ttl: 300,
      surface: 'office_event_cards',
      title: 'Visitor in the Lobby',
      body: 'A fictional visitor has arrived, making room for one brief office beat.',
    }),
    row({
      id: 'side-by-side-momentum',
      proposes: 'Give fictional office morale a bounded lift after a collaborative recovery.',
      from: ['rivalry-side-by-side', 'promotion-shared-recovery'],
      blastRadius: 'Office morale only; it does not evaluate either participant.',
      kind: 'mood', scope: 'office', magnitude: 0.08, ttl: 300,
      surface: 'office_morale',
      title: 'Side-by-Side Momentum',
      body: 'A shared fictional recovery gives the room a short cooperative lift.',
    }),
    row({
      id: 'earned-mutual-respect',
      proposes: 'Apply a temporary fictional morale lift after a story resolves with mutual respect.',
      from: ['rivalry-rematch-clause', 'romance-chapter-two'],
      blastRadius: 'Office morale only; no ranking, relationship truth, or lasting status.',
      kind: 'mood', scope: 'office', magnitude: 0.10, ttl: 420,
      surface: 'office_morale',
      title: 'Mutual Respect',
      body: 'The fictional room carries a little warmth from a story that ended honestly.',
    }),
    row({
      id: 'missed-signal-dip',
      proposes: 'Apply a small fictional morale dip after a harmless story misunderstanding.',
      from: ['romance-missed-signal'],
      blastRadius: 'Office morale only; no relationship claim survives the fictional beat.',
      kind: 'mood', scope: 'office', magnitude: -0.04, ttl: 180,
      surface: 'office_morale',
      title: 'A Quiet Coffee Break',
      body: 'A missed fictional signal briefly cools the room before the story moves on.',
    }),
    row({
      id: 'showcase-crisis-fatigue',
      proposes: 'Temporarily raise one fictional participant\'s tiredness after a showcase crisis.',
      from: ['promotion-showcase-collapse'],
      blastRadius: 'First fictional participant\'s tiredness value only.',
      kind: 'debuff', scope: 'agent', stat: 'tiredness', magnitude: 0.14, ttl: 180,
      surface: 'agent_vitals',
      title: 'Showcase Aftershock',
      body: 'The fictional scramble leaves one participant tired until the short effect expires.',
    }),
    row({
      id: 'feedback-focus',
      proposes: 'Give one fictional participant a short wired lift after constructive feedback.',
      from: ['promotion-feedback-swap'],
      blastRadius: 'First fictional participant\'s wired value only.',
      kind: 'buff', scope: 'agent', stat: 'wired', magnitude: 0.09, ttl: 240,
      surface: 'agent_vitals',
      title: 'Feedback Focus',
      body: 'A useful fictional review sharpens attention for one short scene.',
    }),
    row({
      id: 'night-shift-case-card',
      proposes: 'Show a temporary fictional office-event card when the night-shift mystery turns.',
      from: ['mystery-night-shift-script'],
      blastRadius: 'One temporary office-event card; no security or operational assertion.',
      kind: 'event_card', scope: 'office', magnitude: 0.05, ttl: 300,
      surface: 'office_event_cards',
      title: 'The Night-Shift Script',
      body: 'A forgotten fictional demo script explains the clock, the timer, and the paper cranes.',
    }),
    row({
      id: 'blue-crane-round-two-card',
      proposes: 'Show a temporary fictional office-event card for the mystery\'s next clue.',
      from: ['mystery-round-two'],
      blastRadius: 'One temporary office-event card; no persistent case or truth claim.',
      kind: 'event_card', scope: 'office', magnitude: 0.06, ttl: 420,
      surface: 'office_event_cards',
      title: 'A Blue Crane',
      body: 'The solved fictional case leaves one impossible blue crane marked ROUND TWO.',
    }),
    row({
      id: 'runaway-operation-fatigue',
      proposes: 'Temporarily raise one fictional participant\'s tiredness after a runaway caper.',
      from: ['heist-wrong-door', 'heist-cart-chase'],
      blastRadius: 'First fictional participant\'s tiredness value only.',
      kind: 'debuff', scope: 'agent', stat: 'tiredness', magnitude: 0.10, ttl: 180,
      surface: 'agent_vitals',
      title: 'Runaway Operation',
      body: 'Chasing a fictional cleaning robot leaves one participant briefly worn out.',
    }),
    row({
      id: 'permission-first-relief',
      proposes: 'Give fictional office morale a bounded lift after the caper ends by asking for help.',
      from: ['heist-ask-next-time'],
      blastRadius: 'Office morale only; no judgment about a real colleague or action.',
      kind: 'mood', scope: 'office', magnitude: 0.07, ttl: 300,
      surface: 'office_morale',
      title: 'Permission First',
      body: 'The harmless fictional caper ends with a simple request and a relieved room.',
    }),
    row({
      id: 'benchmark-reality-card',
      proposes: 'Show a temporary fictional event card after the same-picture benchmark vignette.',
      from: ['meme-corporate-same-picture'],
      blastRadius: 'One temporary office-event card; no claim about a real benchmark.',
      kind: 'event_card', scope: 'office', magnitude: 0.04, ttl: 240,
      surface: 'office_event_cards',
      title: 'The Same Benchmark',
      body: 'The fictional office pauses to spot the difference between two suspiciously similar charts.',
    }),
    row({
      id: 'legacy-system-pride',
      proposes: 'Apply a small fictional morale lift after the legacy-system pride vignette.',
      from: ['meme-gigachad-cobol'],
      blastRadius: 'Office morale only; no technology or performance judgment.',
      kind: 'mood', scope: 'office', magnitude: 0.06, ttl: 300,
      surface: 'office_morale',
      title: 'Still Shipping',
      body: 'A fictional legacy system earns a brief moment of affectionate respect.',
    }),
    row({
      id: 'oncall-fatigue',
      proposes: 'Temporarily raise one fictional participant\'s tiredness after an on-call vignette.',
      from: ['meme-this-is-fine-oncall'],
      blastRadius: 'First fictional participant\'s tiredness value only; no incident truth.',
      kind: 'debuff', scope: 'agent', stat: 'tiredness', magnitude: 0.16, ttl: 300,
      surface: 'agent_vitals',
      title: 'Pager Afterglow',
      body: 'The fictional pager stops, leaving one participant tired for a short cooldown.',
    }),
    row({
      id: 'swarm-curiosity',
      proposes: 'Give one fictional participant a short wired lift after the swarm vignette.',
      from: ['meme-distracted-by-the-swarm'],
      blastRadius: 'First fictional participant\'s wired value only.',
      kind: 'buff', scope: 'agent', stat: 'wired', magnitude: 0.08, ttl: 180,
      surface: 'agent_vitals',
      title: 'Swarm Curiosity',
      body: 'A strange fictional swarm sharpens one participant\'s attention for a moment.',
    }),
    row({
      id: 'gpu-queue-gloom',
      proposes: 'Apply a small fictional morale dip after the once-again-GPUs vignette.',
      from: ['meme-once-again-gpus'],
      blastRadius: 'Office morale only; no cost, capacity, or operational claim.',
      kind: 'mood', scope: 'office', magnitude: -0.05, ttl: 240,
      surface: 'office_morale',
      title: 'Queue Gloom',
      body: 'One more fictional queue briefly dims the room before the joke passes.',
    }),
    row({
      id: 'migration-spectacle-card',
      proposes: 'Show a temporary fictional event card after the data-migration spectacle.',
      from: ['meme-is-this-a-data-migration'],
      blastRadius: 'One temporary office-event card; no claim about a real migration.',
      kind: 'event_card', scope: 'office', magnitude: 0.05, ttl: 300,
      surface: 'office_event_cards',
      title: 'Is This a Migration?',
      body: 'The fictional office gets one dramatic card for a migration nobody can quite identify.',
    }),
  ];

  function validateDefinition(definition, seenIds, seenOutcomes) {
    if (!definition || !ID_RE.test(definition.id) || seenIds.has(definition.id)) {
      throw new TypeError(`influence catalog invalid or duplicate id: ${definition?.id || ''}`);
    }
    seenIds.add(definition.id);
    for (const field of ['proposes', 'blast_radius', 'reversible']) {
      if (typeof definition[field] !== 'string' || !definition[field].trim()) {
        throw new TypeError(`influence catalog ${definition.id}.${field} must be non-empty`);
      }
    }
    if (!Array.isArray(definition.from_outcomes) || !definition.from_outcomes.length) {
      throw new TypeError(`influence catalog ${definition.id} needs an outcome trigger`);
    }
    for (const outcome of definition.from_outcomes) {
      if (typeof outcome !== 'string' || !ID_RE.test(outcome) || seenOutcomes.has(outcome)) {
        throw new TypeError(`influence catalog duplicate or invalid outcome: ${outcome}`);
      }
      seenOutcomes.add(outcome);
    }
    if (JSON.stringify(definition.evidence)
        !== JSON.stringify(['outcome.id', 'outcome.seed', 'outcome.participants'])) {
      throw new TypeError(`influence catalog ${definition.id} evidence contract drifted`);
    }

    const template = definition.template;
    if (!template || !KINDS.has(template.kind)) {
      throw new TypeError(`influence catalog ${definition.id} has an invalid kind`);
    }
    if (template.scope !== 'office' && template.scope !== 'agent') {
      throw new TypeError(`influence catalog ${definition.id} has an invalid scope`);
    }
    if (template.scope === 'agent' && !AGENT_STATS.has(template.stat)) {
      throw new TypeError(`influence catalog ${definition.id} has an invalid agent stat`);
    }
    if (template.scope === 'office' && template.stat !== null) {
      throw new TypeError(`influence catalog ${definition.id} office template must not name a stat`);
    }
    if (template.target !== (template.scope === 'agent' ? 'participants[0]' : 'office')) {
      throw new TypeError(`influence catalog ${definition.id} has an invalid target selector`);
    }
    if (!SURFACES.has(template.surface)
        || (template.scope === 'agent' && template.surface !== 'agent_vitals')
        || (template.scope === 'office' && template.surface === 'agent_vitals')
        || (template.kind === 'mood'
          && !['office_mood', 'office_morale'].includes(template.surface))
        || (template.kind === 'buff' && template.surface !== 'agent_vitals')
        || (template.kind === 'event_card' && template.surface !== 'office_event_cards')
        || (template.kind !== 'event_card' && template.surface === 'office_event_cards')) {
      throw new TypeError(`influence catalog ${definition.id} has an invalid semantic surface`);
    }
    const bound = BOUNDS[template.kind];
    if (!Number.isFinite(template.magnitude) || template.magnitude === 0
        || Math.abs(template.magnitude) > bound
        || !Number.isSafeInteger(template.ttl) || template.ttl < 1 || template.ttl > BOUNDS.ttl
        || template.fiction !== true || template.reversible !== true) {
      throw new TypeError(`influence catalog ${definition.id} leaves the bounded fiction envelope`);
    }
    if (JSON.stringify(template.apply)
          !== JSON.stringify({ op: 'add_effect', instance: EFFECT_INSTANCE })
        || JSON.stringify(template.revert)
          !== JSON.stringify({ op: 'remove_effect', instance: EFFECT_INSTANCE })) {
      throw new TypeError(`influence catalog ${definition.id} instance inverse drifted`);
    }
    if (!definition.content || definition.content.id !== definition.id
        || typeof definition.content.title !== 'string' || !definition.content.title.trim()
        || typeof definition.content.body !== 'string' || !definition.content.body.trim()) {
      throw new TypeError(`influence catalog ${definition.id} content is incomplete`);
    }
  }

  const seenIds = new Set();
  const seenOutcomes = new Set();
  for (const definition of definitions) validateDefinition(definition, seenIds, seenOutcomes);

  const CATALOG = deepFreeze(definitions.slice());
  const byId = new Map(CATALOG.map((definition) => [definition.id, definition]));
  const EMPTY = Object.freeze([]);

  function enabled(flags = root.OfficeFeatureFlags) {
    try {
      return flags?.enabled?.(FLAG) === true;
    } catch (_) {
      return false;
    }
  }

  function outcomeTokens(outcome) {
    const tokens = new Set();
    const add = (value) => {
      if (typeof value === 'string' && value) tokens.add(value);
    };
    try {
      // id identifies this occurrence for CHOREO idempotency; it is never a reusable type token.
      add(outcome.kind);
      add(outcome.beatId);
      add(outcome.vignetteId);
      add(outcome.bankId);
      add(outcome.source?.outcome);
    } catch (_) {
      return null;
    }
    return tokens;
  }

  function hasRequiredEvidence(outcome) {
    try {
      const seed = outcome.seed;
      return typeof outcome.id === 'string' && outcome.id.trim().length > 0
        && (Number.isSafeInteger(seed) || (typeof seed === 'string' && seed.trim().length > 0))
        && outcome.fiction === true
        && Array.isArray(outcome.participants) && outcome.participants.length > 0
        && outcome.participants.every((participant) => (
          typeof participant === 'string' && participant.trim().length > 0
        ));
    } catch (_) {
      return false;
    }
  }

  function get(id) {
    return byId.get(id) || null;
  }

  function forOutcome(outcome, flags = root.OfficeFeatureFlags) {
    // Guard first: flag-off must not even inspect a caller-owned outcome object.
    if (!enabled(flags)) return EMPTY;
    if (!outcome || typeof outcome !== 'object') return EMPTY;
    // Candidate content is unavailable until an adapter can carry CHOREO's complete evidence.
    // Existing story/meme surfaces omit at least one field and therefore remain inert.
    if (!hasRequiredEvidence(outcome)) return EMPTY;
    const tokens = outcomeTokens(outcome);
    if (!tokens || !tokens.size) return EMPTY;
    const matches = CATALOG.filter((definition) => (
      definition.from_outcomes.some((candidate) => tokens.has(candidate))
    ));
    // One encounter proposes at most one content row. Ambiguous normalized identities fail closed
    // instead of stacking individually bounded effects into an unbounded aggregate.
    return matches.length === 1 ? Object.freeze(matches) : EMPTY;
  }

  return deepFreeze({ FLAG, BOUNDS, CATALOG, get, forOutcome });
}));
