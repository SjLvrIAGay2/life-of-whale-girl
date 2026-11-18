import { group } from "./options.ts";
import { residentLinks } from "./resident/links.ts";
import { operatorLinks } from "./operator/links.ts";

export const links = group("links", { ...residentLinks, ...operatorLinks });
