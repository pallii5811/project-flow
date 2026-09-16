import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
const path = process.argv[2] ?? "/";
const dir = process.argv[3] ?? "apps/web/out";
const server = spawn(process.execPath, ["scripts/serve-static.mjs", dir, "3219"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36" });
const page = await context.newPage();
const t0 = Date.now();
page.on("console", (m) => console.log("console", m.type(), Date.now() - t0, m.text()));
page.on("request", (r) => console.log("req", Date.now() - t0, r.url().replace("http://localhost:3219", "")));
page.on("requestfinished", (r) => console.log("done", Date.now() - t0, r.url().replace("http://localhost:3219", "")));
await page.addInitScript(() => { document.addEventListener("playing", (e) => console.log("PLAYING", e.target.closest("[data-content-id]")?.getAttribute("data-content-id")), true);
  for (const ev of ["loadstart","canplay","play","pause","waiting","error","emptied"]) document.addEventListener(ev, (e) => console.log("media", ev, e.target.closest?.("[data-content-id]")?.getAttribute("data-content-id")), true); });
await page.goto(`http://localhost:3219${path}`);
await new Promise((r) => setTimeout(r, Number(process.argv[4] ?? 6000)));
await browser.close(); server.kill();
