#!/usr/bin/env node
// Fails the build if a `rite-ingredient` span references a data-ingredient
// with no matching `eat-ingredient` in the same page, since the Eat list
// highlight (src/stahl-rite-timeline.ts) matches on these names.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CONTENT_DIR = join(import.meta.dirname, "..", "content");
const SPAN_RE = /<span\s[^>]*class="([^"]*)"[^>]*data-ingredient="([^"]*)"/g;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (entry.endsWith(".md")) files.push(path);
  }
  return files;
}

let hasError = false;

for (const file of walk(CONTENT_DIR)) {
  const text = readFileSync(file, "utf8");
  const eat = new Set();
  const rite = new Set();
  for (const [, classes, name] of text.matchAll(SPAN_RE)) {
    const tokens = classes.split(/\s+/);
    if (tokens.includes("eat-ingredient")) eat.add(name);
    if (tokens.includes("rite-ingredient")) rite.add(name);
  }
  for (const name of rite) {
    if (!eat.has(name)) {
      console.error(`${file}: rite-ingredient "${name}" has no matching eat-ingredient`);
      hasError = true;
    }
  }
}

process.exit(hasError ? 1 : 0);
