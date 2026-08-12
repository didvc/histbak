// Build both browser targets with esbuild. No framework, no CSS pipeline:
// the extension has three pages and they load plain stylesheets.
import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, "src");
const watch = process.argv.includes("--watch");
const dist = process.argv.includes("--dist");
const outRoot = path.join(root, dist ? "dist" : "build");

const TARGETS = [
  { name: "chrome", manifest: "manifest.chrome.json" },
  { name: "firefox", manifest: "manifest.firefox.json" }
];

const ENTRIES = {
  background: "background/index.js",
  options: "options/index.js",
  popup: "popup/index.js",
  viewer: "viewer/index.js"
};

const PAGES = [
  { entry: "options", html: "options/index.html", out: "options.html", css: "options/styles.css" },
  { entry: "popup", html: "popup/index.html", out: "popup.html", css: "popup/styles.css" },
  { entry: "viewer", html: "viewer/index.html", out: "viewer.html", css: "viewer/styles.css" }
];

async function buildTarget({ name, manifest }) {
  const outdir = path.join(outRoot, name);
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const entryPoints = Object.fromEntries(
    Object.entries(ENTRIES)
      .filter(([, rel]) => existsSync(path.join(src, rel)))
      .map(([out, rel]) => [out, path.join(src, rel)])
  );

  const options = {
    entryPoints,
    outdir,
    bundle: true,
    format: "esm",
    target: ["chrome111", "firefox115"],
    sourcemap: dist ? false : "inline",
    minify: dist,
    logLevel: "warning",
    // Firefox MV3 background scripts are not modules in all versions; splitting
    // would emit bare imports the loader cannot resolve there.
    splitting: false
  };

  const ctx = watch ? await esbuild.context(options) : null;
  if (ctx) await ctx.watch();
  else await esbuild.build(options);

  await writeFile(
    path.join(outdir, "manifest.json"),
    await readFile(path.join(src, manifest), "utf8")
  );

  const common = path.join(src, "ui", "common.css");
  if (existsSync(common)) await cp(common, path.join(outdir, "common.css"));

  for (const page of PAGES) {
    const htmlPath = path.join(src, page.html);
    if (!existsSync(htmlPath)) continue;
    await writeFile(path.join(outdir, page.out), await readFile(htmlPath, "utf8"));
    const cssPath = path.join(src, page.css);
    if (existsSync(cssPath)) {
      await cp(cssPath, path.join(outdir, `${page.entry}.css`));
    }
  }

  if (existsSync(path.join(src, "icons"))) {
    await cp(path.join(src, "icons"), path.join(outdir, "icons"), { recursive: true });
  }

  return outdir;
}

for (const target of TARGETS) {
  const out = await buildTarget(target);
  console.log(`${target.name}: ${path.relative(root, out)}`);
}
if (watch) console.log("watching…");
