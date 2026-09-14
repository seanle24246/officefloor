(function () {
  'use strict';

  // The "Pick the room" carousel on /fun. Vanilla, no deps, plain script so it
  // runs wherever the page opens, including straight from disk.
  var root = document.getElementById('rooms');
  if (!root) return;
  var slides = Array.prototype.slice.call(root.querySelectorAll('.slide'));
  var dots = Array.prototype.slice.call(root.querySelectorAll('.slide-dot'));
  if (slides.length < 2) return;

  var index = Math.max(0, slides.findIndex(function (s) { return s.classList.contains('active'); }));
  var timer = null;
  var paused = false;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function show(next) {
    index = (next + slides.length) % slides.length;
    slides.forEach(function (slide, i) {
      slide.classList.toggle('active', i === index);
      slide.setAttribute('aria-hidden', i === index ? 'false' : 'true');
    });
    dots.forEach(function (dot, i) {
      dot.classList.toggle('active', i === index);
      dot.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function start() {
    stop();
    if (reduceMotion || paused) return;
    timer = setInterval(function () { show(index + 1); }, 5200);
  }
  function go(next) { show(next); start(); }

  dots.forEach(function (dot, i) { dot.addEventListener('click', function () { go(i); }); });
  var prev = root.querySelector('.slide-prev');
  var next = root.querySelector('.slide-next');
  if (prev) prev.addEventListener('click', function () { go(index - 1); });
  if (next) next.addEventListener('click', function () { go(index + 1); });

  root.addEventListener('mouseenter', function () { paused = true; stop(); });
  root.addEventListener('mouseleave', function () { paused = false; start(); });
  root.addEventListener('focusin', function () { paused = true; stop(); });
  root.addEventListener('focusout', function () { paused = false; start(); });
  root.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
  });
  if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '0');

  show(index);
  start();
}());
