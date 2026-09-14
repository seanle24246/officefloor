# `site/` — the public landing page

What someone who has never heard of this product sees. Four marketing pages and
a playable demo floor, no build step, no dependencies, no external requests: it
opens from a bare clone, from `file://`, offline, on a phone, and deploys to any
static host.

```
site/
  index.html      the landing page
  demo.html       the redesigned demo route and interactive-demo frame
  about.html      the product story
  soon.html       the clearly labelled online-floor preview
  site.css        the shared founder-approved v10 design system
  site.js         the demo theme controls
  og.jpg          social-card image — a capture of the DEMO floor only
  vercel.json     static-deploy config (clean URLs, /demo route, headers)
  build_demo.py   regenerates embed/demo.html + audits the whole directory
  smoke_demo.js   boots embed/demo.html and proves it draws
  embed/demo.html the generated, audited interactive demo floor
  embed/assets/   the leak-audited public demo captures
```

## The one hard rule

**Nothing in here may carry a real fact about a real org.** No real seat names,
no real roster, no branches, no status text, no screenshots of a live floor.
The demo floor is baked from `DEMO_ROSTER` in `serve.py` — a synthetic fleet of
22 invented seats — and from nothing else.

That rule is enforced, not remembered:

```bash
python3 site/build_demo.py           # rebuild embed/demo.html, audited before it's kept
python3 site/build_demo.py --check   # audit what's committed, write nothing
node    site/smoke_demo.js           # boot the bake, prove it renders
```

`build_demo.py` is a wrapper around the product's own `build_standalone.py`,
for one reason: that script bakes whatever roster the office resolves, and from
a lane checkout inside a real org **it resolves the real one**. The wrapper
points root resolution at an empty directory so demo mode has no manifest to
find, then audits the file it just wrote and **deletes it** if any of this is
true:

- a lane appears that isn't in `DEMO_ROSTER`
- a volatile field survived the bake (outbox text, branch, blockers, pid, ctx…)
- `commits_ahead` is anything other than `0`
- an org lane name, an org root name, or an absolute `/Users/…` path appears
- the founder's github handle, the private repo URL, or an internal repo path
  appears **anywhere** in the file text (not just in attributes)
- any `src`/`href` points off the machine (canonical/icon/social metadata links
  are exempt — they are hints, not resources the page fetches to render)

Findings come in two tiers: `LEAK` fails the build, `NOTE` is reported and does
not. The standalone specialization removes live action branches before they
are inlined, so the current bake contains neither a real lane nor the old
`sweep.sh` product-copy note.

### Asset credits are restated, not shipped raw

`build_standalone.py` embeds the repo's `CREDITS.md` as a trailing comment.
`CREDITS.md` is generated from `static/assets/MANIFEST`, and its `source`
records cite the **private** repo (github handle, internal packet paths, commit
SHAs) — a real fact about a real org. `build_demo.py` **restates** that block
from the manifest's public `licence_source` fields instead: the same honest
attribution (ambientCG, the Wikimedia author, the licence), with zero org
internals. Every shipped asset is CC0 / public-domain-equivalent, so nothing
legally required is dropped.

## Regenerating

`embed/demo.html` is generated but committed, so the demo works from a bare clone
with one click and no Python. That means it can go stale: **rebuild it whenever
`static/` or `serve.py`'s demo path changes**, and always before a release. The
audit runs automatically on every rebuild.

`smoke_demo.js` exists because a green test suite is not evidence that a floor
draws — `office.js` once threw at top level and rendered nothing for five
merges while the collector selftest stayed green. The smoke executes the baked
file's scripts in an inert DOM and fails if the boot path throws. (It has since
caught exactly that: a bake that stripped an idle-render helper while its caller
survived — the demo booted 142 scripts and threw. Fixed in `build_standalone.py`.)

## Deploying

The site is static — zero server. The acceptance test is that
`python3 -m http.server` in `site/` behaves identically to the deployed host.

```bash
cd site && python3 -m http.server 8000   # → http://127.0.0.1:8000
```

`vercel.json` configures a Vercel static deploy: `cleanUrls` (so `/` and
`/demo`-style paths resolve), a `/demo → /demo.html` rewrite, and two safe
headers. Deploy from this directory:

```bash
cd site && vercel        # founder's account; this is the founder-gated go-live
```

All in-page links use relative paths (`demo.html`, `og.jpg`), so both the
`http.server` acceptance run and the Vercel deploy serve the same files.

## What the page claims, and where each claim comes from

Every factual statement on `index.html` traces to product behaviour, not to
marketing:

| Claim on the page | Source |
|---|---|
| process, branch, heartbeat and outbox-backed receipts | the collector fields rendered by the floor |
| honest unknown states | the collector's fail-closed classification rules |
| no telemetry, no build step, localhost binding | the product's standing doctrine |
| synthetic 22-seat public demo | `DEMO_ROSTER` plus the `build_demo.py` leak audit |
| dogs, cats and rabbits in the catalog | `static/office.sku.pack.pets.js` plus the generated SKU catalog |
| the ring is coming soon | the explicit label on the unshipped ring card |

If one of those changes in the product, it changes here too. A landing page
that overstates a floor whose entire pitch is that it never overstates anything
is the most expensive kind of copy error.

## Known blank

The install CTA is `pip install officefloor` — the PyPI name is claimed and the
domain is `officefloor.ai`. The **quickstart commands run `officefloor --demo`
and `officefloor --allrepos <dir>`** — the console entry point declared in
`pyproject.toml` (`[project.scripts] officefloor = office_cli:main`) and verified
against the clean-room wheel. That is what a `pip install officefloor` user
actually gets; the old `python3 serve.py` quickstart was source-only and did not
exist for a pip user (SITE-QUICKSTART-FIX, 2026-08-26). The default port is 8788.
There is no published public repo URL yet, so the page links no `github` (a dead
link would be the one fiction this page cannot afford).
