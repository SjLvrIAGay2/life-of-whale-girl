import { z } from "zod";
// Recipes are small, executable programs over named, bounded operations. There is no host shell or raw network operation.
export const toolName = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
export const step = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("read"),
    source: z.enum(["heybox", "bili"]),
    query: z.string().max(70).optional(),
  }),
  z.object({ op: z.literal("take"), count: z.number().int().min(1).max(8) }),
  z.object({
    op: z.literal("join"),
    separator: z.string().max(8).default("、"),
  }),
  z.object({ op: z.literal("caption"), text: z.string().min(1).max(300) }),
  z.object({ op: z.literal("draw"), idea: z.string().min(1).max(300) }),
]);
export const recipe = z.object({
  description: z.string().min(2).max(180),
  steps: z.array(step).min(1).max(6),
});
export type Recipe = z.infer<typeof recipe>;
const stateKey = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/).refine(k=>!Object.hasOwn(Object.prototype,k));
const objectStep = z.union([step,
  z.object({op:z.literal("state.get"),key:stateKey}).strict(),
  z.object({op:z.literal("state.append"),key:stateKey,text:z.string().min(1).max(300)}).strict(),
  z.object({op:z.literal("replay")}).strict(),
]);
export const objectRecipe = recipe.extend({steps:z.array(objectStep).min(1).max(6)});
type Parts = {
  read: (
    source: "bili" | "heybox",
    query?: string,
  ) => Promise<string[]>;
  draw: (idea: string) => Promise<string>;
};
type ObjectParts = Parts & {
  get:(key:string)=>string[];
  append:(key:string,value:string)=>string[];
  replay:(input:string)=>string[];
};
export async function runRecipe(raw: unknown, input: string, parts: Parts) {
  return evaluate(recipe.parse(raw),input,parts);
}
export async function runObjectRecipe(raw:unknown,input:string,parts:ObjectParts) {
  return evaluate(objectRecipe.parse(raw),input,parts,parts);
}
async function evaluate(tool:z.infer<typeof objectRecipe>, input:string, parts:Parts, object?:ObjectParts) {
  let output = [input.slice(0, 400)];
  let drawings = 0,
    reads = 0;
  const substitute = (s: string) =>
    s
      .replaceAll("$input", input.slice(0, 400))
      .replaceAll("$result", output.join(" ").slice(0, 500))
      .slice(0, 800);
  for (const step of tool.steps) {
    switch (step.op) {
      case "read":
        if (++reads > 2) throw Error("每个工具最多读取两次");
        output = await parts.read(
          step.source,
          step.query ? substitute(step.query) : undefined,
        );
        break;
      case "take":
        output = output.slice(0, step.count);
        break;
      case "join":
        output = [output.join(step.separator).slice(0, 800)];
        break;
      case "caption":
        output = [substitute(step.text)];
        break;
      case "draw":
        if (++drawings > 1) throw Error("每个工具最多画一幅");
        output = [await parts.draw(substitute(step.idea))];
        break;
      case "state.get": output=object!.get(step.key); break;
      case "state.append": output=object!.append(step.key,substitute(step.text)); break;
      case "replay": output=object!.replay(input); break;
    }
  }
  return output;
}
export async function testRecipe(raw: unknown) {
  return runRecipe(raw, "蓝色手绘", previewParts);
}
export const previewParts:Parts = {
  read: async () => ["样例甲", "样例乙"],
  draw: async (idea) => "预览：" + idea,
};
