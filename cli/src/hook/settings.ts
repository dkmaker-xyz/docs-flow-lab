/**
 * The Claude Code SessionStart hook entry in `<project>/.claude/settings.json`
 * (spec 9.1). Pure functions over the parsed settings; the command does I/O.
 *
 * Settings shape: `hooks.SessionStart` is an array of matcher groups
 * `{ matcher?, hooks: [handler, …] }`. The entry has no matcher, so it runs on
 * startup, resume, clear and compact. It is exec form (`command` + `args`,
 * no shell) and is recognised by command and args, so other hooks are kept.
 */

export const HOOK_COMMAND = "idc365-decisions";
export const HOOK_ARGS = ["hook", "session-start"];
export const HOOK_TIMEOUT = 15;

export interface HookHandler {
  type: "command";
  command: string;
  args: string[];
  timeout: number;
}

export const HOOK_HANDLER: HookHandler = { type: "command", command: HOOK_COMMAND, args: HOOK_ARGS, timeout: HOOK_TIMEOUT };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** True for our handler: exec form with our command and args, or the same as one shell string. */
export function isOurHandler(h: unknown): boolean {
  if (!isObject(h) || h.type !== "command") return false;
  if (h.command === HOOK_COMMAND && Array.isArray(h.args) && h.args.length === HOOK_ARGS.length && h.args.every((a, i) => a === HOOK_ARGS[i])) return true;
  return h.args === undefined && typeof h.command === "string" && h.command.trim().split(/\s+/).join(" ") === [HOOK_COMMAND, ...HOOK_ARGS].join(" ");
}

export type SettingsError = { error: string };

function groups(settings: Json): unknown[] | SettingsError {
  if (settings.hooks === undefined) return [];
  if (!isObject(settings.hooks)) return { error: "`hooks` is not an object" };
  const ss = settings.hooks.SessionStart;
  if (ss === undefined) return [];
  if (!Array.isArray(ss)) return { error: "`hooks.SessionStart` is not an array" };
  return ss;
}

/**
 * Adds our handler, or rewrites it in place when present (one copy, in a
 * group without a matcher). Everything else is kept as it is.
 */
export function mergeHook(settings: Json): { settings: Json; changed: boolean } | SettingsError {
  const list = groups(settings);
  if ("error" in list) return list;
  let placed = false;
  const out: unknown[] = [];
  for (const g of list) {
    if (!isObject(g) || !Array.isArray(g.hooks) || !g.hooks.some(isOurHandler)) {
      out.push(g);
      continue;
    }
    const others = g.hooks.filter((h) => !isOurHandler(h));
    if (!placed && (g.matcher === undefined || g.matcher === "" || g.matcher === "*")) {
      const { matcher: _m, ...rest } = g;
      const i = g.hooks.findIndex(isOurHandler);
      const hooks = [...others];
      hooks.splice(i, 0, { ...HOOK_HANDLER });
      out.push({ ...rest, hooks });
      placed = true;
    } else if (others.length) out.push({ ...g, hooks: others });
  }
  if (!placed) out.push({ hooks: [{ ...HOOK_HANDLER }] });
  const hooks = isObject(settings.hooks) ? settings.hooks : {};
  const next = { ...settings, hooks: { ...hooks, SessionStart: out } };
  return { settings: next, changed: JSON.stringify(next) !== JSON.stringify(settings) };
}

/** Removes only our handler; drops groups, `SessionStart` and `hooks` that become empty because of it. */
export function removeHook(settings: Json): { settings: Json; changed: boolean } | SettingsError {
  const list = groups(settings);
  if ("error" in list) return list;
  if (!list.some((g) => isObject(g) && Array.isArray(g.hooks) && g.hooks.some(isOurHandler))) return { settings, changed: false };
  const out: unknown[] = [];
  for (const g of list) {
    if (!isObject(g) || !Array.isArray(g.hooks) || !g.hooks.some(isOurHandler)) out.push(g);
    else {
      const others = g.hooks.filter((h) => !isOurHandler(h));
      if (others.length) out.push({ ...g, hooks: others });
    }
  }
  const { SessionStart: _s, ...otherEvents } = settings.hooks as Json;
  const hooks = out.length ? { ...otherEvents, SessionStart: out } : otherEvents;
  const { hooks: _h, ...rest } = settings;
  return { settings: Object.keys(hooks).length ? { ...rest, hooks } : rest, changed: true };
}
