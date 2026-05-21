const API_BASE = "https://api.dxgames.eu";
const RETURN_TO = "https://admin.dxgames.eu/";
const PLATFORMS = ["iOS", "Android", "Steam"];
const LOCAL_MOCK = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? new URLSearchParams(window.location.search).get("mock")
  : null;

const app = document.querySelector("#app");

const state = {
  user: null,
  activeTab: "versions",
  versions: null,
  scheduled: null,
  analytics: null,
  analyticsVersion: "",
  analyticsLoading: false,
  analyticsError: "",
  versionsLoading: false,
  versionsError: "",
  saveStatus: "idle",
  saveMessage: ""
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatKey(key) {
  return String(key)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }) + " UTC";
}

function formatDuration(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(2)} s`;
}

async function apiFetch(path, init = {}) {
  if (LOCAL_MOCK) {
    return mockApiFetch(path, init);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error ?? payload?.reason ?? `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function mockApiFetch(path, init = {}) {
  await new Promise((resolve) => window.setTimeout(resolve, 80));
  if (LOCAL_MOCK === "error" && path !== "/stx/admin/auth/me") {
    const error = new Error("Mock API failure");
    error.status = 500;
    throw error;
  }
  if (path === "/stx/admin/auth/me") {
    if (LOCAL_MOCK === "signed-out") {
      const error = new Error("unauthorized");
      error.status = 401;
      throw error;
    }
    return {
      user: {
        email: "admin@example.com",
        name: "Admin User",
        picture: null,
        expires_at: new Date(Date.now() + 3600_000).toISOString()
      }
    };
  }
  if (path.startsWith("/stx/today")) {
    return {
      date: "2026-05-21",
      versions: {
        iOS: { live_version: "1.2.3", minimum_supported_version: "1.2.0" },
        Android: { live_version: "1.2.4", minimum_supported_version: "1.2.0" },
        Steam: { live_version: "1.3.0", minimum_supported_version: "1.2.1" }
      },
      entries: [],
      player_status: null,
      from: 0,
      count: 1
    };
  }
  if (path === "/stx/admin/scheduled-versions") {
    return {
      date: "2026-05-22",
      scheduled: true,
      minimum_versions: {
        iOS: { minimum_supported_version: "1.2.1" },
        Android: { minimum_supported_version: "1.2.1" },
        Steam: { minimum_supported_version: "1.2.2" }
      },
      updated_at: "2026-05-21T15:00:00.000Z"
    };
  }
  if (path === "/stx/admin/app-config" && init.method === "PATCH") {
    const body = JSON.parse(init.body);
    return {
      next_daily_date: "2026-05-22",
      scheduled_minimum: Object.fromEntries(
        PLATFORMS.map((platform) => [
          platform,
          { minimum_supported_version: body.platforms[platform].minimum_supported_version }
        ])
      ),
      minimum_updated_at: new Date().toISOString(),
      live_versions: Object.fromEntries(
        PLATFORMS.map((platform) => [platform, { live_version: body.platforms[platform].live_version }])
      ),
      live_updated_at: new Date().toISOString()
    };
  }
  if (path.startsWith("/stx/admin/analytics/summary")) {
    return {
      count: 42,
      average_time: 118.42,
      outcomes: [
        { key: "survived", label: "Survived", count: 14 },
        { key: "death_act_1", label: "Died · Deadlands", count: 9 },
        { key: "death_act_2", label: "Died · The Edge", count: 11 },
        { key: "death_act_3", label: "Died · Mausoleum", count: 8 }
      ],
      popular_weapons: [
        { id: 20, label: "Sparkling Spell", count: 18 },
        { id: 4, label: "Fire Censer", count: 12 },
        { id: 10, label: "Lightning Rod", count: 8 }
      ],
      popular_info_items: [
        { id: 37, label: "Necronomicon", count: 20 },
        { id: 38, label: "Pendulum", count: 13 },
        { id: 39, label: "Compass", count: 7 }
      ],
      app_versions: ["1.3.0", "1.2.4", "1.2.3"]
    };
  }
  return { ok: true };
}

function signIn() {
  window.location.href = `${API_BASE}/stx/admin/auth/google/start?return_to=${encodeURIComponent(RETURN_TO)}`;
}

async function signOut() {
  try {
    await apiFetch("/stx/admin/auth/logout", { method: "POST" });
  } finally {
    state.user = null;
    renderLogin();
  }
}

function renderLogin(message = "") {
  app.innerHTML = `
    <section class="login-panel">
      <p class="eyebrow">Axaxaxas Admin</p>
      <h1>Sign in to continue</h1>
      <p class="muted">Google admin access is required before versions or analytics are shown.</p>
      ${message ? `<p class="state state--error">${escapeHtml(message)}</p>` : ""}
      <button class="button" type="button" data-action="signin">Sign in with Google</button>
    </section>
  `;
}

function renderShell() {
  const identity = state.user?.name || state.user?.email || "Admin";
  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">Axaxaxas</p>
        <h1>Admin Panel</h1>
        <p class="muted">Manage platform versions and monitor run analytics.</p>
      </div>
      <div class="user-box">
        <div>
          <strong>${escapeHtml(identity)}</strong>
          <span class="muted">${escapeHtml(state.user?.email ?? "")}</span>
        </div>
        <button class="button button--secondary" type="button" data-action="signout">Sign out</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Admin sections">
      <button class="tab ${state.activeTab === "versions" ? "is-active" : ""}" type="button" data-tab="versions">Versions</button>
      <button class="tab ${state.activeTab === "analytics" ? "is-active" : ""}" type="button" data-tab="analytics">Analytics</button>
    </nav>
    <main class="panel">
      ${state.activeTab === "versions" ? renderVersionsPanel() : renderAnalyticsPanel()}
    </main>
  `;
}

function renderVersionsPanel() {
  if (state.versionsLoading) {
    return `<p class="state">Loading versions...</p>`;
  }
  if (state.versionsError) {
    return `
      <div class="panel-header">
        <div>
          <p class="eyebrow">Versions</p>
          <h2 class="panel-title">Platform versions</h2>
        </div>
        <button class="button button--ghost" type="button" data-action="reload-versions">Retry</button>
      </div>
      <p class="state state--error">${escapeHtml(state.versionsError)}</p>
    `;
  }
  if (!state.versions) {
    return `<p class="state">No version data loaded.</p>`;
  }

  const scheduledMessage = state.scheduled?.scheduled
    ? `Minimum supported versions are scheduled for ${escapeHtml(state.scheduled.date)}. Last update: ${escapeHtml(formatDate(state.scheduled.updated_at))}.`
    : "No next-day minimum version schedule is currently stored; saving will create one.";

  return `
    <form data-form="versions">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Versions</p>
          <h2 class="panel-title">Platform versions</h2>
          <p class="muted">Live changes apply immediately. Minimum supported versions are scheduled for the next UTC daily.</p>
        </div>
        <button class="button button--ghost" type="button" data-action="reload-versions">Refresh</button>
      </div>
      <p class="callout">${scheduledMessage}</p>
      <div class="versions-grid">
        ${PLATFORMS.map((platform) => {
          const current = state.versions[platform] ?? { live_version: "", minimum_supported_version: "" };
          return `
            <fieldset class="version-card">
              <h3>${platform}</h3>
              <label class="field">
                <span>Live version</span>
                <input class="input" name="${platform}.live_version" value="${escapeHtml(current.live_version)}" required pattern="\\d+\\.\\d+\\.\\d+" inputmode="numeric">
              </label>
              <label class="field">
                <span>Minimum supported</span>
                <input class="input" name="${platform}.minimum_supported_version" value="${escapeHtml(current.minimum_supported_version)}" required pattern="\\d+\\.\\d+\\.\\d+" inputmode="numeric">
              </label>
            </fieldset>
          `;
        }).join("")}
      </div>
      <div class="actions">
        <button class="button" type="submit" ${state.saveStatus === "saving" ? "disabled" : ""}>
          ${state.saveStatus === "saving" ? "Saving..." : "Submit version changes"}
        </button>
        ${state.saveMessage ? `<p class="message message--${state.saveStatus === "error" ? "error" : "success"}">${escapeHtml(state.saveMessage)}</p>` : ""}
      </div>
    </form>
  `;
}

function renderAnalyticsPanel() {
  if (state.analyticsLoading) {
    return `<p class="state">Loading analytics...</p>`;
  }
  if (state.analyticsError) {
    return `
      <div class="panel-header">
        <div>
          <p class="eyebrow">Analytics</p>
          <h2 class="panel-title">Run analytics</h2>
        </div>
        <button class="button button--ghost" type="button" data-action="reload-analytics">Retry</button>
      </div>
      <p class="state state--error">${escapeHtml(state.analyticsError)}</p>
    `;
  }
  if (!state.analytics) {
    return `<p class="state">No analytics loaded.</p>`;
  }

  const summary = state.analytics;
  const appVersions = Array.isArray(summary.app_versions) ? summary.app_versions : [];
  const knownKeys = new Set(["count", "average_time", "outcomes", "popular_weapons", "popular_info_items", "app_versions"]);
  const extraEntries = Object.entries(summary).filter(([key]) => !knownKeys.has(key));

  return `
    <div class="analytics-toolbar">
      <div>
        <p class="eyebrow">Analytics</p>
        <h2 class="panel-title">Run analytics</h2>
        <p class="muted">Summary from <code>/stx/admin/analytics/summary</code>.</p>
      </div>
      <label class="field">
        <span>App version</span>
        <select class="select" data-field="analytics-version">
          <option value="">All versions</option>
          ${appVersions.map((version) => `
            <option value="${escapeHtml(version)}" ${version === state.analyticsVersion ? "selected" : ""}>${escapeHtml(version)}</option>
          `).join("")}
        </select>
      </label>
    </div>
    <div class="stat-grid">
      <div class="stat"><span>Runs</span><strong>${escapeHtml(summary.count ?? 0)}</strong></div>
      <div class="stat"><span>Average run time</span><strong>${escapeHtml(formatDuration(summary.average_time))}</strong></div>
      <div class="stat"><span>Versions</span><strong>${appVersions.length}</strong></div>
    </div>
    ${renderBarSection("Outcome breakdown", summary.outcomes)}
    ${renderBarSection("Popular weapons", summary.popular_weapons)}
    ${renderBarSection("Popular info items", summary.popular_info_items)}
    ${extraEntries.length ? renderJsonSection("Additional summary fields", extraEntries) : ""}
  `;
}

function renderBarSection(title, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `
      <section class="analytics-section">
        <h3>${escapeHtml(title)}</h3>
        <p class="state">No data.</p>
      </section>
    `;
  }

  const max = Math.max(...rows.map((row) => Number(row.count) || 0), 1);
  return `
    <section class="analytics-section">
      <h3>${escapeHtml(title)}</h3>
      ${rows.map((row) => {
        const label = row.label ?? row.key ?? row.id ?? "Unknown";
        const count = Number(row.count) || 0;
        return `
          <div class="bar-row">
            <span class="bar-label">${escapeHtml(label)}</span>
            <span class="bar-count">${count}</span>
            <span class="bar-track"><span class="bar-fill" style="width: ${(count / max) * 100}%"></span></span>
          </div>
        `;
      }).join("")}
    </section>
  `;
}

function renderJsonSection(title, entries) {
  return `
    <section class="analytics-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="json-grid">
        ${entries.map(([key, value]) => `
          <div class="json-row">
            <span class="json-key">${escapeHtml(formatKey(key))}</span>
            <pre class="json-value">${escapeHtml(JSON.stringify(value, null, 2))}</pre>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

async function checkSession() {
  try {
    const payload = await apiFetch("/stx/admin/auth/me");
    state.user = payload.user;
    renderShell();
    await loadVersions();
  } catch (error) {
    state.user = null;
    if (error.status === 401) {
      renderLogin();
      return;
    }
    renderLogin(error.message || "Unable to check admin session.");
  }
}

async function loadVersions() {
  state.versionsLoading = true;
  state.versionsError = "";
  renderShell();
  try {
    const [today, scheduled] = await Promise.all([
      apiFetch("/stx/today?from=0&count=1"),
      apiFetch("/stx/admin/scheduled-versions")
    ]);
    const next = structuredClone(today.versions);
    for (const platform of PLATFORMS) {
      const scheduledMinimum = scheduled?.minimum_versions?.[platform]?.minimum_supported_version;
      if (scheduledMinimum) {
        next[platform].minimum_supported_version = scheduledMinimum;
      }
    }
    state.versions = next;
    state.scheduled = scheduled;
    state.versionsLoading = false;
  } catch (error) {
    state.versionsLoading = false;
    state.versionsError = error.message || "Unable to load versions.";
  }
  renderShell();
}

async function loadAnalytics() {
  state.analyticsLoading = true;
  state.analyticsError = "";
  renderShell();
  try {
    const params = new URLSearchParams();
    if (state.analyticsVersion) {
      params.set("app_version", state.analyticsVersion);
    }
    const query = params.toString();
    state.analytics = await apiFetch(`/stx/admin/analytics/summary${query ? `?${query}` : ""}`);
    state.analyticsLoading = false;
  } catch (error) {
    state.analyticsLoading = false;
    state.analyticsError = error.message || "Unable to load analytics.";
  }
  renderShell();
}

async function saveVersions(form) {
  const data = new FormData(form);
  const platforms = {};
  for (const platform of PLATFORMS) {
    platforms[platform] = {
      live_version: String(data.get(`${platform}.live_version`) ?? "").trim(),
      minimum_supported_version: String(data.get(`${platform}.minimum_supported_version`) ?? "").trim()
    };
  }

  state.saveStatus = "saving";
  state.saveMessage = "Saving...";
  renderShell();

  try {
    const saved = await apiFetch("/stx/admin/app-config", {
      method: "PATCH",
      body: JSON.stringify({ platforms })
    });
    state.versions = {};
    for (const platform of PLATFORMS) {
      state.versions[platform] = {
        live_version: saved.live_versions?.[platform]?.live_version ?? platforms[platform].live_version,
        minimum_supported_version:
          saved.scheduled_minimum?.[platform]?.minimum_supported_version ?? platforms[platform].minimum_supported_version
      };
    }
    state.scheduled = {
      date: saved.next_daily_date,
      scheduled: true,
      minimum_versions: saved.scheduled_minimum ?? {},
      updated_at: saved.minimum_updated_at ?? null
    };
    state.saveStatus = "success";
    state.saveMessage = "Version settings saved.";
  } catch (error) {
    state.saveStatus = "error";
    state.saveMessage = error.message || "Unable to save version settings.";
  }
  renderShell();
}

app.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest("button");
  if (!target) return;
  const action = target.dataset.action;
  const tab = target.dataset.tab;
  if (action === "signin") signIn();
  if (action === "signout") void signOut();
  if (action === "reload-versions") void loadVersions();
  if (action === "reload-analytics") void loadAnalytics();
  if (tab) {
    state.activeTab = tab;
    renderShell();
    if (tab === "versions" && !state.versions && !state.versionsLoading) void loadVersions();
    if (tab === "analytics" && !state.analytics && !state.analyticsLoading) void loadAnalytics();
  }
});

app.addEventListener("submit", (event) => {
  if (!(event.target instanceof Element)) return;
  const form = event.target.closest("[data-form='versions']");
  if (!form) return;
  event.preventDefault();
  void saveVersions(form);
});

app.addEventListener("change", (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target;
  if (target?.dataset?.field === "analytics-version") {
    state.analyticsVersion = target.value;
    void loadAnalytics();
  }
});

void checkSession();
