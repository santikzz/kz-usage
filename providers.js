// Where each provider keeps its login, how to ask for its usage, and how to read the answer.
// No Herdr imports, so `node providers.test.mjs` can check the parsers.

export const PROVIDERS = {
  claude: {
    name: "Claude",
    icon: "icons/claude.svg",
    dir: ".claude",
    file: ".credentials.json",
    // macOS keeps the login here instead of the file
    keychain: "Claude Code-credentials",
    login: "Run claude and log in",
    request(auth) {
      const token = auth?.claudeAiOauth?.accessToken;
      if (typeof token !== "string" || !token) return null;
      return {
        url: "https://api.anthropic.com/api/oauth/usage",
        headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
      };
    },
    parse: parseClaude,
  },
  codex: {
    name: "Codex",
    icon: "icons/codex.svg",
    dir: ".codex",
    file: "auth.json",
    login: "Run codex and sign in with ChatGPT",
    request(auth) {
      const token = auth?.tokens?.access_token;
      if (typeof token !== "string" || !token) return null;
      const headers = { Authorization: `Bearer ${token}`, "User-Agent": "codex-cli" };
      if (typeof auth.tokens.account_id === "string") headers["ChatGPT-Account-Id"] = auth.tokens.account_id;
      return { url: "https://chatgpt.com/backend-api/wham/usage", headers };
    },
    parse: parseCodex,
  },
};

// state: "ok" | "login" (no credentials) | "expired" (401 or 403) | "limited" (429)
// | "error" (network, server, bad answer). Plain data, so it can go into shared().
export async function load(id, { home, dir, model, read, keychain }) {
  const provider = PROVIDERS[id];
  let text = await read(`${dir || `${home}/${provider.dir}`}/${provider.file}`).catch(() => null);
  if (text == null && !dir && provider.keychain && keychain) text = await keychain(provider.keychain).catch(() => null);
  const auth = json(text);
  const request = provider.request(auth);
  if (!request) return { state: "login" };

  try {
    const response = await fetch(request.url, { headers: request.headers });
    if (response.status === 401 || response.status === 403) return { state: "expired" };
    if (response.status === 429) return { state: "limited" };
    if (!response.ok) return { state: "error" };

    const usage = provider.parse(await response.json(), model);
    return usage.windows.length ? { state: "ok", ...usage } : { state: "error" };
  } catch {
    return { state: "error" };
  }
}

export function parseClaude(data, model) {
  const limits = Array.isArray(data?.limits) ? data.limits.filter((l) => l && number(l.percent) !== null) : [];
  const session = limits.find((l) => l.kind === "session");
  const weekly = limits.find((l) => l.kind === "weekly_all");
  const scoped = limits.filter((l) => l.kind === "weekly_scoped" && scopeName(l));
  const pinned = typeof model === "string" && model.trim() ? model.trim().toLowerCase() : null;
  const pick = pinned
    ? scoped.find((l) => scopeName(l).toLowerCase() === pinned)
    : scoped.find((l) => l.is_active) ?? scoped[0];

  const windows = [
    session ? windowOf("5h", session.percent, session.resets_at) : windowOf("5h", data?.five_hour?.utilization, data?.five_hour?.resets_at),
    weekly ? windowOf("7d", weekly.percent, weekly.resets_at) : windowOf("7d", data?.seven_day?.utilization, data?.seven_day?.resets_at),
    pick && windowOf(scopeName(pick), pick.percent, pick.resets_at),
  ].filter(Boolean);

  const notes = [];
  const extra = data?.extra_usage;
  if (extra?.is_enabled === true) {
    const used = number(extra.utilization);
    notes.push(used === null ? "Extra usage on" : `Extra usage on, ${Math.round(used)}% used`);
  }
  const spend = data?.spend;
  const minor = number(spend?.used?.amount_minor);
  if (spend?.enabled === true && minor !== null) {
    const exponent = clamp(number(spend.used.exponent) ?? 2, 0, 6);
    notes.push(`Spend ${(minor / 10 ** exponent).toFixed(2)} ${spend.used.currency ?? ""}`.trim());
  }

  return { windows, notes };
}

export function parseCodex(data) {
  const limits = data?.rate_limit ?? {};
  const windows = [limits.primary_window, limits.secondary_window]
    .filter((w) => w && number(w.used_percent) !== null)
    .map((w) => windowOf(span(number(w.limit_window_seconds)), w.used_percent, resetOf(w)));

  const notes = [];
  if (typeof data?.plan_type === "string" && data.plan_type) notes.push(`Plan ${data.plan_type}`);
  return { windows, notes };
}

// resets and now are epoch milliseconds: "resets in 3d 5h, Thu 04:59"
export function resetText(resets, now = Date.now()) {
  if (!resets) return "";
  const left = resets - now;
  if (left <= 0) return "resets now";

  const minutes = Math.floor(left / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remaining = days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes % 60}m`;

  const date = new Date(resets);
  const sameDay = date.toDateString() === new Date(now).toDateString();
  return `resets in ${remaining}, ${sameDay ? clock(resets) : `${DAYS[date.getDay()]} ${clock(resets)}`}`;
}

export function clock(ms) {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function windowOf(label, percent, resets) {
  const value = number(percent);
  if (value === null) return null;
  const ms = typeof resets === "number" ? resets : typeof resets === "string" ? Date.parse(resets) : NaN;
  return { label, percent: Math.round(clamp(value, 0, 999)), resets: Number.isFinite(ms) ? ms : null };
}

function scopeName(limit) {
  const model = limit.scope?.model;
  const name = model?.display_name || model?.id;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function resetOf(w) {
  const at = number(w.reset_at);
  if (at !== null) return at < 1e10 ? at * 1000 : at;
  const after = number(w.reset_after_seconds);
  return after === null ? null : Date.now() + after * 1000;
}

function span(seconds) {
  if (!seconds) return "?";
  if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}d`;
  return `${Math.round(seconds / 3600)}h`;
}

function json(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function pad(value) {
  return String(value).padStart(2, "0");
}
