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
type Parts = {
  read: (
    source: "bili" | "heybox",
    query?: string,
  ) => Promise<string[]>;
  draw: (idea: string) => Promise<string>;
};
export async function runRecipe(raw: unknown, input: string, parts: Parts) {
  const tool = recipe.parse(raw);
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
    }
  }
  return output;
}
export async function testRecipe(raw: unknown) {
  return runRecipe(raw, "蓝色手绘", {
    read: async () => ["样例甲", "样例乙"],
    draw: async (idea) => "预览：" + idea,
  });
}
