// Live-preview assembly for the automation builder (Batch C1 Pass 2).
//
// PURE + DUAL-LOADABLE: this file takes already-resolved strings/booleans
// (the "When" text, condition texts, action texts — each produced by the
// builder's existing meta-bound functions) and decides the preview STRUCTURE
// and the INCOMPLETE-STATE wording. It has NO dependency on `meta`, the DOM, or
// any browser global, so the exact same logic the UI shows can be unit-tested
// in node/tsx. It is loaded in the browser via a <script> tag (attaches
// window.FlowPreview) and required by the self-test via module.exports.
//
// It deliberately does NOT generate the wording of triggers/conditions/actions
// themselves (those stay in automations.js, shared with the wizard) — it only
// assembles the pieces, so the editor preview and wizard review can't drift.

(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.FlowPreview = api;
})(typeof window !== "undefined" ? window : null, function () {
  function clean(arr) {
    return (arr || []).filter(function (x) { return x != null && String(x).trim() !== ""; }).map(String);
  }

  // Decide the preview structure from already-resolved pieces.
  //   parts = {
  //     when:                 string  // resolved "When" text ("" if no trigger)
  //     whenIncomplete:       bool    // trigger chosen but a required param missing
  //     conditions:           string[]// COMPLETE condition lines only
  //     incompleteConditions: number  // count of half-filled conditions (not shown)
  //     actions:              string[]// action summary lines
  //   }
  function flowModel(parts) {
    parts = parts || {};
    var when = parts.when == null ? "" : String(parts.when).trim();
    var hasTrigger = when !== "";
    var conditions = clean(parts.conditions);
    var actions = clean(parts.actions);
    return {
      placeholder: !hasTrigger,                 // no trigger yet -> neutral placeholder
      whenLine: hasTrigger ? when : "",
      triggerIncomplete: !!parts.whenIncomplete, // e.g. Scheduled with no date field
      conditionLines: conditions,
      runsEveryTime: conditions.length === 0,
      incompleteConditions: Number(parts.incompleteConditions) || 0,
      actionLines: actions,
      noActions: actions.length === 0,           // nothing will happen yet
    };
  }

  // A single readable sentence (compact line + the self-test's assertion target).
  function flowSummary(parts) {
    var m = flowModel(parts);
    if (m.placeholder) return "Pick a trigger to see a preview.";
    var s = "When " + m.whenLine;
    if (!m.runsEveryTime) s += ", only if " + m.conditionLines.join(", ");
    s += m.noActions
      ? " — but there are no actions yet, so it won't do anything."
      : ", then " + m.actionLines.join(", then ") + ".";
    return s;
  }

  return { flowModel: flowModel, flowSummary: flowSummary };
});
