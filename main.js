// kz-usage: plan usage for Claude and Codex in the status bar, reset times on hover.
// Props: providers (which to show and in what order, default: every provider with a login),
// model (the Claude weekly model window, default: the active one), dirs ({claude: "D:/cfg"}).
//
// The numbers live in shared(), not in the copy: every copy, a hot reload and the next start
// read the same answer, so the usage endpoints see one request a minute at most.
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { theme, props, home, readTextFile, checking, shared, setShared, layout, run, exec, window } from "herdr";
import { PROVIDERS, load, resetText, clock } from "./providers.js";

const TICK = 15_000;
const EVERY = 60_000;
const BACKOFF = 5 * 60_000;
const STUCK = 30_000;
const BAR = 96;
const PAD = 14;
const STATUS = { wait: "...", login: "No login", expired: "Expired", limited: "--", error: "--" };

export default class Usage extends View {
  init(given, cx) {
    const p = given ?? props() ?? {};
    const known = (id) => typeof id === "string" && Object.hasOwn(PROVIDERS, id);
    const listed = Array.isArray(p.providers) ? [...new Set(p.providers.filter(known))] : [];
    this.listed = listed.length > 0;
    this.ids = this.listed ? listed : Object.keys(PROVIDERS);
    this.model = typeof p.model === "string" ? p.model : null;
    const dirs = p.dirs && typeof p.dirs === "object" ? p.dirs : {};
    this.dirs = Object.fromEntries(Object.entries(dirs).filter(([id, dir]) => known(id) && typeof dir === "string" && dir.trim()));
    this.key = `kz-usage:${JSON.stringify([this.model, this.dirs])}`;
    this.width = 0;

    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(TICK, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    const cache = shared(this.key) ?? {};
    const now = Date.now();
    if (cache.pending && now - cache.pending < STUCK) return;

    // every provider, not only the shown ones: copies with other props read the same cache
    const due = Object.keys(PROVIDERS).filter((id) => now >= (cache.data?.[id]?.next ?? 0));
    if (!due.length) return;
    setShared(this.key, { ...cache, pending: now });

    cx.spawn(async () => {
      const keychain = window()?.platform === "macos" ? readKeychain : null;
      const options = (id) => ({ home: home(), dir: this.dirs[id], model: this.model, read: readTextFile, keychain });
      const results = await Promise.all(due.map((id) => load(id, options(id))));
      const data = { ...(shared(this.key)?.data ?? {}) };
      due.forEach((id, i) => { data[id] = merge(data[id], results[i], Date.now()); });
      setShared(this.key, { pending: 0, data });
    });
  }

  // grow or shrink the layout block to the numbers, so the status bar has no gap or clip
  fit(width) {
    const px = Math.ceil((width + PAD * 2) / 4) * 4;
    if (px === this.width) return;
    this.width = px;
    const block = findBlock(layout());
    if (block?.id) run("layout.resize", { id: block.id, px });
  }

  render() {
    const t = theme();
    const data = shared(this.key)?.data ?? {};
    const shown = this.listed ? this.ids : this.ids.filter((id) => data[id] && data[id].state !== "login");
    if (!shown.length) shown.push(this.ids[0]);
    const at = Math.max(0, ...shown.map((id) => data[id]?.at ?? 0));

    const bar = h_flex().id("kz-usage-bar").flex_none().gap(14).items_center()
      .on_size_change((size) => this.fit(size.width))
      .children(shown.map((id) => summary(id, data[id], t)));

    return h_flex().size_full().justify_end().items_center().px(PAD)
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(HoverCard.new("kz-usage-card").anchor("bottom_right").open_delay(250).close_delay(200)
        .trigger(bar)
        .content(v_flex().p(12).gap(12).bg(t.popover).border_1().border_color(t.border).rounded(8).shadow_md()
          .text_size(12).text_color(t.foreground)
          .children(shown.map((id) => section(id, data[id], t)))
          .child(div().pt(10).border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
            .child(at ? `Updated ${clock(at)}, checks every minute` : "Checks every minute"))));
  }
}

function merge(previous, result, now) {
  const next = now + (result.state === "limited" ? BACKOFF : EVERY);
  const kept = previous?.state === "ok" && (result.state === "limited" || result.state === "error");
  // keep the last numbers through a rate limit or a network error, and say so
  return kept ? { ...previous, failed: result.state, next } : { ...result, at: now, next };
}

async function readKeychain(service) {
  const r = await exec("security", ["find-generic-password", "-s", service, "-w"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

function findBlock(node) {
  if (!node || typeof node !== "object") return null;
  if (node.content?.mod === "kz-usage") return node;
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const hit = findBlock(child);
    if (hit) return hit;
  }
  return null;
}

function summary(id, result, t) {
  const row = h_flex().gap(6).items_center().child(image(PROVIDERS[id].icon).size(13).flex_none());
  if (result?.state !== "ok") return row.child(div().text_color(t.dim).child(STATUS[result?.state ?? "wait"]));

  return row.child(h_flex().gap(10).children(result.windows.map((w) =>
    h_flex().gap(4)
      .child(div().text_color(t.dim).child(w.label))
      .child(div().text_color(tone(w.percent, t) ?? t.muted).child(`${w.percent}%`)))));
}

function section(id, result, t) {
  const provider = PROVIDERS[id];
  const head = h_flex().gap(8).items_center()
    .child(image(provider.icon).size(16).flex_none())
    .child(div().font_medium().child(`${provider.name} usage`));

  if (result?.state !== "ok") return v_flex().gap(6).child(head).child(note(message(result?.state, provider), t));

  return v_flex().gap(6).child(head)
    .children(result.windows.map((w) => row(w, t)))
    .children(result.notes.map((text) => note(text, t)))
    .when(Boolean(result.failed), (el) => el.child(note(`${message(result.failed, provider)} Showing usage from ${clock(result.at)}.`, t)));
}

function row(w, t) {
  const fill = Math.round((BAR * Math.min(w.percent, 100)) / 100);
  return h_flex().gap(10).items_center()
    .child(div().w(48).truncate().text_color(t.muted).child(w.label))
    .child(div().w(BAR).h(4).flex_none().rounded(2).bg(t.border)
      .child(div().w(fill).h(4).rounded(2).bg(tone(w.percent, t) ?? t.accent)))
    .child(div().w(36).flex_none().text_right().text_color(tone(w.percent, t) ?? t.foreground).child(`${w.percent}%`))
    .child(div().whitespace_nowrap().text_color(t.muted).child(resetText(w.resets)));
}

function note(text, t) {
  return div().max_w(360).text_color(t.muted).child(text);
}

function tone(percent, t) {
  if (percent >= 95) return t.ansi1;
  if (percent >= 80) return t.ansi3;
  return null;
}

function message(state, provider) {
  if (state === "login") return `No login found. ${provider.login}.`;
  if (state === "expired") return `The login expired. ${provider.login} again.`;
  if (state === "limited") return "The usage API asked to slow down. The next try is in 5 minutes.";
  if (state === "error") return "Could not get usage. The next try is in one minute.";
  return "Loading";
}
