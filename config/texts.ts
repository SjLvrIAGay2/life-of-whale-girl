import { group } from "./options.ts";
import { residentTexts } from "./resident/texts.ts";
import { operatorTexts } from "./operator/texts.ts";

export const texts = group("texts", { ...residentTexts, ...operatorTexts });
