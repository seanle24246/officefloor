(function () {
  'use strict';

  var stage = document.getElementById('demo-stage');
  var frame = document.getElementById('demo-frame');
  var chips = Array.prototype.slice.call(document.querySelectorAll('[data-demo-theme]'));
  if (!stage || !frame || !chips.length) return;

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (candidate) {
        candidate.classList.remove('active');
        candidate.setAttribute('aria-pressed', 'false');
      });
      chip.classList.add('active');
      chip.setAttribute('aria-pressed', 'true');

      var theme = chip.getAttribute('data-demo-theme') || '';
      stage.classList.remove('theme-beach', 'theme-naruto');
      if (theme) stage.classList.add('theme-' + theme);
      frame.src = 'embed/demo.html' + (theme ? '?theme=' + encodeURIComponent(theme) : '');
    });
  });
}());
