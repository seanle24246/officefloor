/* Ship checklist page logic.
 *
 * The page never invents a row: `catalog` comes from tools/ship_manifest.py,
 * which reads feature_flags.json, release_manifest.json and the four packaging
 * places the public wheel strips. This file only renders those rows, tracks
 * ON/OFF plus sign-off, and posts the result back to the local server.
 */
"use strict";

var state = { catalog: null, manifest: null, path: "release/ship-manifest.json" };

function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) { node.className = cls; }
  if (text !== undefined) { node.textContent = text; }
  return node;
}

function toast(message) {
  document.getElementById("toast").textContent = message || "";
}

/* The document carries BOTH targets; the page only ever edits the active one,
 * so switching target never borrows the other target's sign-offs. */
function activeTarget() {
  return (state.manifest.targets || {})[state.manifest.target] || {};
}

function rowsOf(section) {
  return activeTarget()[section] || {};
}

/* A private inclusion can never ride in a public wheel (AUD-WHL-01). */
function blockedReason(kind, entry) {
  if (kind === "inclusion" && entry.private && state.manifest.target === "public") {
    return "private content — a public wheel can never carry it (AUD-WHL-01)";
  }
  return "";
}

function stamp(row) {
  if (!row.signed) { return "not signed off"; }
  var who = state.manifest.signed_by || "?";
  return "signed " + who + (row.signed_at ? " · " + row.signed_at : "");
}

function render() {
  var manifest = state.manifest;
  var catalog = state.catalog;
  document.getElementById("version").textContent =
    "· " + catalog.version + " · " + state.path;
  document.getElementById("target").value = manifest.target;
  document.getElementById("signer").value = manifest.signed_by || "";

  var host = document.getElementById("rows");
  host.textContent = "";
  var onCount = 0, driftCount = 0, unsignedCount = 0;

  catalog.areas.forEach(function (area) {
    var entries = [];
    catalog.flags.forEach(function (entry) {
      if (entry.area === area) { entries.push(["flag", entry]); }
    });
    catalog.inclusions.forEach(function (entry) {
      if (entry.area === area) { entries.push(["inclusion", entry]); }
    });
    if (!entries.length) { return; }

    var section = el("section");
    section.appendChild(el("h2", null, area));
    entries.forEach(function (pair) {
      var kind = pair[0];
      var entry = pair[1];
      var bucket = kind === "flag" ? "flags" : "inclusions";
      var row = rowsOf(bucket)[entry.name];
      if (!row) { return; }
      var blocked = blockedReason(kind, entry);
      if (blocked && row.on) { row.on = false; }
      if (row.on) { onCount += 1; }
      if (row.on !== entry.release_default) { driftCount += 1; }
      if (row.on && !row.signed) { unsignedCount += 1; }

      var line = el("div", "row" + (blocked ? " blocked" : ""));

      var toggleCell = el("div");
      var toggle = el("input", "toggle");
      toggle.type = "checkbox";
      toggle.checked = !!row.on;
      toggle.disabled = !!blocked;
      toggle.setAttribute("aria-label", entry.name);
      toggle.addEventListener("change", function () {
        row.on = toggle.checked;
        if (!row.on) { row.signed = false; row.signed_at = null; }
        touch();
      });
      toggleCell.appendChild(toggle);
      toggleCell.appendChild(el("span", "state" + (row.on ? " is-on" : ""),
        row.on ? "on" : "off"));
      line.appendChild(toggleCell);

      var body = el("div");
      var title = el("div", "name", entry.name);
      title.appendChild(el("span", "kind", kind === "flag" ? "flag"
        : (entry.private ? "private inclusion" : "inclusion")));
      body.appendChild(title);
      body.appendChild(el("div", "desc", entry.desc));
      body.appendChild(el("div", "cite", entry.cite));
      if (blocked) { body.appendChild(el("div", "why", blocked)); }
      line.appendChild(body);

      var dflt = el("div", "default");
      dflt.appendChild(el("span", null, "default "));
      dflt.appendChild(el("b", null, entry.release_default ? "ON" : "OFF"));
      if (row.on !== entry.release_default) {
        dflt.appendChild(el("div", "drift", "changed"));
      }
      line.appendChild(dflt);

      var sign = el("div", "sign");
      var label = el("label");
      var box = el("input");
      box.type = "checkbox";
      box.checked = !!row.signed;
      box.disabled = !row.on;
      box.addEventListener("change", function () {
        row.signed = box.checked;
        row.signed_at = box.checked ? new Date().toISOString() : null;
        touch();
      });
      label.appendChild(box);
      label.appendChild(el("span", null, "signed off"));
      sign.appendChild(label);
      sign.appendChild(el("span", "stamp", stamp(row)));
      line.appendChild(sign);

      section.appendChild(line);
    });
    host.appendChild(section);
  });

  document.getElementById("count-on").textContent = String(onCount);
  document.getElementById("count-drift").textContent = String(driftCount);
  document.getElementById("count-unsigned").textContent = String(unsignedCount);
  document.getElementById("build").disabled = unsignedCount > 0;
}

/* Any edit invalidates the server's last verdict; the header counters carry
 * the live picture until Save (or Build) asks the server again. */
function touch() {
  showProblems([]);
  render();
}

function showProblems(problems) {
  var list = document.getElementById("problems");
  list.textContent = "";
  (problems || []).forEach(function (problem) {
    list.appendChild(el("li", null, problem));
  });
}

function load() {
  fetch("/api/state").then(function (response) {
    return response.json();
  }).then(function (payload) {
    state.catalog = payload.catalog;
    state.manifest = payload.manifest;
    state.path = payload.path;
    render();
    showProblems(payload.exists ? payload.problems : []);
    toast(payload.exists ? "" : "no manifest on disk yet — Save to create one");
  }).catch(function (error) {
    toast("cannot reach the checklist server: " + error);
  });
}

function save() {
  state.manifest.signed_by = document.getElementById("signer").value.trim();
  state.manifest.signed_at = new Date().toISOString();
  return fetch("/api/manifest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.manifest)
  }).then(function (response) {
    return response.json();
  }).then(function (payload) {
    if (payload.error) { toast(payload.error); return; }
    state.manifest = payload.manifest;
    render();
    showProblems(payload.problems);
    toast("saved " + payload.saved);
  }).catch(function (error) {
    toast("save failed: " + error);
  });
}

function build() {
  var out = document.getElementById("console");
  out.textContent = "";
  document.getElementById("build").disabled = true;
  toast("building…");
  fetch("/api/build", { method: "POST" }).then(function (response) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          toast("build finished");
          render();
          return;
        }
        out.textContent += decoder.decode(chunk.value, { stream: true });
        out.scrollTop = out.scrollHeight;
        return pump();
      });
    }
    return pump();
  }).catch(function (error) {
    out.textContent += "\nstream failed: " + error + "\n";
    toast("build failed");
    render();
  });
}

document.getElementById("target").addEventListener("change", function (event) {
  state.manifest.target = event.target.value;
  touch();
});
document.getElementById("signer").addEventListener("input", function (event) {
  state.manifest.signed_by = event.target.value.trim();
  touch();
});
document.getElementById("sign-all").addEventListener("click", function () {
  var now = new Date().toISOString();
  ["flags", "inclusions"].forEach(function (bucket) {
    var rows = rowsOf(bucket);
    Object.keys(rows).forEach(function (name) {
      if (rows[name].on && !rows[name].signed) {
        rows[name].signed = true;
        rows[name].signed_at = now;
      }
    });
  });
  touch();
  toast("signed every ON row — review, then Save");
});
document.getElementById("save").addEventListener("click", save);
document.getElementById("build").addEventListener("click", function () {
  save().then(build);
});

load();
