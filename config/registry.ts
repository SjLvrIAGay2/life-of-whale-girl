import { numbers } from "./numbers.ts";
import { links } from "./links.ts";
import { texts } from "./texts.ts";
import { validValue, type Overrides, type Rule } from "./options.ts";

const groups = [numbers, links, texts];
export const catalog = new Map<string, Rule>(groups.flatMap(({category,rules}) =>
  Object.entries<Rule>(rules).map(([name, rule]): [string, Rule] => [category + "." + name, rule])));

export function publicOverrides(saved?: Overrides): Overrides | undefined {
  const publicValues: Overrides = {};
  for (const [key, value] of Object.entries(saved ?? {})) {
    const rule = catalog.get(key);
    if (rule?.publish && validValue(rule, value)) publicValues[key] = value;
  }
  return Object.keys(publicValues).length ? publicValues : undefined;
}

export function describe(key: string, saved?: Overrides) {
  const rule = catalog.get(key);
  if (!rule) throw Error("配置项不存在，请先用 list 查找名称。");
  const value = saved?.[key];
  return {key, source:"config/"+rule.owner+"/"+key.split(".")[0]+".ts", description:rule.description, owner:rule.owner, public:!!rule.publish,
    type:typeof rule.value, default:rule.value, value:validValue(rule,value) ? value : rule.value,
    min:rule.min, max:rule.max, integer:rule.integer, choices:rule.choices,
    ...(rule.link ? {format:"https URL 或本站绝对路径"} : {})};
}
