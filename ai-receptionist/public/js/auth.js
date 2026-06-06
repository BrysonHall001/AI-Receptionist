(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, toast } = App.util;

  function shell(inner) {
    const root = App.util.$("#app");
    root.innerHTML = "";
    const wrap = el("div", "auth-wrap fade-in");
    const card = el("div", "auth-card");
    const brand = el("div", "auth-brand");
    brand.appendChild(el("div", "brand-mark", "R"));
    brand.appendChild(el("div", "brand-name", App.BRAND || "CRM"));
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
      <a class="auth-link" href="#/forgot">Forgot password?</a>`;
    shell(form);

    const submit = async () => {
      const email = App.util.$("#login-email").value.trim();
      const password = App.util.$("#login-pass").value;
      const btn = App.util.$("#login-btn");
      if (!email || !password) { toast("Enter your email and password", true); return; }
      btn.disabled = true; btn.textContent = "Signing in…";
      try {
        const { user } = await App.api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
        App.state.me = user;
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
      <input id="reset-pass" class="input" type="password" placeholder="At least 8 characters" />
      <button id="reset-btn" class="btn btn-primary btn-block">Update password</button>
      <a class="auth-link" href="#/login">Back to sign in</a>`;
    shell(form);
    App.util.$("#reset-btn").onclick = async () => {
      const password = App.util.$("#reset-pass").value;
      if (!password || password.length < 8) { toast("Password must be at least 8 characters", true); return; }
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

  App.auth = { renderLogin, renderForgot, renderReset };
})(typeof window !== "undefined" ? window : globalThis);
