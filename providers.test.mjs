// node providers.test.mjs
import assert from "node:assert/strict";
import { parseClaude, parseCodex, resetText } from "./providers.js";

const claude = {
  five_hour: { utilization: 1, resets_at: "2026-11-17T00:29:59+00:00" },
  extra_usage: { is_enabled: true, utilization: 12.4 },
  spend: { enabled: true, used: { amount_minor: 1234, currency: "USD", exponent: 2 } },
  limits: [
    { kind: "session", percent: 8, resets_at: "2026-11-17T00:29:59+00:00", scope: null },
    { kind: "weekly_all", percent: 67, resets_at: "2026-11-20T04:59:59+00:00", scope: null },
    { kind: "weekly_scoped", percent: 40, scope: { model: { id: "opus", display_name: null } }, is_active: false },
    { kind: "weekly_scoped", percent: 86, resets_at: "2026-11-20T04:59:59+00:00", scope: { model: { id: null, display_name: "Fable" } }, is_active: true },
  ],
};

const active = parseClaude(claude);
assert.deepEqual(active.windows.map((w) => `${w.label} ${w.percent}`), ["5h 8", "7d 67", "Fable 86"]);
assert.equal(active.windows[0].resets, Date.parse("2026-11-17T00:29:59Z"));
assert.deepEqual(active.notes, ["Extra usage on, 12% used", "Spend 12.34 USD"]);

assert.equal(parseClaude(claude, "opus").windows[2].label, "opus");
assert.equal(parseClaude(claude, "nope").windows.length, 2);

const legacy = parseClaude({ five_hour: { utilization: 55.6, resets_at: null }, seven_day: { utilization: 49 } });
assert.deepEqual(legacy.windows.map((w) => `${w.label} ${w.percent} ${w.resets}`), ["5h 56 null", "7d 49 null"]);

assert.equal(parseClaude(null).windows.length, 0);
assert.equal(parseClaude({ limits: "bad" }).windows.length, 0);

const codex = parseCodex({
  plan_type: "plus",
  rate_limit: {
    primary_window: { used_percent: 1, limit_window_seconds: 18000, reset_at: 1779597324 },
    secondary_window: { used_percent: 20.5, limit_window_seconds: 604800, reset_after_seconds: 60 },
  },
});
assert.deepEqual(codex.windows.map((w) => `${w.label} ${w.percent}`), ["5h 1", "7d 21"]);
assert.equal(codex.windows[0].resets, 1779597324000);
assert.deepEqual(codex.notes, ["Plan plus"]);
assert.equal(parseCodex({}).windows.length, 0);

const now = new Date(2026, 10, 16, 20, 0).getTime();
assert.equal(resetText(new Date(2026, 10, 16, 21, 17).getTime(), now), "resets in 1h 17m, 21:17");
assert.equal(resetText(new Date(2026, 10, 19, 1, 59).getTime(), now), "resets in 2d 5h, Thu 01:59");
assert.equal(resetText(now - 1, now), "resets now");
assert.equal(resetText(null, now), "");

console.log("ok");
