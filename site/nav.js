/* Shared primary-navigation links for every public marketing page. */
(function () {
  'use strict';

  const routeName = location.pathname.split('/').pop().toLowerCase();
  const pageName = ({
    '': 'index.html',
    index: 'index.html',
    about: 'about.html',
    install: 'install.html',
    soon: 'soon.html',
    fun: 'fun.html',
  })[routeName] || routeName;
  const NAV_ITEMS = Object.freeze([
    { label: 'How it works', href: pageName === 'index.html' ? '#how' : 'index.html#how' },
    { label: 'Install', href: 'install.html', page: 'install.html' },
    { label: 'About', href: 'about.html', page: 'about.html' },
    { label: 'Coming soon', href: 'soon.html', page: 'soon.html' },
    { label: 'Fun', href: 'fun.html', page: 'fun.html' },
    { label: 'GitHub', href: 'https://github.com/seanle24246/officefloor', external: true },
  ]);

  document.querySelectorAll('[data-primary-navlinks]').forEach((host) => {
    host.innerHTML = NAV_ITEMS.map(({ label, href, page, external }) => {
      const active = page === pageName ? ' class="active" aria-current="page"' : '';
      const ext = external ? ' rel="noopener"' : '';
      return `<a${active}${ext} href="${href}">${label}</a>`;
    }).join('');
  });
}());
