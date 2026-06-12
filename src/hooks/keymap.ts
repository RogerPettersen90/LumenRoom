// Remappable single-key shortcuts. Rather than rewriting the (workflow-faithful)
// switch in useKeyboardShortcuts, remapping is a translation layer: a custom
// binding translates back to the DEFAULT key for that action before the
// switch sees it, and an overridden default key goes inert. Persisted in
// localStorage — purely a frontend concern.

export interface RemapAction {
  /** The default (and internal) key, lowercase. */
  key: string;
  label: string;
  category: string;
}

/** The remappable surface: the classic single-key culling/view bindings. */
export const REMAP_ACTIONS: RemapAction[] = [
  { key: "g", label: "Grid view", category: "Views" },
  { key: "e", label: "Loupe view", category: "Views" },
  { key: "c", label: "Compare view", category: "Views" },
  { key: "n", label: "Survey view", category: "Views" },
  { key: "d", label: "Develop module", category: "Views" },
  { key: "p", label: "Flag as Pick", category: "Culling" },
  { key: "x", label: "Flag as Reject", category: "Culling" },
  { key: "u", label: "Remove flag", category: "Culling" },
  { key: "b", label: "Quick Collection toggle", category: "Culling" },
  { key: "r", label: "Crop & Straighten", category: "Develop" },
  { key: "y", label: "Before / After", category: "Develop" },
  { key: "j", label: "Clipping indicators", category: "Develop" },
  { key: "o", label: "Mask overlay", category: "Develop" },
  { key: "z", label: "Zoom toggle", category: "Views" },
  { key: "f", label: "Fullscreen", category: "Chrome" },
  { key: "l", label: "Lights Out", category: "Chrome" },
  { key: "i", label: "Info overlay", category: "Chrome" },
  { key: "t", label: "Toolbar", category: "Chrome" },
];

const STORAGE_KEY = "lumen.keymap";

/** default key -> custom key (lowercase). Only differing entries stored. */
export type Overrides = Record<string, string>;

export function loadOverrides(): Overrides {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Overrides;
  } catch {
    return {};
  }
}

export function saveOverrides(o: Overrides): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
  rebuild(o);
}

// Hot lookup tables, rebuilt on save and at module load.
let customToDefault = new Map<string, string>();
let overriddenDefaults = new Set<string>();

function rebuild(o: Overrides): void {
  customToDefault = new Map();
  overriddenDefaults = new Set();
  for (const [def, custom] of Object.entries(o)) {
    if (!custom || custom === def) continue;
    customToDefault.set(custom, def);
    overriddenDefaults.add(def);
  }
}
rebuild(loadOverrides());

/**
 * Translate an incoming key (lowercase) for the shortcut switch: custom keys
 * become their action's default key; a default that has been remapped away
 * becomes inert (""). Everything else passes through.
 */
export function remapKey(key: string): string {
  const def = customToDefault.get(key);
  if (def) return def;
  if (overriddenDefaults.has(key)) return "";
  return key;
}

/** The key currently bound to an action (for display). */
export function boundKey(defaultKey: string, o: Overrides): string {
  return o[defaultKey] ?? defaultKey;
}
