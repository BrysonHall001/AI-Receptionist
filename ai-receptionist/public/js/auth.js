(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, toast } = App.util;

  function shell(inner) {
    const root = App.util.$("#app");
    root.innerHTML = "";
    const wrap = el("div", "auth-wrap fade-in");
    const card = el("div", "auth-card");
    const brand = el("div", "auth-brand");
    const logo = el("div", "auth-logo");
    logo.innerHTML = App.brandLogoSvg;
    brand.appendChild(logo);
    card.appendChild(brand);
    card.appendChild(inner);
    wrap.appendChild(card);
    root.appendChild(wrap);
  }

  function renderLogin() {
    const form = el("div", "auth-form");
    form.innerHTML = `
      <h1 class="auth-title">Sign in</h1>
      <p class="auth-sub">Welcome back. Enter your details to continue.</p>
      <label class="field-label">Email</label>
      <input id="login-email" class="input" type="email" autocomplete="username" placeholder="you@company.com" />
      <label class="field-label">Password</label>
      <input id="login-pass" class="input" type="password" autocomplete="current-password" placeholder="••••••••" />
      <button id="login-btn" class="btn btn-primary btn-block">Sign in</button>
      <div id="sso-slot"></div>
      <a class="auth-link" href="#/forgot">Forgot password?</a>`;
    shell(form);

    // PROVIDER BUTTONS RENDER ONLY WHEN CONFIGURED. With no credentials set the server
    // returns an empty list and this adds nothing at all - no divider, no gap, no reserved
    // space - so the screen is exactly what it is today. The password form stays primary.
    (async () => {
      let providers = [];
      try { const r = await App.api("/api/auth/sso/providers"); providers = (r && r.providers) || []; }
      catch (e) { return; } // sign-in must never depend on this call succeeding
      if (!providers.length) return;
      const slot = App.util.$("#sso-slot");
      if (!slot) return;
      slot.appendChild(el("div", "auth-or", "or"));
      const LABEL = { google: "Continue with Google", microsoft: "Continue with Microsoft" };
      providers.forEach(function (p) {
        const a = el("a", "btn btn-ghost btn-block auth-sso-btn");
        a.href = "/api/auth/sso/" + encodeURIComponent(p) + "/start";
        a.textContent = LABEL[p] || p;
        slot.appendChild(a);
      });
    })();

    const submit = async () => {
      const email = App.util.$("#login-email").value.trim();
      const password = App.util.$("#login-pass").value;
      const btn = App.util.$("#login-btn");
      if (!email || !password) { toast("Enter your email and password", true); return; }
      btn.disabled = true; btn.textContent = "Signing in…";
      try {
        const r = await App.api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
        // Two-factor: the password was right, but there is NO SESSION yet.
        if (r && r.mfaRequired) { location.hash = "#/mfa"; return; }
        App.state.me = r.user;
        App.afterLogin();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false; btn.textContent = "Sign in";
      }
    };
    App.util.$("#login-btn").onclick = submit;
    ["login-email", "login-pass"].forEach((id) => {
      App.util.$("#" + id).addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    });
  }

  function renderForgot() {
    const form = el("div", "auth-form");
    form.innerHTML = `
      <h1 class="auth-title">Reset password</h1>
      <p class="auth-sub">Enter your email and we'll send a reset link.</p>
      <label class="field-label">Email</label>
      <input id="forgot-email" class="input" type="email" placeholder="you@company.com" />
      <button id="forgot-btn" class="btn btn-primary btn-block">Send reset link</button>
      <a class="auth-link" href="#/login">Back to sign in</a>`;
    shell(form);
    App.util.$("#forgot-btn").onclick = async () => {
      const email = App.util.$("#forgot-email").value.trim();
      const btn = App.util.$("#forgot-btn");
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        await App.api("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) });
        toast("If that email exists, a reset link is on its way.");
        form.innerHTML = `<h1 class="auth-title">Check your email</h1>
          <p class="auth-sub">If an account exists for <strong>${esc(email)}</strong>, we've sent a reset link. In demo mode the link is printed in the server logs.</p>
          <a class="btn btn-ghost btn-block" href="#/login">Back to sign in</a>`;
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false; btn.textContent = "Send reset link";
      }
    };
  }

  function renderReset(token) {
    const form = el("div", "auth-form");
    form.innerHTML = `
      <h1 class="auth-title">Choose a new password</h1>
      <p class="auth-sub">Enter a new password for your account.</p>
      <label class="field-label">New password</label>
      <input id="reset-pass" class="input" type="password" placeholder="At least 10 characters" />
      <p class="auth-sub u-mt-6">Use at least 10 characters, mixing at least two of: lowercase, uppercase, numbers, or symbols.</p>
      <button id="reset-btn" class="btn btn-primary btn-block">Update password</button>
      <a class="auth-link" href="#/login">Back to sign in</a>`;
    shell(form);
    App.util.$("#reset-btn").onclick = async () => {
      const password = App.util.$("#reset-pass").value;
      if (!password || password.length < 10) { toast("Password must be at least 10 characters and mix at least two of: lowercase, uppercase, numbers, or symbols.", true); return; }
      const btn = App.util.$("#reset-btn");
      btn.disabled = true; btn.textContent = "Updating…";
      try {
        await App.api("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) });
        toast("Password updated — please sign in.");
        location.hash = "#/login";
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false; btn.textContent = "Update password";
      }
    };
  }

  /** THE ONE-TIME LINK CONFIRMATION. The provider proved an address that matches an
   *  existing account which has never been linked, so we ask for that account's own
   *  password once. No session exists yet at this point. */
  function renderSsoLink(provider, email) {
    const form = el("div", "auth-form");
    const nice = provider === "microsoft" ? "Microsoft" : "Google";
    form.innerHTML = `
      <h1 class="auth-title">One more step</h1>
      <p class="auth-sub">You already have an account for <strong>${App.util.esc(email)}</strong>. Enter its password once to link your ${App.util.esc(nice)} account \u2014 after this it's one click.</p>
      <label class="field-label">Email</label>
      <input class="input" type="email" value="${App.util.esc(email)}" disabled />
      <label class="field-label">Password</label>
      <input id="sso-pass" class="input" type="password" autocomplete="current-password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" />
      <button id="sso-link-btn" class="btn btn-primary btn-block">Link and sign in</button>
      <a class="auth-link" href="#/">Use my password instead</a>`;
    shell(form);
    const submit = async () => {
      const password = App.util.$("#sso-pass").value;
      const btn = App.util.$("#sso-link-btn");
      if (!password) { toast("Enter your password", true); return; }
      btn.disabled = true; btn.textContent = "Linking\u2026";
      try {
        const { user } = await App.api("/api/auth/sso/link", { method: "POST", body: JSON.stringify({ password }) });
        App.state.me = user;
        App.afterLogin();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false; btn.textContent = "Link and sign in";
      }
    };
    App.util.$("#sso-link-btn").onclick = submit;
    App.util.$("#sso-pass").onkeydown = (e) => { if (e.key === "Enter") submit(); };
  }

  /** THE SECOND FACTOR. Reached only after a correct password; no session exists yet. */
  function renderMfa() {
    const form = el("div", "auth-form");
    form.innerHTML = `
      <h1 class="auth-title">Enter your code</h1>
      <p class="auth-sub">Open your authenticator app and enter the six-digit code. You can use a recovery code instead if you don't have your phone.</p>
      <label class="field-label">Code</label>
      <input id="mfa-code" class="input" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" />
      <label class="mfa-remember"><input id="mfa-remember" type="checkbox" /> Remember this device for 30 days</label>
      <button id="mfa-btn" class="btn btn-primary btn-block">Continue</button>
      <a class="auth-link" href="#/">Back to sign in</a>`;
    shell(form);
    const submit = async () => {
      const code = App.util.$("#mfa-code").value.trim();
      const btn = App.util.$("#mfa-btn");
      if (!code) { toast("Enter the code from your app", true); return; }
      btn.disabled = true; btn.textContent = "Checking\u2026";
      try {
        const { user } = await App.api("/api/auth/login/mfa", { method: "POST", body: JSON.stringify({ code, remember: App.util.$("#mfa-remember").checked }) });
        App.state.me = user;
        App.afterLogin();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false; btn.textContent = "Continue";
      }
    };
    App.util.$("#mfa-btn").onclick = submit;
    App.util.$("#mfa-code").onkeydown = (e) => { if (e.key === "Enter") submit(); };
  }

  App.auth = { renderLogin, renderForgot, renderReset, renderSsoLink, renderMfa };
})(typeof window !== "undefined" ? window : globalThis);
