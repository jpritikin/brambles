#!/usr/bin/env node
// Builds the site with Hugo into a temp dir and fails if any internal link
// points to a page or #fragment that doesn't exist in the rendered HTML.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const BASE_URL = /baseURL\s*=\s*['"]([^'"]+)['"]/.exec(readFileSync(join(ROOT, "config.toml"), "utf8"))[1];
const ATTR_RE = /\s(href|id|name)="([^"]*)"/g;
const SKIP_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function decode(s) {
  return s.replace(/&amp;/g, "&");
}

function resolveTarget(outDir, pageUrl, href) {
  const [pathPart, fragment] = href.split("#");
  let url = pathPart === "" ? pageUrl : pathPart.startsWith("/") ? pathPart : posix.join(pageUrl.endsWith("/") ? pageUrl : posix.dirname(pageUrl), pathPart);
  url = decodeURI(url.split("?")[0]);
  const fsPath = join(outDir, url);
  const candidates = [fsPath, join(fsPath, "index.html")];
  const file = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  return { file, fragment: fragment === undefined ? undefined : decodeURIComponent(fragment) };
}

const outDir = mkdtempSync(join(tmpdir(), "brambles-links-"));
let hasError = false;

try {
  execFileSync("hugo", ["--quiet", "-D", "--destination", outDir], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });

  const idsByFile = new Map();
  const pages = walk(outDir).filter((f) => f.endsWith(".html"));
  const linksByPage = new Map();
  for (const file of pages) {
    const ids = new Set();
    const links = [];
    for (const [, attr, value] of readFileSync(file, "utf8").matchAll(ATTR_RE)) {
      if (attr === "href") links.push(decode(value));
      else ids.add(decode(value));
    }
    idsByFile.set(file, ids);
    linksByPage.set(file, links);
  }

  for (const [file, links] of linksByPage) {
    const pageUrl = "/" + file.slice(outDir.length + 1).replace(/index\.html$/, "");
    for (let href of links) {
      if (href.startsWith(BASE_URL)) href = href.slice(BASE_URL.length - 1);
      if (href === "" || SKIP_RE.test(href)) continue;
      const { file: target, fragment } = resolveTarget(outDir, pageUrl, href);
      if (!target) {
        console.error(`${pageUrl}: broken link "${href}" (no such page)`);
        hasError = true;
      } else if (fragment && target.endsWith(".html") && !idsByFile.get(target)?.has(fragment)) {
        console.error(`${pageUrl}: broken link "${href}" (no element with id "${fragment}")`);
        hasError = true;
      }
    }
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

process.exit(hasError ? 1 : 0);
