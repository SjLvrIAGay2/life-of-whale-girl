// Only explicit overrides are saved. Old databases and public archives can omit this field.
export type Overrides = Record<string, string | number>;
export type Rule<T extends string | number = string | number> = {
  value: T;
  owner: "resident" | "operator";
  description: string;
  publish?: boolean;
  archiveLabel?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
  choices?: readonly string[];
  link?: boolean;
};

export function quantity(value: number, min: number, max: number, description: string, integer = true): Rule<number> {
  return { value, min, max, description, integer, owner: "resident" };
}
export function wording(value: string, description: string, max = 240): Rule<string> {
  return { value, description, max, owner: "resident" };
}
export function locked<T extends string | number>(value: T, description: string): Rule<T> {
  return { value, description, owner: "operator" };
}
export function published<T extends Rule>(rule: T): T {
  return { ...rule, publish: true };
}
// These captions are materialized in the offline public archive, including summary-only entries.
export function archiveLabel<T extends Rule>(rule: T): T {
  return { ...rule, publish: true, archiveLabel: true };
}
export function validValue(rule: Rule, input: unknown): input is string | number {
  if (rule.owner !== "resident") return false;
  if (typeof rule.value === "number") {
    return typeof input === "number" && Number.isFinite(input) && (!rule.integer || Number.isInteger(input))
      && input >= rule.min! && input <= rule.max!;
  }
  if (typeof input !== "string" || !input.trim() || input.length > rule.max! || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input)) return false;
  if (rule.choices && !rule.choices.includes(input)) return false;
  if (rule.link) {
    // Visitor navigation only. Never use an editable URL as a server request destination.
    if (/[\s\\]/u.test(input)) return false;
    if (input.startsWith("/")) return !input.startsWith("//");
    if (!/^https:\/\//i.test(input)) return false;
    try {
      const url = new URL(input);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch { return false; }
  }
  // Display templates must retain their named substitutions.
  const slots = (text: string) => [...new Set(text.match(/\{[a-zA-Z][a-zA-Z0-9]*\}/g) ?? [])].sort().join(" ");
  return slots(input) === slots(rule.value);
}

type Values<R extends Record<string, Rule>> = { readonly [K in keyof R]: R[K]["value"] };
export function group<R extends Record<string, Rule>>(category: string, rules: R) {
  const defaults = Object.freeze(Object.fromEntries(Object.entries(rules).map(([key, rule]) => [key, rule.value]))) as Values<R>;
  function read(overrides?: Overrides): Values<R> {
    if (!overrides) return defaults;
    const values: Record<string, string | number> = { ...defaults };
    const prefix = category + ".";
    for (const [key, value] of Object.entries(overrides)) {
      if (!key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length);
      if (Object.hasOwn(rules, name) && validValue(rules[name], value)) values[name] = value;
    }
    return values as Values<R>;
  }
  return { category, rules, defaults, read };
}

export function formatText(text: string, fields: Record<string, string | number>) {
  return text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key: string) =>
    Object.hasOwn(fields, key) ? String(fields[key]) : match);
}
