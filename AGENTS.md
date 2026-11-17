# kz-usage: notes for agents

Read this file before you work on this mod. Your global rules in `~/.claude/CLAUDE.md` also apply.

## What this mod is

kz-usage is a [Herdr](https://herdr.dev) mod that shows plan usage for Claude and Codex in the status bar, with a hover card for the reset times. The public repo is `github.com/santikzz/kz-usage` (MIT). The main test machine is Windows 10 with Herdr 0.1.16. Codex, macOS and Linux are not tested.

Read these files first:

- `../../AGENTS.md`: the Herdr manual (layouts, keys, mods, commands). Herdr rewrites it on every start.
- `../../herdr.d.ts` and `gpui-kit.d.ts`: the real API. Trust them over memory.
- `RECIPE.md`: how this mod is built. Its "Watch out" section lists the traps that are already known.
- `README.md`: what the user sees.

## Files

| File | Job |
|---|---|
| `main.js` | The status bar block, the hover card, the shared cache, the auto width |
| `providers.js` | Login file, request and parser for each provider, `resetText()`. No Herdr imports |
| `providers.test.mjs` | Check for the parsers. Run `node providers.test.mjs` |

Do not edit `gpui-kit.d.ts` or `jsconfig.json`. Herdr writes them.

## How to work here

- For UI work, load the `/impeccable` skill first. The bar is an Operate surface: quiet, the same look as the `workspace-status` mod next to it.
- Use only `theme()` colors. No translucent backgrounds. Sentence case. Use the Herdr program icons in `icons/`, never emoji or Unicode glyphs as icons.
- Keep the code small and readable. Add no dependencies.
- A new provider is one entry in `PROVIDERS` and one case in `providers.test.mjs`. Use only endpoints that two or more real projects use, and say in the README which ones you did not test.
- Settings are block `props`. Check their types. Bad values must fall back to the defaults.
- Write all docs in ASD-STE100 Simplified Technical English.

## Check your work

1. Run `node providers.test.mjs` after a change to `providers.js`.
2. Run `herdr-app check ~/.config/herdr-app/mods/kz-usage` after every change. It renders the bar with no data.
3. Look at the result in the running app: `herdr-app shot <file.png>`, then crop it with `magick`. `herdr-app status` lists mod errors.
4. The CLI cannot hover. To see the card, change `HoverCard.new(...)...close_delay(200)` to `Popover.new("kz-usage-card").anchor("bottom_right").open(true) // KZTEST` and import `Popover`. Take the screenshot, then remove every `KZTEST` change.
5. Every save in the mod folder reloads the mod. The shared cache stops a new request, but do not call the usage endpoints by hand in a loop: the Claude endpoint gives 429 fast.

## Known limits

Do not investigate these again:

- A mod cannot read environment variables (`process` has no `env`). Use the `dirs` prop for `CLAUDE_CONFIG_DIR` and `CODEX_HOME`.
- `fetch` has no timeout. `main.js` treats a request older than 30 seconds as lost.
- The Claude endpoint returns 429 at about two requests a minute for one login. Other tools on the same login (for example MiniBar) count too.
- `console.log` does not show in `herdr-app check`. To inspect a value, throw an error that contains it.

## When a feature is done

1. Update `README.md` and `RECIPE.md` as the change needs. Keep them short.
2. Do not commit unless the user asks.
3. End your last message with a suggested commit message: lowercase Conventional Commits, no period. For example: `feat: codex usage in the status bar`.
