/**
 * HELP TIPS.
 *
 * A small "?" beside a control that, when opened, says in a sentence or two what the thing
 * actually is - and optionally links to the longer version in the Learning Center.
 *
 * WHAT MAKES THIS WORK IS RESTRAINT. A "?" beside everything is noise people learn to ignore
 * inside a day, and it makes a product look unsure of itself. Every tip below had to pass one
 * test: would a competent person, new to this product, plausibly stop and wonder what this is
 * or what happens if they touch it? If the LABEL already answers that, there is no tip - and
 * six candidates were rejected on exactly that ground, because the screen already said it
 * better than a tip would.
 *
 * THREE RULES FOR ANYONE ADDING ONE LATER:
 *   1. Never on every field. If the list grows past twenty, the answer is a clearer label.
 *   2. Never as a substitute for fixing confusing wording. Rewrite the label instead.
 *   3. NEVER carry anything someone NEEDS to finish a task. A tip is only found by going
 *      looking for it, so anything essential belongs in visible copy.
 */
(function (global) {
  "use strict";
  var App = (global.App = global.App || {});

  /**
   * THE REGISTRY - every tip in the product, in one place, so the whole voice can be read in
   * one sitting. id -> { title, body, learn }.
   *
   * body: at most two sentences, plain, and it must tell someone something they could not
   *       have worked out from looking at the screen. No jargon, no class names, no
   *       restating the label.
   * learn: OPTIONAL Learning Center guide id. Resolved against the tenant's OWN filtered
   *       tree at open time - if that tenant cannot see the guide, the tip still shows and
   *       simply carries no link. Never a dead one.
   */
  var TIPS = {
    // --- tenant setup -------------------------------------------------------
    modules_vs_permissions: {
      title: "Switched off, or not permitted?",
      body: "Switching a module off here removes it for the whole tenant, including its own admin. Withholding it in a role only hides it from the people with that role, and everyone else still sees it.",
      learn: "modules-fields",
    },
    ai_scheduling_target: {
      title: "What the receptionist books",
      body: "When someone asks for an appointment, this is the module the receptionist creates it in. If that module is later switched off for the tenant, the receptionist stops offering to book anything rather than booking into somewhere invisible.",
      learn: "receptionist-setup",
    },
    template_prefill: {
      title: "A starting point, not a rule",
      body: "Choosing a template ticks the boxes below for you, and you can change any of them before you finish. Whatever is ticked at the moment you press Create is what the tenant gets.",
    },
    billing_trial: {
      title: "What trial means here",
      body: "Trial is a label on the tenant, not a countdown - nothing switches off on its own and no charge is raised automatically. It is there so you can tell real customers from ones you are still setting up.",
    },

    // --- modules and fields -------------------------------------------------
    stages_vs_statuses: {
      title: "Stages and statuses are different things",
      body: "Stages are the columns a record moves along on its board, like a pipeline from enquiry to done. Statuses are a separate label on the record itself, so something can sit in one stage and carry any status.",
      learn: "modules-fields",
    },
    field_key_rename: {
      title: "Renaming a field is safe",
      body: "A field keeps its original internal name for ever, even after you rename it. That is why renaming never breaks a report, an import or an automation that was already using it.",
      learn: "modules-fields",
    },

    // --- people and access --------------------------------------------------
    custom_role: {
      title: "A custom role replaces the built-in one",
      body: "Giving someone a custom role does not add to their existing permissions - it replaces them entirely with what that role allows. Removing the custom role puts them back to an ordinary Client User.",
      learn: "invite-team",
    },
    impersonation: {
      title: "Viewing as someone else is recorded",
      body: "Everything you do while viewing a tenant as one of its users is written to the audit log under your own name, not theirs. The tenant can see that entry.",
    },

    // --- security -----------------------------------------------------------
    recovery_codes: {
      title: "Each code works once",
      body: "A recovery code is used up the moment it gets you in, and it cannot be used again. Keep them somewhere you can reach without your phone, because that is the situation they exist for.",
    },
    trusted_devices: {
      title: "How long a device stays trusted",
      body: "Trusting a device stops it asking for a code for thirty days, on that browser only. Changing your password or turning two-step off clears every trusted device immediately.",
    },

    // --- developer tools ----------------------------------------------------
    demo_wipe: {
      title: "What wiping removes",
      body: "Wiping removes only the obviously-fake records that were seeded, and leaves anything the tenant created itself alone. It can only touch tenants marked as demo tenants in the first place.",
    },
  };

  /** Every tip id, for the suite and for anyone auditing the voice. */
  function tipIds() { return Object.keys(TIPS); }

  /**
   * Is this Learning Center guide reachable BY THIS TENANT right now? Sections are filtered
   * per tenant, so a guide that exists in the code may still be invisible here - in which
   * case the tip carries no link rather than a dead one.
   */
  function guideIsVisible(id) {
    try {
      if (!id) return false;
      // THE LINK MUST BE REACHABLE FROM WHERE THE TIP IS SHOWN.
      //
      // #/learn is a TENANT route. On the hub the router sends an admin with no tenant
      // selected to #/admin/portals instead, so a Learning Center link shown on a hub screen
      // - the template builder, the tenant modules list - silently went to the wrong place.
      // It looked like a dead link because, from where it was clicked, it was one.
      //
      // A tip with no reachable destination carries NO LINK, which is the rule everywhere
      // else here too: no link is honest, a link that goes somewhere else is not.
      if (!App.state || !App.state.currentPortalId) return false;
      if (!App.learn || typeof App.learn.activeGuides !== "function") return false;
      var tree = App.learn.activeGuides() || [];
      for (var i = 0; i < tree.length; i++) {
        var items = tree[i].items || [];
        for (var j = 0; j < items.length; j++) if (items[j] && items[j].id === id) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function closeAll() {
    var open = global.document.querySelectorAll(".tip-panel");
    Array.prototype.forEach.call(open, function (p) { p.remove(); });
    var marks = global.document.querySelectorAll(".tip-mark[aria-expanded='true']");
    Array.prototype.forEach.call(marks, function (m) { m.setAttribute("aria-expanded", "false"); });
  }

  /**
   * Build a "?" marker for a registry id. Returns null for an unknown id so a caller can fail
   * loudly rather than render a marker that explains nothing.
   *
   * IT IS A REAL BUTTON. Tab reaches it, Enter and Space open it, Escape closes it, and it
   * works on touch where there is no hover at all. A hover-only tip is invisible to a large
   * number of people, which is the failure this component exists to avoid.
   */
  function tip(id) {
    var t = TIPS[id];
    if (!t) return null;
    var doc = global.document;
    var btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "tip-mark";
    btn.textContent = "?";
    btn.setAttribute("aria-label", "What is this? " + t.title);
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("title", t.title);

    function open() {
      var already = btn.getAttribute("aria-expanded") === "true";
      closeAll();
      if (already) return;
      var panel = doc.createElement("div");
      panel.className = "tip-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", t.title);
      var h = doc.createElement("div"); h.className = "tip-title"; h.textContent = t.title;
      var p = doc.createElement("p"); p.className = "tip-body"; p.textContent = t.body;
      panel.appendChild(h); panel.appendChild(p);
      // The link is OPTIONAL and is resolved now, against this tenant's own tree.
      if (t.learn && guideIsVisible(t.learn)) {
        var a = doc.createElement("a");
        a.className = "tip-link";
        a.href = "#/learn?guide=" + encodeURIComponent(t.learn);
        a.textContent = "Read more in the Learning Center";
        panel.appendChild(a);
      }
      // ABSOLUTE, inside the marker's own wrapper: opening shifts nothing on the page.
      btn.parentNode.appendChild(panel);
      btn.setAttribute("aria-expanded", "true");
      // Near the right edge, flip so the panel never runs off screen - and never sits over
      // the control it is explaining, which is always to the LEFT of the marker.
      try {
        var box = panel.getBoundingClientRect();
        if (box.right > (global.innerWidth || 1200) - 8) panel.classList.add("tip-panel--flip");
      } catch (e) { /* no layout in a test DOM; the default side is correct */ }
      var first = panel.querySelector("a") || panel;
      if (first && first.focus) { try { first.focus(); } catch (e) { /* */ } }
    }

    btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); open(); });
    btn.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); open(); }
      if (e.key === "Escape") { closeAll(); btn.focus(); }
    });

    var wrap = doc.createElement("span");
    wrap.className = "tip-wrap";
    wrap.appendChild(btn);
    return wrap;
  }

  /** Append a tip to a host, if the id is real. Returns whether it was added. */
  function attach(host, id) {
    var node = tip(id);
    if (!host || !node) return false;
    host.appendChild(node);
    return true;
  }

  try {
    global.document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".tip-wrap")) return;
      closeAll();
    });
    global.document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(); });
  } catch (e) { /* no document in a bare test context */ }

  App.tips = { TIPS: TIPS, tip: tip, attach: attach, tipIds: tipIds, guideIsVisible: guideIsVisible, closeAll: closeAll };
})(typeof window !== "undefined" ? window : globalThis);
