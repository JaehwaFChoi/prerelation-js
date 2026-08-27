/**
 * prerelation-js demo — rendering only.
 *
 * Every quantity displayed here was computed by this package's own library
 * at build time (see tools/precompute_demo.mjs); this file draws the
 * payload and adds no statistics of its own. Written as a classic script
 * with no imports and no network access, so the page opens straight from
 * the file system.
 */
(function () {
  "use strict";

  var DELTA = 0.05;
  var TOP_Q = 0.8;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var DATA = window.PRERELATION_DEMO;
  var state = { key: null, source: null, target: null };

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
    return Number(value).toFixed(digits == null ? 3 : digits);
  }

  function dataset() {
    return DATA.datasets[state.key];
  }

  function recordFor(source, target) {
    var recs = dataset().records;
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].source === source && recs[i].target === target) return recs[i];
    }
    return null;
  }

  /* ---------------------------------------------------------------- switch */

  function renderSwitch() {
    var host = document.getElementById("dataset-switch");
    host.innerHTML = "";
    Object.keys(DATA.datasets).forEach(function (key) {
      var button = el("button", {
        type: "button",
        "aria-pressed": key === state.key ? "true" : "false",
      }, DATA.datasets[key].label);
      button.addEventListener("click", function () {
        selectDataset(key);
      });
      host.appendChild(button);
    });
  }

  function renderMeta() {
    var d = dataset();
    var parts = [
      d.blurb,
      d.names.length + " attributes",
      "n = " + d.n,
      d.nPerm + " permutations per pair (design floor " + d.permFloor + ")",
      "FDR " + d.alpha,
      "seed " + d.seed,
    ];
    document.getElementById("dataset-meta").textContent = parts.join(" \u00b7 ");
  }

  /* ---------------------------------------------------------------- matrix */

  function tealFill(pi) {
    // Interpolate plate -> teal on a mild power scale so small values stay
    // legible against the paper.
    var t = Math.pow(Math.max(0, Math.min(1, pi)), 0.65);
    var from = [247, 248, 245];
    var to = [22, 86, 79];
    var rgb = from.map(function (c, i) {
      return Math.round(c + (to[i] - c) * t);
    });
    return "rgb(" + rgb.join(",") + ")";
  }

  function renderMatrix() {
    var d = dataset();
    var host = document.getElementById("matrix");
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
        var rec = recordFor(source, target);
        var button = el("button", {
          type: "button",
          class:
            "cell" +
            (rec.edge ? " edge" : "") +
            (source === state.source && target === state.target ? " selected" : ""),
          style: "background:" + tealFill(rec.pi) + ";color:" +
            (rec.pi > 0.45 ? "#f7f8f5" : "#1a2420"),
          title: source + " \u2192 " + target + ": Pi = " + fmt(rec.pi),
        }, fmt(rec.pi, 2));
        button.addEventListener("click", function () {
          selectPair(source, target);
        });
        td.appendChild(button);
        row.appendChild(td);
      });
      table.appendChild(row);
    });

    host.appendChild(table);
  }

  /* ----------------------------------------------------------------- Hasse */

  function layerClasses(d) {
    var level = d.classes.map(function () {
      return 0;
    });
    // Longest-path layering over the acyclic quotient order.
    for (var pass = 0; pass < d.classes.length; pass++) {
      d.hasseEdges.forEach(function (e) {
        if (level[e[1]] < level[e[0]] + 1) level[e[1]] = level[e[0]] + 1;
      });
    }
    return level;
  }

  function renderHasse() {
    var d = dataset();
    var host = document.getElementById("hasse");
    host.innerHTML = "";

    var level = layerClasses(d);
    var maxLevel = Math.max.apply(null, level);
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

    var marker = svgEl("marker", {
      id: "arrow",
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
          "marker-end": "url(#arrow)",
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
      d.edges.length +
      " of " +
      d.records.length +
      " ordered pairs retained. ";
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
    document.getElementById("hasse-caption").textContent = caption;
  }

  /* ------------------------------------------------------------- inspector */

  function renderInspector() {
    var d = dataset();
    var rec = recordFor(state.source, state.target);
    document.getElementById("inspector-title").textContent =
      "Pair inspector \u2014 " + rec.source + " \u2192 " + rec.target;
    document.getElementById("inspector-note").textContent =
      "Does " + rec.source + " act as a ceiling on " + rec.target + "?";

    var rows = [
      ["A1 corner", rec.A1, false],
      ["q interior", rec.q, false],
      ["ell ceiling", rec.ell, false],
      ["A2 = q \u00b7 ell", rec.A2, false],
      ["Pi = A1 \u00b7 A2", rec.pi, true],
      ["Pi reverse", rec.pi_reverse, false],
    ];
    var host = document.getElementById("components");
    host.innerHTML = "";
    rows.forEach(function (row) {
      var wrap = el("div");
      wrap.appendChild(el("dt", {}, row[0]));
      var bar = el("div", { class: "bar" + (row[2] ? " product" : "") });
      bar.appendChild(
        el("span", { style: "width:" + Math.max(0, Math.min(1, row[1])) * 100 + "%" })
      );
      wrap.appendChild(bar);
      wrap.appendChild(el("dd", {}, fmt(row[1])));
      host.appendChild(wrap);
    });

    var verdict = document.getElementById("verdict");
    verdict.innerHTML = "";
    verdict.appendChild(
      el("span", {}, "Delta " + fmt(rec.delta) + " \u00b7 p " + fmt(rec.p_value, 4) +
        " \u00b7 adjusted p " + fmt(rec.p_adj, 4) + " \u00b7 ")
    );
    verdict.appendChild(
      el("strong", {}, rec.edge ? "retained at FDR " + d.alpha : "not retained")
    );

    renderScatter(rec);
  }

  function renderScatter(rec) {
    var d = dataset();
    var xi = d.names.indexOf(rec.source);
    var yi = d.names.indexOf(rec.target);
    var host = document.getElementById("scatter");
    host.innerHTML = "";

    var size = 360;
    var pad = 34;
    var plot = size - pad - 14;
    var svg = svgEl("svg", {
      viewBox: "0 0 " + size + " " + size,
      role: "img",
      "aria-label":
        "Scatter of " + rec.source + " against " + rec.target +
        " with the corner region and the ceiling band",
    });

    var sx = function (v) {
      return pad + v * plot;
    };
    var sy = function (v) {
      return size - 14 - v * plot;
    };

    // Corner {Y > X}: the region the coefficient asks to be empty.
    svg.appendChild(
      svgEl("polygon", {
        points: [
          sx(0) + "," + sy(0),
          sx(1) + "," + sy(1),
          sx(0) + "," + sy(1),
        ].join(" "),
        fill: "#96731c",
        "opacity": "0.10",
      })
    );

    // Ceiling band: y / x >= 1 - delta, i.e. between y = (1-delta) x and y = x.
    var hatch = svgEl("pattern", {
      id: "hatch",
      width: "6",
      height: "6",
      patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)",
    });
    hatch.appendChild(
      svgEl("line", {
        x1: "0", y1: "0", x2: "0", y2: "6",
        stroke: "#4c8a83", "stroke-width": "1.4", opacity: "0.55",
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
          sx(1) + "," + sy(1 - DELTA),
        ].join(" "),
        fill: "url(#hatch)",
      })
    );

    // Frame and diagonal.
    svg.appendChild(
      svgEl("rect", {
        x: sx(0), y: sy(1), width: plot, height: plot,
        fill: "none", stroke: "#c7ccc2", "stroke-width": "1",
      })
    );
    svg.appendChild(
      svgEl("line", {
        x1: sx(0), y1: sy(0), x2: sx(1), y2: sy(1),
        stroke: "#55605a", "stroke-width": "1", "stroke-dasharray": "4 3",
      })
    );

    // Top-x stratum rule.
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
        x1: sx(thr), y1: sy(0), x2: sx(thr), y2: sy(1),
        stroke: "#96731c", "stroke-width": "1", "stroke-dasharray": "2 4",
      })
    );
    var thrLabel = svgEl("text", {
      x: sx(thr) + 4, y: sy(1) + 12,
      "font-family": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      "font-size": "10", fill: "#96731c",
    });
    thrLabel.textContent = "top-x";
    svg.appendChild(thrLabel);

    // Points: a deterministic stride sample keeps large panels readable.
    var maxPoints = 1400;
    var stride = Math.max(1, Math.ceil(d.theta.length / maxPoints));
    var shown = 0;
    for (var i = 0; i < d.theta.length; i += stride) {
      var px = d.theta[i][xi];
      var py = d.theta[i][yi];
      svg.appendChild(
        svgEl("circle", {
          cx: sx(px), cy: sy(py), r: "1.7",
          fill: "#16564f", opacity: "0.32",
        })
      );
      shown += 1;
    }

    [[rec.source, "x"], [rec.target, "y"]].forEach(function (pair, idx) {
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
          "Showing every " + stride + "th person (" + shown + " of " + d.theta.length +
            " points); all statistics use the full sample."
        )
      );
    }
  }

  /* ----------------------------------------------------------------- state */

  function selectPair(source, target) {
    state.source = source;
    state.target = target;
    renderMatrix();
    renderInspector();
  }

  function selectDataset(key) {
    state.key = key;
    var d = dataset();
    // Open on the strongest retained pair, or the strongest pair overall.
    var best = null;
    d.records.forEach(function (rec) {
      if (!best) best = rec;
      var betterEdge = rec.edge && !best.edge;
      var strongerSame = rec.edge === best.edge && rec.pi > best.pi;
      if (betterEdge || strongerSame) best = rec;
    });
    state.source = best.source;
    state.target = best.target;
    renderSwitch();
    renderMeta();
    renderMatrix();
    renderHasse();
    renderInspector();
  }

  selectDataset(Object.keys(DATA.datasets)[0]);
})();
