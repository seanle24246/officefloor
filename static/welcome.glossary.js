/* welcome.glossary.js — plain-language explainers for roster seat roles. */
(function installWelcomeGlossary(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OfficeWelcomeGlossary = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const EXPLAINERS = Object.freeze({
    CEO: 'The CEO — runs the floor, hands out work, and reports back to you.',
    CTO: 'The CTO — owns the architecture and how the pieces fit together.',
    COO: 'The COO — keeps the day-to-day operations running.',
    CMO: 'The CMO — owns growth and getting the product in front of people.',
    CPO: 'The CPO — owns the product itself: what gets built and why.',
    CSO: 'The CSO — owns security across the floor.',
    REVIEW: "Review — checks other seats' work before it ships.",
    IC: 'An individual contributor — builds one specific piece of the product.',
    EDUCATION: 'Education — writes docs and helps everyone else understand the system.',
    CFO: 'The CFO — watches the budget, payments, and spending across the floor.',
    ADVERSARIAL: 'Adversarial review — tries to break the system before it ships.',
    GOVERNANCE: 'Governance — keeps decisions, standards, and accountability clear.',
  });

  function explainerFor(role) {
    if (typeof role !== 'string' || role.trim() === '') {
      return "This seat's role isn't recorded.";
    }

    const separator = ' — ';
    const separatorIndex = role.indexOf(separator);
    const prefix = (separatorIndex === -1
      ? role
      : role.slice(0, separatorIndex)).trim();
    if (Object.prototype.hasOwnProperty.call(EXPLAINERS, prefix)) {
      return EXPLAINERS[prefix];
    }
    return `This seat's role is "${role}" — not yet catalogued here.`;
  }

  return Object.freeze({ explainerFor });
}));
