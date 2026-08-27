/**
 * prerelation-js landing — rendering and the upload calculator.
 *
 * Division of labor: every statistic on this page is computed by the
 * shipped library (web/prerelation.browser.js, generated from src/) —
 * live in this browser for the four-panel widget and the calculator, or
 * reproduced from the library's own recorded, seeded runs for the two
 * real-data demonstrations (web/demo_data.js). Pure calculator logic
 * (CSV parsing, the anchored-range gate, the M floor, CSV export) lives
 * in web/calc_core.js so that the test suite can exercise it. This file
 * only draws and wires.
 *
 * Written as a classic script with no imports so the page opens straight
 * from the file system; the permutation work runs in a Web Worker when
 * the browser allows one, and falls back to the main thread when not.
 */
/* global PRERELATION, PRERELATION_CALC, PRERELATION_DEMO */
(function () {
  "use strict";

  var LIB = window.PRERELATION;
  var CALC = window.PRERELATION_CALC;
  var DEMO = window.PRERELATION_DEMO;

  var DELTA_BAND = LIB.DELTA; // 0.05, frozen convention of the definition
  var TOP_Q = LIB.TOP_Q; // 0.8, frozen
  var SVG_NS = "http://www.w3.org/2000/svg";
  var WIDGET_SEED = 20260827;
  var WIDGET_N = 400;

  /* ------------------------------------------------------------- helpers */

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    if (text != null) node.textContent = text;
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  function fmt(value, digits) {
    var text = Number(value).toFixed(digits == null ? 3 : digits);
    // toFixed keeps the sign of a tiny negative number that rounds to
    // zero, so Delta for a near-symmetric pair would print as "-0.000".
    // The value is right; the minus sign is noise.
    if (Number(text) === 0) text = text.replace("-", "");
    return text;
  }

  function pearsonR(x, y) {
    var n = x.length;
    var mx = 0;
    var my = 0;
    for (var i = 0; i < n; i++) {
      mx += x[i];
      my += y[i];
    }
    mx /= n;
    my /= n;
    var sxy = 0;
    var sxx = 0;
    var syy = 0;
    for (var j = 0; j < n; j++) {
      var dx = x[j] - mx;
      var dy = y[j] - my;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    var den = Math.sqrt(sxx * syy);
    return den > 0 ? sxy / den : 0;
  }

  function tealFill(pi) {
    var t = Math.pow(Math.max(0, Math.min(1, pi)), 0.65);
    var from = [247, 248, 245];
    var to = [22, 86, 79];
    var rgb = from.map(function (c, i) {
      return Math.round(c + (to[i] - c) * t);
    });
    return "rgb(" + rgb.join(",") + ")";
  }

  /* -------------------------------------------------- generic scan views */
  /**
   * A ScanView draws one scan result — the Pi matrix, the Hasse diagram of
   * the quotient order, and a pair inspector — into a fixed set of host
   * elements. The dataset object mirrors the demo payload:
   * { names, n, alpha, nPerm, seed, records, edges, cycles, classes,
   *   hasseEdges, theta } with records carrying
   * { source, target, pi, pi_reverse, delta, A1, A2, q, ell, p_value,
   *   p_adj, edge }.
   */
  function ScanView(hosts) {
    this.hosts = hosts;
    this.d = null;
    this.source = null;
    this.target = null;
  }

  ScanView.prototype.recordFor = function (source, target) {
    var recs = this.d.records;
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].source === source && recs[i].target === target) return recs[i];
    }
    return null;
  };

  ScanView.prototype.show = function (dataset) {
    this.d = dataset;
    var best = null;
    dataset.records.forEach(function (rec) {
      if (!best) best = rec;
      var betterFit =
        (rec.edge && !best.edge) || (rec.edge === best.edge && rec.pi > best.pi);
      if (betterFit) best = rec;
    });
    this.source = best.source;
    this.target = best.target;
    this.renderMatrix();
    this.renderHasse();
    this.renderInspector();
  };

  ScanView.prototype.renderMatrix = function () {
    var self = this;
    var d = this.d;
    var host = this.hosts.matrix;
    host.innerHTML = "";
    var table = el("table", { class: "matrix" });

    var head = el("tr");
    head.appendChild(el("th", {}, ""));
    d.names.forEach(function (name) {
      head.appendChild(el("th", { class: "col", scope: "col" }, name));
    });
    table.appendChild(head);

    d.names.forEach(function (source) {
      var row = el("tr");
      row.appendChild(el("th", { scope: "row" }, source));
      d.names.forEach(function (target) {
        var td = el("td");
        if (source === target) {
          td.appendChild(el("div", { class: "cell diag", "aria-hidden": "true" }));
          row.appendChild(td);
          return;
        }
        var rec = self.recordFor(source, target);
        var button = el(
          "button",
          {
            type: "button",
            class:
              "cell" +
              (rec.edge ? " edge" : "") +
              (source === self.source && target === self.target ? " selected" : ""),
            style:
              "background:" +
              tealFill(rec.pi) +
              ";color:" +
              (rec.pi > 0.45 ? "#f7f8f5" : "#1a2420"),
            title:
              source + " \u2192 " + target + ": \u03a0 = " + fmt(rec.pi),
          },
          fmt(rec.pi, 2)
        );
        button.addEventListener("click", function () {
          self.source = source;
          self.target = target;
          self.renderMatrix();
          self.renderInspector();
        });
        td.appendChild(button);
        row.appendChild(td);
      });
      table.appendChild(row);
    });

    host.appendChild(table);
  };

  function layerClasses(classes, hasseEdges) {
    var level = classes.map(function () {
      return 0;
    });
    for (var pass = 0; pass < classes.length; pass++) {
      hasseEdges.forEach(function (e) {
        if (level[e[1]] < level[e[0]] + 1) level[e[1]] = level[e[0]] + 1;
      });
    }
    return level;
  }

  ScanView.prototype.renderHasse = function () {
    var d = this.d;
    var host = this.hosts.hasse;
    host.innerHTML = "";

    var level = layerClasses(d.classes, d.hasseEdges);
    var maxLevel = Math.max.apply(null, level.concat([0]));
    var byLevel = [];
    for (var i = 0; i <= maxLevel; i++) byLevel.push([]);
    level.forEach(function (lv, ci) {
      byLevel[lv].push(ci);
    });

    var width = 460;
    var rowHeight = 92;
    var height = 40 + (maxLevel + 1) * rowHeight;
    var svg = svgEl("svg", {
      viewBox: "0 0 " + width + " " + height,
      role: "img",
      "aria-label": "Hasse diagram of the quotient order",
    });

    var pos = {};
    byLevel.forEach(function (members, lv) {
      var step = width / (members.length + 1);
      members.forEach(function (ci, idx) {
        pos[ci] = { x: step * (idx + 1), y: 34 + lv * rowHeight };
      });
    });

    var markerId = "arrow-" + this.hosts.idPrefix;
    var marker = svgEl("marker", {
      id: markerId,
      viewBox: "0 0 8 8",
      refX: "7",
      refY: "4",
      markerWidth: "7",
      markerHeight: "7",
      orient: "auto-start-reverse",
    });
    marker.appendChild(svgEl("path", { d: "M0,0 L8,4 L0,8 z", fill: "#55605a" }));
    var defs = svgEl("defs");
    defs.appendChild(marker);
    svg.appendChild(defs);

    d.hasseEdges.forEach(function (e) {
      var a = pos[e[0]];
      var b = pos[e[1]];
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var pad = 26;
      svg.appendChild(
        svgEl("line", {
          x1: a.x + (dx / len) * pad,
          y1: a.y + (dy / len) * pad,
          x2: b.x - (dx / len) * pad,
          y2: b.y - (dy / len) * pad,
          stroke: "#55605a",
          "stroke-width": "1.4",
          "marker-end": "url(#" + markerId + ")",
        })
      );
    });

    d.classes.forEach(function (members, ci) {
      var p = pos[ci];
      var merged = members.length > 1;
      var g = svgEl("g", { class: "classnode", tabindex: "0" });
      var label = members.join(" \u00b7 ");
      var boxWidth = Math.max(58, 13 + label.length * 6.6);
      g.appendChild(
        svgEl("rect", {
          x: p.x - boxWidth / 2,
          y: p.y - 17,
          width: boxWidth,
          height: 34,
          rx: merged ? 16 : 3,
          fill: merged ? "#efeaf6" : "#f7f8f5",
          stroke: merged ? "#5c4a86" : "#16564f",
          "stroke-width": merged ? "1.6" : "1.2",
        })
      );
      var text = svgEl("text", {
        x: p.x,
        y: p.y + 4,
        "text-anchor": "middle",
        "font-family": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        "font-size": "11",
        fill: merged ? "#5c4a86" : "#1a2420",
      });
      text.textContent = label;
      g.appendChild(text);
      var title = svgEl("title");
      title.textContent = merged
        ? "Equivalence class of " + members.length + " mutually dominating attributes"
        : members[0];
      g.appendChild(title);
      svg.appendChild(g);
    });

    host.appendChild(svg);

    var merged = d.classes.filter(function (c) {
      return c.length > 1;
    });
    var caption =
      d.edges.length + " of " + d.records.length + " ordered pairs retained. ";
    if (d.cycles.length > 0) {
      caption +=
        d.cycles.length +
        " directed cycle" +
        (d.cycles.length === 1 ? "" : "s") +
        " in the raw edge set, condensed into " +
        merged.length +
        " merged node" +
        (merged.length === 1 ? "" : "s") +
        "; the quotient order is what is drawn.";
    } else {
      caption +=
        "The edge set is acyclic, so every class is a single attribute and the diagram is the transitive reduction.";
    }
    this.hosts.hasseCaption.textContent = caption;
  };

  ScanView.prototype.renderInspector = function () {
    var d = this.d;
    var rec = this.recordFor(this.source, this.target);
    this.hosts.inspectorTitle.textContent =
      "Pair inspector \u2014 " + rec.source + " \u2192 " + rec.target;
    this.hosts.inspectorNote.textContent =
      "Does " + rec.source + " act as a ceiling on " + rec.target + "?";

    var rows = [
      ["A1 corner", rec.A1, false],
      ["q interior", rec.q, false],
      ["\u2113 ceiling", rec.ell, false],
      ["A2 = q \u00b7 \u2113", rec.A2, false],
      ["\u03a0 = A1 \u00b7 A2", rec.pi, true],
      ["\u03a0 reverse", rec.pi_reverse, false],
    ];
    var host = this.hosts.components;
    host.innerHTML = "";
    rows.forEach(function (row) {
      var wrap = el("div");
      wrap.appendChild(el("dt", {}, row[0]));
      var bar = el("div", { class: "bar" + (row[2] ? " product" : "") });
      bar.appendChild(
        el("span", {
          style: "width:" + Math.max(0, Math.min(1, row[1])) * 100 + "%",
        })
      );
      wrap.appendChild(bar);
      wrap.appendChild(el("dd", {}, fmt(row[1])));
      host.appendChild(wrap);
    });

    var verdict = this.hosts.verdict;
    verdict.innerHTML = "";
    verdict.appendChild(
      el(
        "span",
        {},
        "\u0394 " +
          fmt(rec.delta) +
          " \u00b7 p " +
          fmt(rec.p_value, 4) +
          " \u00b7 adjusted p " +
          fmt(rec.p_adj, 4) +
          " \u00b7 "
      )
    );
    verdict.appendChild(
      el(
        "strong",
        {},
        rec.edge ? "retained at FDR " + d.alpha : "not retained"
      )
    );

    this.hosts.scatter.innerHTML = "";
    drawScatter(this.hosts.scatter, d, rec.source, rec.target);
  };

  /**
   * Anchored-scale scatter of (source, target) with the three overlays:
   * the corner {Y > X}, the ceiling band, and the top-x rule.
   */
  function drawScatter(host, d, sourceName, targetName) {
    var xi = d.names.indexOf(sourceName);
    var yi = d.names.indexOf(targetName);

    var size = 360;
    var pad = 34;
    var plot = size - pad - 14;
    var svg = svgEl("svg", {
      viewBox: "0 0 " + size + " " + size,
      role: "img",
      "aria-label":
        "Scatter of " +
        sourceName +
        " against " +
        targetName +
        " with the corner region and the ceiling band",
    });

    var sx = function (v) {
      return pad + v * plot;
    };
    var sy = function (v) {
      return size - 14 - v * plot;
    };

    svg.appendChild(
      svgEl("polygon", {
        points: [
          sx(0) + "," + sy(0),
          sx(1) + "," + sy(1),
          sx(0) + "," + sy(1),
        ].join(" "),
        fill: "#96731c",
        opacity: "0.10",
      })
    );

    var hatchId = "hatch-" + host.id;
    var hatch = svgEl("pattern", {
      id: hatchId,
      width: "6",
      height: "6",
      patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)",
    });
    hatch.appendChild(
      svgEl("line", {
        x1: "0",
        y1: "0",
        x2: "0",
        y2: "6",
        stroke: "#4c8a83",
        "stroke-width": "1.4",
        opacity: "0.55",
      })
    );
    var defs = svgEl("defs");
    defs.appendChild(hatch);
    svg.appendChild(defs);
    svg.appendChild(
      svgEl("polygon", {
        points: [
          sx(0) + "," + sy(0),
          sx(1) + "," + sy(1),
          sx(1) + "," + sy(1 - DELTA_BAND),
        ].join(" "),
        fill: "url(#" + hatchId + ")",
      })
    );

    svg.appendChild(
      svgEl("rect", {
        x: sx(0),
        y: sy(1),
        width: plot,
        height: plot,
        fill: "none",
        stroke: "#c7ccc2",
        "stroke-width": "1",
      })
    );
    svg.appendChild(
      svgEl("line", {
        x1: sx(0),
        y1: sy(0),
        x2: sx(1),
        y2: sy(1),
        stroke: "#55605a",
        "stroke-width": "1",
        "stroke-dasharray": "4 3",
      })
    );

    var xs = d.theta
      .map(function (row) {
        return row[xi];
      })
      .slice()
      .sort(function (a, b) {
        return a - b;
      });
    var pos = TOP_Q * (xs.length - 1);
    var lo = Math.floor(pos);
    var hi = Math.min(lo + 1, xs.length - 1);
    var thr = xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
    svg.appendChild(
      svgEl("line", {
        x1: sx(thr),
        y1: sy(0),
        x2: sx(thr),
        y2: sy(1),
        stroke: "#96731c",
        "stroke-width": "1",
        "stroke-dasharray": "2 4",
      })
    );
    var thrLabel = svgEl("text", {
      x: sx(thr) + 4,
      y: sy(1) + 12,
      "font-family": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      "font-size": "10",
      fill: "#96731c",
    });
    thrLabel.textContent = "top-x";
    svg.appendChild(thrLabel);

    var maxPoints = 1400;
    var stride = Math.max(1, Math.ceil(d.theta.length / maxPoints));
    var shown = 0;
    for (var i = 0; i < d.theta.length; i += stride) {
      svg.appendChild(
        svgEl("circle", {
          cx: sx(d.theta[i][xi]),
          cy: sy(d.theta[i][yi]),
          r: "1.7",
          fill: "#16564f",
          opacity: "0.32",
        })
      );
      shown += 1;
    }

    [[sourceName, "x"], [targetName, "y"]].forEach(function (pair, idx) {
      var label = svgEl("text", {
        "font-family": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        "font-size": "11",
        fill: "#55605a",
      });
      if (idx === 0) {
        label.setAttribute("x", sx(0.5));
        label.setAttribute("y", size - 1);
        label.setAttribute("text-anchor", "middle");
      } else {
        label.setAttribute("x", 11);
        label.setAttribute("y", sy(0.5));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("transform", "rotate(-90 11 " + sy(0.5) + ")");
      }
      label.textContent = pair[0];
      svg.appendChild(label);
    });

    host.appendChild(svg);
    if (stride > 1) {
      host.appendChild(
        el(
          "p",
          { class: "caption" },
          "Showing every " +
            stride +
            "th person (" +
            shown +
            " of " +
            d.theta.length +
            " points); all statistics use the full sample."
        )
      );
    }
  }

  /* ---------------------------------------- section 3: four-panel widget */

  function uniformStream(seed) {
    var next = LIB.sfc32(seed);
    return function () {
      return next() / 4294967296;
    };
  }

  function makePanelData(kind, seed, n) {
    var u = uniformStream(seed);
    var x = new Array(n);
    var y = new Array(n);
    for (var i = 0; i < n; i++) {
      var xi = u();
      var w = u();
      x[i] = xi;
      if (kind === "product") y[i] = xi * w;
      else if (kind === "min") y[i] = Math.min(xi, w);
      else if (kind === "independent") y[i] = w;
      else y[i] = xi * (1 - 0.04 * w); // equivalence: Y within 4% of X
    }
    return { x: x, y: y };
  }

  function miniScatter(x, y) {
    var size = 150;
    var pad = 6;
    var plot = size - 2 * pad;
    var svg = svgEl("svg", {
      viewBox: "0 0 " + size + " " + size,
      role: "img",
      "aria-label": "scatter of the simulated pair",
    });
    svg.appendChild(
      svgEl("rect", {
        x: pad,
        y: pad,
        width: plot,
        height: plot,
        fill: "#eff1ec",
        stroke: "#c7ccc2",
        "stroke-width": "1",
      })
    );
    svg.appendChild(
      svgEl("line", {
        x1: pad,
        y1: size - pad,
        x2: size - pad,
        y2: pad,
        stroke: "#55605a",
        "stroke-width": "0.8",
        "stroke-dasharray": "3 3",
      })
    );
    for (var i = 0; i < x.length; i++) {
      svg.appendChild(
        svgEl("circle", {
          cx: pad + x[i] * plot,
          cy: size - pad - y[i] * plot,
          r: "1.3",
          fill: "#16564f",
          opacity: "0.35",
        })
      );
    }
    return svg;
  }

  function renderFourPanel() {
    var host = document.getElementById("fourpanel");
    if (!host) return;
    var panels = [
      { kind: "product", label: "Prerequisite (product form)" },
      { kind: "min", label: "Prerequisite (weakest link)" },
      { kind: "independent", label: "Independent skills" },
      { kind: "equivalence", label: "Equivalent skills" },
    ];
    host.innerHTML = "";
    panels.forEach(function (p, idx) {
      var data = makePanelData(p.kind, WIDGET_SEED + idx, WIDGET_N);
      var r = pearsonR(data.x, data.y);
      var dir = LIB.direction(data.x, data.y);
      var card = el("div", {
        class: "cellpanel" + (p.kind === "equivalence" ? " centerpiece" : ""),
      });
      card.appendChild(el("h4", {}, p.label));
      card.appendChild(miniScatter(data.x, data.y));
      var stats = [
        ["Pearson r", fmt(r)],
        ["\u0394", fmt(dir.delta)],
        ["\u03a0(X\u2192Y)", fmt(dir.forward)],
        ["\u03a0(Y\u2192X)", fmt(dir.reverse)],
      ];
      stats.forEach(function (s) {
        var line = el("div", { class: "statline" });
        line.appendChild(el("span", {}, s[0]));
        line.appendChild(el("span", { class: "v" }, s[1]));
        card.appendChild(line);
      });
      host.appendChild(card);
    });
    document.getElementById("fourpanel-meta").textContent =
      "Simulated in this browser by the shipped library \u00b7 n = " +
      WIDGET_N +
      " per panel \u00b7 seed " +
      WIDGET_SEED;
  }

  /* -------------------------------------- section 6: mechanism sketch */

  function renderMechanismSketch() {
    var host = document.getElementById("mechanism-sketch");
    if (!host) return;
    var data = makePanelData("product", WIDGET_SEED + 10, 260);
    var d = {
      names: ["X (prerequisite)", "Y (dependent)"],
      theta: data.x.map(function (xv, i) {
        return [xv, data.y[i]];
      }),
    };
    drawScatter(host, d, d.names[0], d.names[1]);
    var note = el(
      "p",
      { class: "caption" },
      "Shaded: the corner {Y > X} that A1 asks to be empty. Hatched: the " +
        "ceiling band, read as right-censoring. Dotted rule: the top-x " +
        "stratum where \u2113 checks that the censoring thins out. " +
        "Simulated prerequisite pair, seed " +
        (WIDGET_SEED + 10) +
        "."
    );
    host.appendChild(note);
  }

  /* ------------------------------------------ section 5: demonstrations */

  var demoView = null;

  function demoDataset(key) {
    var d = DEMO.datasets[key];
    return {
      names: d.names,
      n: d.n,
      alpha: d.alpha,
      nPerm: d.nPerm,
      seed: d.seed,
      permFloor: d.permFloor,
      records: d.records,
      edges: d.edges,
      cycles: d.cycles,
      classes: d.classes,
      hasseEdges: d.hasseEdges,
      theta: d.theta,
      label: d.label,
      blurb: d.blurb,
    };
  }

  function selectDemo(key) {
    var d = demoDataset(key);
    var parts = [
      d.blurb,
      d.names.length + " attributes",
      "n = " + d.n,
      d.nPerm + " permutations per pair (design floor " + d.permFloor + ")",
      "FDR " + d.alpha,
      "seed " + d.seed,
    ];
    document.getElementById("dataset-meta").textContent = parts.join(" \u00b7 ");
    document.getElementById("explainer-ecpe").style.display =
      key === "ecpe" ? "" : "none";
    document.getElementById("explainer-fs").style.display =
      key === "fs" ? "" : "none";

    var host = document.getElementById("dataset-switch");
    host.innerHTML = "";
    Object.keys(DEMO.datasets).forEach(function (k) {
      var button = el(
        "button",
        { type: "button", "aria-pressed": k === key ? "true" : "false" },
        DEMO.datasets[k].label
      );
      button.addEventListener("click", function () {
        selectDemo(k);
      });
      host.appendChild(button);
    });

    demoView.show(d);
  }

  function initDemos() {
    if (!DEMO) return;
    demoView = new ScanView({
      idPrefix: "demo",
      matrix: document.getElementById("demo-matrix"),
      hasse: document.getElementById("demo-hasse"),
      hasseCaption: document.getElementById("demo-hasse-caption"),
      inspectorTitle: document.getElementById("demo-inspector-title"),
      inspectorNote: document.getElementById("demo-inspector-note"),
      components: document.getElementById("demo-components"),
      verdict: document.getElementById("demo-verdict"),
      scatter: document.getElementById("demo-scatter"),
    });
    selectDemo(Object.keys(DEMO.datasets)[0]);
  }

  /* ------------------------------------------- section 4: the calculator */

  var calcState = {
    names: null, // all parsed column names
    rows: null, // raw cell rows
    selected: null, // indices into names
    data: null, // numeric rows after listwise deletion, selected cols only
    dropped: 0,
    sourceLabel: null,
    worker: null,
    running: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setBanner(kind, html) {
    var host = $("gate-banner");
    host.innerHTML = "";
    if (kind) {
      var b = el("div", { class: "banner " + kind });
      b.innerHTML = html;
      host.appendChild(b);
    }
  }

  function frozenNote(n) {
    return (
      "Frozen conventions of the definition (displayed, not editable): " +
      "TOP_Q = " +
      TOP_Q +
      " \u00b7 \u03b4 = " +
      DELTA_BAND +
      " \u00b7 MIN_INTERIOR = max(10, 0.05\u00b7n)" +
      (n ? " = " + Math.max(10, Math.ceil(0.05 * n)) : "") +
      " \u00b7 FDR \u03b1 = " +
      CALC.ALPHA +
      " (Benjamini\u2013Hochberg, across all ordered pairs)"
    );
  }

  function refreshSelection() {
    var m = calcState.selected.length;
    if (m < 2) {
      $("perm-wrap").style.display = "none";
      $("run").style.display = "none";
      setBanner("warn", "Pick at least two columns.");
      return;
    }
    var sel = CALC.listwiseSelect(calcState.rows, calcState.selected);
    calcState.data = sel.data;
    calcState.dropped = sel.dropped;

    $("file-summary").style.display = "";
    $("file-summary").textContent =
      calcState.sourceLabel +
      " \u00b7 " +
      m +
      " of " +
      calcState.names.length +
      " columns selected \u00b7 n = " +
      sel.kept +
      " rows used" +
      (sel.dropped > 0
        ? " \u00b7 " + sel.dropped + " rows dropped (listwise, missing values)"
        : " \u00b7 no missing values");

    if (sel.kept < 3) {
      setBanner("error", "Fewer than 3 complete rows remain after listwise deletion \u2014 not enough to compute anything.");
      $("run").style.display = "none";
      return;
    }

    var gate = CALC.rangeGate(calcState.data);
    if (!gate.ok) {
      var v = gate.violations[0];
      setBanner(
        "error",
        "<strong>Values outside the anchored [0, 1] scale.</strong> " +
          "Example: row " +
          v.row +
          ", column \u201c" +
          calcState.names[calcState.selected[v.col]] +
          "\u201d = " +
          v.value +
          (gate.violations.length > 1
            ? " (and " + (gate.violations.length - 1) + (gate.truncated ? "+" : "") + " more)"
            : "") +
          ". \u03a0 is defined only on scores anchored at 0 = ignorance and " +
          "1 = mastery, so this calculator does not rescale your data: an " +
          "automatic min\u2013max rescaling would fabricate the anchors and " +
          "with them the coefficient\u2019s meaning. Re-express the scores on " +
          "the anchored scale in your own pipeline, then upload again."
      );
      $("run").style.display = "none";
      $("perm-wrap").style.display = "none";
      $("seed-wrap").style.display = "none";
      $("frozen-note").style.display = "none";
      return;
    }

    var floor = CALC.mFloor(m);
    $("perm-wrap").style.display = "";
    $("seed-wrap").style.display = "";
    var nperm = $("nperm");
    if (!nperm.value || Number(nperm.value) < floor) {
      nperm.value = String(CALC.defaultNPerm(m));
    }
    nperm.min = String(floor);
    $("mfloor-note").textContent =
      "Design floor: M \u2265 K/\u03b1 \u2212 1 = " +
      floor +
      " for K = " +
      m +
      "\u00d7" +
      (m - 1) +
      " = " +
      m * (m - 1) +
      " ordered pairs at \u03b1 = " +
      CALC.ALPHA +
      "; below it no pair can be retained. Default satisfies the floor.";
    $("frozen-note").style.display = "";
    $("frozen-note").textContent = frozenNote(sel.kept);
    setBanner(null);
    $("run").style.display = "";
    $("run").disabled = false;
  }

  function buildColPicker() {
    var wrap = $("col-picker-wrap");
    var host = $("col-picker");
    host.innerHTML = "";
    calcState.names.forEach(function (name, idx) {
      var label = el("label", { class: "colpick" });
      var box = el("input", { type: "checkbox" });
      box.checked = calcState.selected.indexOf(idx) !== -1;
      box.addEventListener("change", function () {
        var at = calcState.selected.indexOf(idx);
        if (box.checked && at === -1) calcState.selected.push(idx);
        if (!box.checked && at !== -1) calcState.selected.splice(at, 1);
        calcState.selected.sort(function (a, b) {
          return a - b;
        });
        refreshSelection();
      });
      label.appendChild(box);
      label.appendChild(document.createTextNode(name));
      host.appendChild(label);
    });
    wrap.style.display = "";
  }

  function acceptTable(names, rows, sourceLabel) {
    calcState.names = names;
    calcState.rows = rows;
    calcState.selected = names.map(function (_, i) {
      return i;
    });
    calcState.sourceLabel = sourceLabel;
    buildColPicker();
    refreshSelection();
  }

  function loadText(text, sourceLabel) {
    try {
      var parsed = CALC.parseTable(text);
      acceptTable(parsed.names, parsed.rows, sourceLabel);
    } catch (err) {
      $("file-summary").style.display = "none";
      $("col-picker-wrap").style.display = "none";
      $("perm-wrap").style.display = "none";
      $("seed-wrap").style.display = "none";
      $("frozen-note").style.display = "none";
      $("run").style.display = "none";
      setBanner("error", "Could not read the file: " + String(err.message || err));
    }
  }

  function loadDemoIntoCalc(key) {
    var d = DEMO.datasets[key];
    var rows = d.theta.map(function (row) {
      return row.map(function (v) {
        return String(v);
      });
    });
    acceptTable(d.names.slice(), rows, d.label + " demo data (n = " + d.n + ")");
  }

  /* ---- running the scan: worker with a main-thread fallback ---- */

  function setProgress(done, total) {
    $("progress-fill").style.width = (100 * done) / total + "%";
    $("progress-text").textContent =
      "ordered pair " + done + " of " + total + " \u2026";
  }

  function finishRun() {
    calcState.running = false;
    $("progress").style.display = "none";
    $("run").disabled = false;
  }

  function runScan() {
    if (calcState.running) return;
    var m = calcState.selected.length;
    var names = calcState.selected.map(function (i) {
      return calcState.names[i];
    });
    var nPerm = Math.floor(Number($("nperm").value));
    var seed = Math.floor(Number($("seed").value));
    var request;
    try {
      request = CALC.makeScanRequest(calcState.data, names, nPerm, seed);
    } catch (err) {
      setBanner("error", String(err.message || err));
      return;
    }
    setBanner(null);
    calcState.running = true;
    $("run").disabled = true;
    $("progress").style.display = "";
    setProgress(0, m * (m - 1));

    var useWorker = typeof Worker !== "undefined";
    if (useWorker) {
      try {
        var worker = new Worker("worker.js");
        calcState.worker = worker;
        worker.onmessage = function (event) {
          var msg = event.data;
          if (msg.type === "progress") setProgress(msg.done, msg.total);
          else if (msg.type === "result") {
            finishRun();
            renderCalcResult(msg.result, names);
          } else if (msg.type === "error") {
            finishRun();
            setBanner("error", "The computation failed: " + msg.message);
          }
        };
        worker.onerror = function () {
          // Typically file:// pages where workers cannot load scripts.
          worker.terminate();
          calcState.worker = null;
          runScanInline(request, names);
        };
        worker.postMessage(request);
        return;
      } catch (err) {
        calcState.worker = null;
      }
    }
    runScanInline(request, names);
  }

  function runScanInline(request, names) {
    $("progress-text").textContent =
      "running without a background worker (the page may pause) \u2026";
    setTimeout(function () {
      try {
        var result = LIB.scan(request.theta, {
          names: request.names,
          nPerm: request.nPerm,
          seed: request.seed,
          alpha: request.alpha,
        });
        finishRun();
        renderCalcResult(
          {
            records: result.records,
            edges: result.edges,
            cycles: result.cycles,
            equivalenceClasses: result.equivalenceClasses,
            quotient: {
              classes: result.quotient.classes,
              quotientEdges: result.quotient.quotientEdges,
              hasseEdges: result.quotient.hasseEdges,
            },
            names: result.names,
            alpha: result.alpha,
            meta: result.meta,
          },
          names
        );
      } catch (err) {
        finishRun();
        setBanner("error", "The computation failed: " + String(err.message || err));
      }
    }, 30);
  }

  function cancelRun() {
    if (calcState.worker) {
      calcState.worker.terminate();
      calcState.worker = null;
    }
    finishRun();
    setBanner("info", "Cancelled \u2014 no results were kept.");
  }

  /* ---- rendering calculator results ---- */

  function resultToDataset(result) {
    return {
      names: result.names,
      n: result.meta.n,
      alpha: result.alpha,
      nPerm: result.meta.nPerm,
      seed: result.meta.seed,
      records: result.records,
      edges: result.edges,
      cycles: result.cycles,
      classes: result.equivalenceClasses,
      hasseEdges: result.quotient.hasseEdges,
      theta: calcState.data,
    };
  }

  function resultsTable(records) {
    var scroll = el("div", { class: "results-scroll" });
    var table = el("table", { class: "results" });
    var cols = [
      "source",
      "target",
      "\u03a0",
      "\u03a0 rev",
      "\u0394",
      "A1",
      "q",
      "\u2113",
      "p",
      "adj p",
      "retained",
    ];
    var head = el("tr");
    cols.forEach(function (c) {
      head.appendChild(el("th", {}, c));
    });
    table.appendChild(head);
    records.forEach(function (rec) {
      var tr = el("tr");
      tr.appendChild(el("td", { class: "name" }, rec.source));
      tr.appendChild(el("td", { class: "name" }, rec.target));
      tr.appendChild(el("td", {}, fmt(rec.pi)));
      tr.appendChild(el("td", {}, fmt(rec.pi_reverse)));
      tr.appendChild(el("td", {}, fmt(rec.delta)));
      tr.appendChild(el("td", {}, fmt(rec.A1)));
      tr.appendChild(el("td", {}, fmt(rec.q)));
      tr.appendChild(el("td", {}, fmt(rec.ell)));
      tr.appendChild(el("td", {}, fmt(rec.p_value, 4)));
      tr.appendChild(el("td", {}, fmt(rec.p_adj, 4)));
      tr.appendChild(el("td", {}, rec.edge ? "yes" : "no"));
      table.appendChild(tr);
    });
    scroll.appendChild(table);
    return scroll;
  }

  function exportTools(records) {
    var tools = el("div", { class: "results-tools" });
    var btn = el("button", { class: "ghost", type: "button" }, "Export results as CSV");
    btn.addEventListener("click", function () {
      var csv = CALC.buildResultsCsv(records);
      var blob = new Blob([csv], { type: "text/csv" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "prerelation_results.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    });
    tools.appendChild(btn);
    tools.appendChild(
      el(
        "span",
        { class: "meta" },
        "\u0394 and the components A1, q, \u2113 are included in the export. " +
          "Values are estimated from your data. Bootstrap confidence " +
          "intervals are out of scope for this version."
      )
    );
    return tools;
  }

  function renderPairCard(result, names) {
    var out = $("calc-output");
    out.innerHTML = "";
    var recFwd = null;
    var recRev = null;
    result.records.forEach(function (rec) {
      if (rec.source === names[0]) recFwd = rec;
      else recRev = rec;
    });

    var xcol = calcState.data.map(function (row) {
      return row[0];
    });
    var ycol = calcState.data.map(function (row) {
      return row[1];
    });
    var r = pearsonR(xcol, ycol);

    var card = el("section", { class: "panel paircard" });
    card.appendChild(el("h3", {}, names[0] + " \u2194 " + names[1]));
    card.appendChild(
      el(
        "p",
        { class: "panel-note" },
        "n = " +
          result.meta.n +
          " \u00b7 M = " +
          result.meta.nPerm +
          " permutations per direction \u00b7 seed " +
          result.meta.seed +
          " \u00b7 Pearson r = " +
          fmt(r) +
          " \u00b7 values estimated from your data"
      )
    );

    card.appendChild(el("div", { class: "delta-label" }, "\u0394 \u2014 prerelation direction coefficient"));
    card.appendChild(el("div", { class: "delta-big" }, fmt(recFwd.delta)));
    var dirText;
    if (recFwd.delta > 0) {
      dirText =
        "Positive \u0394: " + names[0] + " is the prerequisite side of this pair; the magnitude is the strength of the asymmetry.";
    } else if (recFwd.delta < 0) {
      dirText =
        "Negative \u0394: " + names[1] + " is the prerequisite side of this pair; the magnitude is the strength of the asymmetry.";
    } else {
      dirText = "\u0394 is exactly zero: the two directions are on an equal footing.";
    }
    card.appendChild(el("p", { class: "panel-note", style: "margin-top:8px" }, dirText));
    card.appendChild(
      el(
        "p",
        { class: "panel-note" },
        "Read \u0394 together with the \u03a0 pair below: \u0394 = 0 by itself does not distinguish no relation from equivalent skills."
      )
    );

    var grid = el("div", { class: "pair-grid" });
    var left = el("div");
    [
      [recFwd, names[0] + " \u2192 " + names[1]],
      [recRev, names[1] + " \u2192 " + names[0]],
    ].forEach(function (entry) {
      var rec = entry[0];
      left.appendChild(el("h3", { style: "margin-top:14px;font-size:16px" }, entry[1]));
      var dl = el("dl", { class: "components" });
      [
        ["\u03a0", rec.pi, true],
        ["A1 corner", rec.A1, false],
        ["q interior", rec.q, false],
        ["\u2113 ceiling", rec.ell, false],
      ].forEach(function (row) {
        var wrap = el("div");
        wrap.appendChild(el("dt", {}, row[0]));
        var bar = el("div", { class: "bar" + (row[2] ? " product" : "") });
        bar.appendChild(
          el("span", { style: "width:" + Math.max(0, Math.min(1, row[1])) * 100 + "%" })
        );
        wrap.appendChild(bar);
        wrap.appendChild(el("dd", {}, fmt(row[1])));
        dl.appendChild(wrap);
      });
      left.appendChild(dl);
      var verdict = el("p", { class: "verdict" });
      verdict.appendChild(
        el("span", {}, "p " + fmt(rec.p_value, 4) + " \u00b7 adjusted p " + fmt(rec.p_adj, 4) + " \u00b7 ")
      );
      verdict.appendChild(
        el("strong", {}, rec.edge ? "retained at FDR " + result.alpha : "not retained")
      );
      left.appendChild(verdict);
    });
    grid.appendChild(left);

    var right = el("div");
    var scatterHost = el("div", { id: "calc-pair-scatter" });
    right.appendChild(scatterHost);
    right.appendChild(
      el(
        "p",
        { class: "caption" },
        "Overlays as in section 6: the shaded corner, the hatched ceiling band, the top-x rule. Drawn for " +
          names[0] +
          " \u2192 " +
          names[1] +
          "."
      )
    );
    grid.appendChild(right);
    card.appendChild(grid);

    card.appendChild(resultsTable(result.records));
    card.appendChild(exportTools(result.records));
    out.appendChild(card);

    drawScatter(
      scatterHost,
      { names: names, theta: calcState.data },
      names[0],
      names[1]
    );
  }

  function renderScanView(result, names) {
    var out = $("calc-output");
    out.innerHTML = "";
    var d = resultToDataset(result);

    var meta = el(
      "p",
      { class: "meta" },
      names.length +
        " attributes \u00b7 n = " +
        d.n +
        " \u00b7 M = " +
        d.nPerm +
        " permutations per ordered pair \u00b7 seed " +
        d.seed +
        " \u00b7 FDR \u03b1 = " +
        d.alpha +
        " (Benjamini\u2013Hochberg) \u00b7 values estimated from your data \u00b7 output read as a dominance preorder"
    );
    out.appendChild(meta);

    var panels = el("div", { class: "panels", style: "margin-top:12px" });
    var p1 = el("section", { class: "panel" });
    p1.appendChild(el("h3", {}, "\u03a0 matrix"));
    var matrixHost = el("div", { id: "calc-matrix" });
    p1.appendChild(matrixHost);
    panels.appendChild(p1);
    var p2 = el("section", { class: "panel" });
    p2.appendChild(el("h3", {}, "Dominance preorder"));
    var hasseHost = el("div", { id: "calc-hasse" });
    var hasseCap = el("p", { class: "caption" });
    p2.appendChild(hasseHost);
    p2.appendChild(hasseCap);
    panels.appendChild(p2);
    out.appendChild(panels);

    var insp = el("section", { class: "panel inspector" });
    var inspTitle = el("h3", {}, "Pair inspector");
    var inspNote = el("p", { class: "panel-note" });
    insp.appendChild(inspTitle);
    insp.appendChild(inspNote);
    var grid = el("div", { class: "inspector-grid" });
    var leftHost = el("div");
    var comps = el("dl", { class: "components" });
    var verdict = el("p", { class: "verdict" });
    leftHost.appendChild(comps);
    leftHost.appendChild(verdict);
    grid.appendChild(leftHost);
    var rightHost = el("div");
    var scatterHost = el("div", { id: "calc-scatter" });
    rightHost.appendChild(scatterHost);
    grid.appendChild(rightHost);
    insp.appendChild(grid);
    out.appendChild(insp);

    var tableWrap = el("section", { class: "panel", style: "margin-top:18px" });
    tableWrap.appendChild(el("h3", {}, "All ordered pairs"));
    tableWrap.appendChild(resultsTable(result.records));
    tableWrap.appendChild(exportTools(result.records));
    out.appendChild(tableWrap);

    var view = new ScanView({
      idPrefix: "calc",
      matrix: matrixHost,
      hasse: hasseHost,
      hasseCaption: hasseCap,
      inspectorTitle: inspTitle,
      inspectorNote: inspNote,
      components: comps,
      verdict: verdict,
      scatter: scatterHost,
    });
    view.show(d);
  }

  function renderCalcResult(result, names) {
    if (names.length === 2) renderPairCard(result, names);
    else renderScanView(result, names);
    $("calc-output").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function initCalculator() {
    var drop = $("drop");
    var input = $("file-input");

    input.addEventListener("change", function () {
      if (input.files && input.files[0]) {
        var file = input.files[0];
        var reader = new FileReader();
        reader.onload = function () {
          loadText(String(reader.result), file.name);
        };
        reader.onerror = function () {
          setBanner("error", "Could not read the file.");
        };
        reader.readAsText(file);
      }
    });

    ["dragover", "dragenter"].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        drop.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        drop.classList.remove("dragover");
      });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        var file = e.dataTransfer.files[0];
        var reader = new FileReader();
        reader.onload = function () {
          loadText(String(reader.result), file.name);
        };
        reader.readAsText(file);
      }
    });

    $("load-ecpe").addEventListener("click", function () {
      loadDemoIntoCalc("ecpe");
    });
    $("load-fs").addEventListener("click", function () {
      loadDemoIntoCalc("fs");
    });
    $("run").addEventListener("click", runScan);
    $("cancel").addEventListener("click", cancelRun);
    $("nperm").addEventListener("change", function () {
      var m = calcState.selected ? calcState.selected.length : 0;
      if (m >= 2) {
        var floor = CALC.mFloor(m);
        var v = Math.floor(Number($("nperm").value));
        if (!(v >= floor)) {
          $("nperm").value = String(floor);
          setBanner(
            "warn",
            "M raised to the design floor " +
              floor +
              ": below it, the smallest attainable p-value cannot survive the FDR control, so no pair could be retained."
          );
        } else {
          setBanner(null);
        }
      }
    });
  }

  /* ------------------------------------------------------------- boot */

  renderFourPanel();
  renderMechanismSketch();
  initDemos();
  initCalculator();
})();
