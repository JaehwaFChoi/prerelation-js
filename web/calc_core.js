/**
 * web/calc_core.js — pure logic of the upload calculator.
 *
 * Everything here is side-effect free and DOM free so that
 * test/web_calc.test.mjs can exercise it under Node. The file is a
 * classic script for the browser (attaches PRERELATION_CALC to the
 * global) and a CommonJS module for the tests.
 *
 * The statistics themselves are NOT here — they live in the library
 * (src/, bundled for the browser as prerelation.browser.js). This file
 * only prepares data for the library and shapes its results for display.
 */
(function (root, factory) {
  root.PRERELATION_CALC = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const ALPHA = 0.05; // BH-FDR level of the calculator, fixed and labeled.

  /** Pick the delimiter (comma, semicolon or tab) by counting candidates
   * on the first non-empty line. Comma wins ties. */
  function sniffDelimiter(text) {
    const line = String(text)
      .split(/\r\n|\n|\r/)
      .find((l) => l.trim() !== "");
    if (!line) return ",";
    const counts = [
      [",", (line.match(/,/g) || []).length],
      [";", (line.match(/;/g) || []).length],
      ["\t", (line.match(/\t/g) || []).length],
    ];
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ",";
  }

  function splitLine(line, delimiter) {
    return line.split(delimiter).map(function (cell) {
      let c = cell.trim();
      if (c.length >= 2 && c[0] === '"' && c[c.length - 1] === '"') {
        c = c.slice(1, -1).trim();
      }
      return c;
    });
  }

  /** A cell that carries no usable number. */
  function isMissing(cell) {
    if (cell == null) return true;
    const c = String(cell).trim();
    if (c === "" || /^(na|nan|null|none|\.)$/i.test(c)) return true;
    return !Number.isFinite(Number(c));
  }

  /** Does the first row look like a header? True when at least one cell
   * is neither empty nor a number. */
  function detectHeader(firstRow) {
    return firstRow.some(function (cell) {
      const c = String(cell).trim();
      return c !== "" && !Number.isFinite(Number(c));
    });
  }

  /**
   * Parse delimited text into { names, rows, delimiter, hadHeader }.
   * `rows` are arrays of raw cell strings (missing values preserved so
   * that listwise deletion can count them); `names` are column labels,
   * synthesized as C1, C2, ... when the file has no header.
   */
  function parseTable(text, delimiterOpt) {
    const delimiter = delimiterOpt || sniffDelimiter(text);
    const lines = String(text)
      .split(/\r\n|\n|\r/)
      .filter(function (l) {
        return l.trim() !== "";
      });
    if (lines.length === 0) {
      throw new RangeError("the file is empty");
    }
    const first = splitLine(lines[0], delimiter);
    const hadHeader = detectHeader(first);
    const names = hadHeader
      ? first.map(function (c, i) {
          return c === "" ? "C" + (i + 1) : c;
        })
      : first.map(function (_, i) {
          return "C" + (i + 1);
        });
    const body = hadHeader ? lines.slice(1) : lines;
    const width = names.length;
    const rows = body.map(function (l, idx) {
      const cells = splitLine(l, delimiter);
      if (cells.length !== width) {
        throw new RangeError(
          "row " +
            (idx + 1 + (hadHeader ? 1 : 0)) +
            " has " +
            cells.length +
            " cells; expected " +
            width
        );
      }
      return cells;
    });
    if (rows.length === 0) {
      throw new RangeError("the file has a header but no data rows");
    }
    return { names: names, rows: rows, delimiter: delimiter, hadHeader: hadHeader };
  }

  /**
   * Keep the selected columns, dropping every row with a missing value in
   * any of them (listwise deletion). Returns
   * { data: number[][], kept, dropped } with data column-ordered as
   * `selected`.
   */
  function listwiseSelect(rows, selected) {
    if (!Array.isArray(selected) || selected.length < 2) {
      throw new RangeError("select at least two columns");
    }
    const data = [];
    let dropped = 0;
    for (let i = 0; i < rows.length; i++) {
      const out = new Array(selected.length);
      let ok = true;
      for (let j = 0; j < selected.length; j++) {
        const cell = rows[i][selected[j]];
        if (isMissing(cell)) {
          ok = false;
          break;
        }
        out[j] = Number(String(cell).trim());
      }
      if (ok) data.push(out);
      else dropped += 1;
    }
    return { data: data, kept: data.length, dropped: dropped };
  }

  /**
   * The anchored-scale gate. Values must already live on [0, 1]; the
   * calculator refuses to rescale, because a silent min-max rescaling
   * would fabricate the anchors that give the coefficient its reading.
   * Returns { ok, violations, checked } with at most `maxReport`
   * violations listed as { row, col, value } (row is 1-based within the
   * retained data).
   */
  function rangeGate(data, maxReport) {
    const limit = maxReport == null ? 5 : maxReport;
    const violations = [];
    let checked = 0;
    for (let i = 0; i < data.length; i++) {
      for (let j = 0; j < data[i].length; j++) {
        checked += 1;
        const v = data[i][j];
        if (!(v >= 0 && v <= 1)) {
          if (violations.length < limit) {
            violations.push({ row: i + 1, col: j, value: v });
          } else {
            return { ok: false, violations: violations, checked: checked, truncated: true };
          }
        }
      }
    }
    return {
      ok: violations.length === 0,
      violations: violations,
      checked: checked,
      truncated: false,
    };
  }

  /**
   * Design floor on permutation replicates: with m selected columns there
   * are K = m (m - 1) ordered pairs and the smallest attainable
   * permutation p-value is 1 / (nPerm + 1), so surviving BH-FDR control
   * at level alpha requires nPerm >= K / alpha - 1. At alpha = 0.05 the
   * floor is 20 K - 1 exactly.
   */
  function mFloor(nColumns, alpha) {
    const a = alpha == null ? ALPHA : alpha;
    const K = nColumns * (nColumns - 1);
    return Math.ceil(K / a - 1);
  }

  function defaultNPerm(nColumns) {
    return Math.max(999, mFloor(nColumns, ALPHA));
  }

  /** Shape (and validate) the message the page posts to the worker. */
  function makeScanRequest(data, names, nPerm, seed) {
    if (!Array.isArray(data) || data.length === 0) {
      throw new RangeError("no data rows to scan");
    }
    const k = data[0].length;
    if (k < 2) throw new RangeError("need at least two columns");
    for (let i = 0; i < data.length; i++) {
      if (data[i].length !== k) {
        throw new RangeError("rows must all have the same number of columns");
      }
    }
    if (!Array.isArray(names) || names.length !== k) {
      throw new RangeError("names must have one entry per selected column");
    }
    if (!Number.isInteger(nPerm) || nPerm < mFloor(k, ALPHA)) {
      throw new RangeError(
        "nPerm must be an integer of at least the design floor " +
          mFloor(k, ALPHA) +
          " for " +
          k +
          " columns"
      );
    }
    if (!Number.isInteger(seed)) throw new RangeError("seed must be an integer");
    return {
      cmd: "scan",
      theta: data,
      names: names,
      nPerm: nPerm,
      seed: seed,
      alpha: ALPHA,
    };
  }

  /** Results table -> CSV text (delta and components included). */
  function buildResultsCsv(records) {
    const cols = [
      "source",
      "target",
      "pi",
      "pi_reverse",
      "delta",
      "A1",
      "A2",
      "q",
      "ell",
      "p_value",
      "p_adj",
      "edge",
      "n",
      "n_perm",
    ];
    const quote = function (v) {
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(",")];
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      lines.push(
        cols
          .map(function (c) {
            return quote(rec[c] == null ? "" : rec[c]);
          })
          .join(",")
      );
    }
    return lines.join("\n") + "\n";
  }

  return {
    ALPHA: ALPHA,
    sniffDelimiter: sniffDelimiter,
    detectHeader: detectHeader,
    isMissing: isMissing,
    parseTable: parseTable,
    listwiseSelect: listwiseSelect,
    rangeGate: rangeGate,
    mFloor: mFloor,
    defaultNPerm: defaultNPerm,
    makeScanRequest: makeScanRequest,
    buildResultsCsv: buildResultsCsv,
  };
});
