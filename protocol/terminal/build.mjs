import { build } from "esbuild";
import { mkdir, copyFile, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, "../dist");
await mkdir(out, { recursive: true });
for (const f of ["index.html", "terminal.css", "deployment.json"])
  await copyFile(resolve(root, f), resolve(out, f));
await cp(resolve(root, "assets"), resolve(out, "assets"), { recursive: true });
await build({
  entryPoints: [resolve(root, "terminal.mjs")],
  outfile: resolve(out, "terminal.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  inject: [resolve(root, "buffer-shim.mjs")],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
  logLevel: "info",
});
