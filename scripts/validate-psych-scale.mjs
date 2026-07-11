#!/usr/bin/env node
// Fails the build if any `data-pattern="..."` in content/ references an emoji
// not defined in data/psychScale.json. Keeps psych-scale.ts's runtime check
// (src/psych-scale.ts) from being the first place a typo is caught.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CONTENT_DIR = join(import.meta.dirname, "..", "content");
const SCALE_PATH = join(import.meta.dirname, "..", "data", "psychScale.json");

const EMOJI_RE = /[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;
const PATTERN_ATTR_RE = /data-pattern="([^"]*)"/g;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (entry.endsWith(".md")) files.push(path);
  }
  return files;
}

const psychScale = JSON.parse(readFileSync(SCALE_PATH, "utf8"));
const knownEmojis = new Set(psychScale.criteria.flatMap((c) => c.levels.map((l) => l.emoji)));

let hasError = false;

for (const file of walk(CONTENT_DIR)) {
  const text = readFileSync(file, "utf8");
  for (const attrMatch of text.matchAll(PATTERN_ATTR_RE)) {
    const pattern = attrMatch[1];
    for (const emoji of pattern.match(EMOJI_RE) ?? []) {
      if (!knownEmojis.has(emoji)) {
        console.error(`${file}: unknown emoji "${emoji}" in data-pattern="${pattern}"`);
        hasError = true;
      }
    }
  }
}

if (hasError) {
  console.error("\npsych-scale validation failed: fix unknown emojis or add them to data/psychScale.json");
  process.exit(1);
}
