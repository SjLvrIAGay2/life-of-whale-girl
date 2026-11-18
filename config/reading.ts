import { texts } from "./texts.ts";
import type { Overrides } from "./options.ts";
import { numbers } from "./numbers.ts";

const keys = ["biliRepliesThreshold", "biliCommentCount", "biliListCount", "subtitleChars", "subtitleLines", "heySearchPages", "heyFeedCount", "heyArticleChars", "heyThreadCount", "heyCommentCount"] as const;

export function readingOverrides(saved?: Overrides) {
  const overrides: Overrides = {};
  const current=numbers.read(saved);
  for (const key of keys) {
    if (current[key]!==numbers.defaults[key]) overrides["numbers."+key]=current[key];
  }
  const search=texts.read(saved).searchTopic;
  if (search!==texts.defaults.searchTopic) overrides["texts.searchTopic"]=search;
  return Object.keys(overrides).length ? overrides : undefined;
}
