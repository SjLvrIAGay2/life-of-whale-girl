import { group } from "./options.ts";
import { residentNumbers } from "./resident/numbers.ts";
import { operatorNumbers } from "./operator/numbers.ts";

export const numbers = group("numbers", { ...residentNumbers, ...operatorNumbers });
