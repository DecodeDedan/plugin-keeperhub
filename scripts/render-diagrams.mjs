/**
 * Renders docs/diagrams/*.mmd to PNG beside each source.
 *
 * npmjs.com does not render mermaid code blocks -- it prints them as source --
 * so the README references these pictures rather than fenced mermaid, and the
 * .mmd files stay in the repo as the thing to edit.
 *
 *   node scripts/render-diagrams.mjs
 *
 * Needs puppeteer-core and a local Chrome; set CHROME_PATH to override.
 */
import puppeteer from "puppeteer-core";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "docs/diagrams");
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sources = readdirSync(dir).filter((f) => f.endsWith(".mmd"));
if (sources.length === 0) {
  console.error(`no .mmd sources in ${dir}`);
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: "new" });
for (const file of sources) {
  const src = join(dir, file);
  const out = src.replace(/\.mmd$/, ".png");
  const code = readFileSync(src, "utf8");
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#fbfbfa;font-family:ui-sans-serif,system-ui,sans-serif}
#d{display:inline-block;padding:28px}</style></head>
<body><div id="d" class="mermaid"></div>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: {
  fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: "15px",
  primaryColor: "#ffffff", primaryTextColor: "#1f2328", primaryBorderColor: "#57606a",
  lineColor: "#57606a", textColor: "#1f2328", background: "#fbfbfa" } });
const { svg } = await mermaid.render("g", ${JSON.stringify(code)});
const host = document.getElementById("d");
host.innerHTML = svg;
// mermaid caps the svg with max-width; take it off and size from the viewBox
// so the picture renders at a readable width instead of a narrow column.
const el = host.querySelector("svg");
const vb = el.viewBox.baseVal;
const target = 1100;
el.style.maxWidth = "none";
el.setAttribute("width", target);
el.setAttribute("height", Math.round(vb.height * (target / vb.width)));
window.__done = true;
</script></body></html>`;
  const p = await browser.newPage();
  await p.setViewport({ width: 1400, height: 1200, deviceScaleFactor: 2 });
  await p.setContent(html, { waitUntil: "networkidle0" });
  await p.waitForFunction("window.__done === true", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));
  const box = await (await p.$("#d")).boundingBox();
  await (await p.$("#d")).screenshot({ path: out });
  await p.close();
  console.log(`${file} -> ${out.split("/").pop()} (${Math.round(box.width)}x${Math.round(box.height)})`);
}
await browser.close();
