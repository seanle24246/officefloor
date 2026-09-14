/* office.tooltips.js — honest hover/focus labels for the floor controls. */
OFFICE.module('tooltips', [], () => {
'use strict';

const tooltip = document.createElement('div');
tooltip.id = 'officeTooltip';
tooltip.className = 'office-tooltip';
tooltip.setAttribute('role', 'tooltip');
tooltip.hidden = true;
document.body.append(tooltip);

let active = null;
const nativeTitles = new WeakMap();

function copyFor(target) {
  if (target.id === 'follow') {
    return target.getAttribute('aria-pressed') === 'true'
      ? 'Following the latest floor activity (F).'
      : 'Follow the latest floor activity (F).';
  }
  if (target.id === 'recenter') return 'Fit the full floor in view.';
  if (target.title) return target.title;
  if (target.classList.contains('demo')) return 'Demo fleet — simulated data, not live seats.';
  if (target.classList.contains('live')) return 'Live fleet — connected office data.';
  return 'Fleet mode is loading.';
}

function tooltipPos(rect, size, viewport, gap = 8) {
  const left = Math.max(gap, Math.min(rect.left + rect.width / 2 - size.width / 2, viewport.innerWidth - size.width - gap));
  let top = rect.bottom + gap;
  if (rect.bottom + gap + size.height > viewport.innerHeight) {
    top = rect.top - size.height - gap;
  }
  top = Math.max(gap, top);
  return { left, top };
}

function place(target) {
  const rect = target.getBoundingClientRect();
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  const pos = tooltipPos(rect, { width, height }, { innerWidth: innerWidth, innerHeight: innerHeight });
  tooltip.style.left = `${pos.left}px`;
  tooltip.style.top = `${pos.top}px`;
}

function show(target) {
  active = target;
  tooltip.textContent = copyFor(target);
  tooltip.hidden = false;
  target.setAttribute('aria-describedby', tooltip.id);
  if (target.title) {
    nativeTitles.set(target, target.title);
    target.removeAttribute('title');
  }
  place(target);
}

function hide(target) {
  if (active !== target) return;
  active = null;
  tooltip.hidden = true;
  target.removeAttribute('aria-describedby');
  if (nativeTitles.has(target)) {
    target.title = nativeTitles.get(target);
    nativeTitles.delete(target);
  }
}

for (const target of [document.getElementById('follow'), document.getElementById('recenter'), document.getElementById('mode')]) {
  target.addEventListener('mouseenter', () => show(target));
  target.addEventListener('mouseleave', () => hide(target));
  target.addEventListener('focus', () => show(target));
  target.addEventListener('blur', () => hide(target));
  target.addEventListener('click', () => { if (active === target) show(target); });
}

window.addEventListener('resize', () => { if (active) place(active); });
window.addEventListener('scroll', () => { if (active) place(active); }, true);

return { show, hide, tooltipPos };
});
