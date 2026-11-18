import { configurationErrors } from "../config/texts/errors.ts";
import { z } from "zod";
import type { State } from "../content/initial";
import { currentSetting, one, saveVersion, type Setting } from "../db";
import { catalog, describe } from "../config/registry";
import { validValue } from "../config/options";

export const configCommand = z.discriminatedUnion("op", [
  z.object({op:z.literal("list"), category:z.enum(["numbers","links","texts"]).optional(),
    owner:z.enum(["resident","operator"]).optional(), query:z.string().max(100).optional(),
    offset:z.number().int().nonnegative().default(0)}),
  z.object({op:z.literal("get"), key:z.string().max(100)}),
  z.object({op:z.literal("set"), key:z.string().max(100), value:z.union([z.number(),z.string()])}),
  z.object({op:z.literal("reset"), key:z.string().max(100)}),
  z.object({op:z.literal("rollback"), key:z.string().max(100)}),
]);

export async function configure(state:State, cmd:z.output<typeof configCommand> | undefined,
  now:number, writes:ReturnType<typeof saveVersion>[]) {
  if (!cmd) throw Error(configurationErrors.commandMissing);
  if (cmd.op==="list") {
    const query=cmd.query?.trim().toLowerCase() ?? "";
    const matches=[...catalog].filter(([key,r])=>(!cmd.category || key.startsWith(cmd.category+"."))
      && (!cmd.owner || r.owner===cmd.owner) && (key+" "+r.description).toLowerCase().includes(query));
    const page=matches.slice(cmd.offset,cmd.offset+12);
    return {total:matches.length, nextOffset:cmd.offset+page.length<matches.length ? cmd.offset+page.length : undefined,
      items:page.map(([key,rule])=>({key,description:rule.description,owner:rule.owner,value:describe(key,state.config).value}))};
  }
  const {key}=cmd;
  const previous=describe(key,state.config);
  if (cmd.op==="get") return previous;
  const rule=catalog.get(key)!;
  if (rule.owner!=="resident") throw Error(configurationErrors.readOnly);
  const name="config/"+key;
  const current=await currentSetting(name);
  let parent=current?.id ?? null;
  let value:string | number | undefined;
  if (cmd.op==="set") {
    if (!validValue(rule,cmd.value)) throw Error(configurationErrors.invalidValue);
    value=cmd.value;
  } else if (cmd.op==="rollback") {
    if (!current || (!current.parent && current.value==="")) throw Error(configurationErrors.initial);
    const prior=current.parent ? await one<Setting>("SELECT * FROM agent_versions WHERE id=? AND name=?",current.parent,name) : null;
    if (current.parent && !prior) throw Error(configurationErrors.missingVersion);
    value=prior?.value ? JSON.parse(prior.value) : undefined;
    if (value!==undefined && !validValue(rule,value)) throw Error(configurationErrors.obsoleteValue);
    parent=prior?.parent ?? null;
  }
  if (value===rule.value) value=undefined;
  if (cmd.op!=="rollback" && previous.value===(value ?? rule.value)) return previous;
  const next={...state.config};
  if (value===undefined) delete next[key];
  else next[key]=value;
  state.config=Object.keys(next).length ? next : undefined;
  if (rule.archiveLabel && previous.value!==(value ?? rule.value)) state.shareEpoch=crypto.randomUUID();
  writes.push(saveVersion(name,value===undefined ? "" : JSON.stringify(value),parent,now));
  return describe(key,state.config);
}
