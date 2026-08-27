/**
 * web/worker.js — permutation work off the main thread.
 *
 * A classic worker so the page needs no build system: it loads the same
 * generated library bundle the page uses and runs `scan` on the uploaded
 * data, posting progress after every ordered pair. Cancellation is
 * handled by the page terminating the worker; nothing here needs to
 * cooperate with it.
 */
/* global importScripts, PRERELATION, postMessage, onmessage */
importScripts("prerelation.browser.js");

onmessage = function (event) {
  const msg = event.data;
  if (!msg || msg.cmd !== "scan") {
    postMessage({ type: "error", message: "unknown command" });
    return;
  }
  try {
    const result = PRERELATION.scan(msg.theta, {
      names: msg.names,
      nPerm: msg.nPerm,
      seed: msg.seed,
      alpha: msg.alpha,
      onProgress: function (done, total) {
        postMessage({ type: "progress", done: done, total: total });
      },
    });
    postMessage({
      type: "result",
      result: {
        records: result.records,
        edges: result.edges,
        reducedEdges: result.reducedEdges,
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
    });
  } catch (err) {
    postMessage({ type: "error", message: String(err && err.message ? err.message : err) });
  }
};
