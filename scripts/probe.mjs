import { chromium } from "playwright";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const urls = ["https://api.sofascore.app/api/v1/sport/tennis/events/live", "https://www.sofascore.com/api/v1/sport/tennis/events/live", "https://api.sofascore.com/api/v1/sport/tennis/events/live", "https://www.flashscore.com/tennis/", "https://www.atptour.com/en/scores/current", "https://live.itftennis.com/", "https://www.wtatennis.com/scores"];
for (const u of urls) {
  try { const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/json,text/html" } }); const t = await r.text(); console.log("node", r.status, u, t.slice(0, 80).replace(/\s+/g, " ")); } catch (e) { console.log("node ERR", u, String(e).slice(0, 80)); }
}
const browser = await chromium.launch(); const page = await browser.newPage({ userAgent: UA });
for (const u of ["https://api.sofascore.app/api/v1/sport/tennis/events/live", "https://www.sofascore.com/tennis"]) {
  try { const resp = await page.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 }); const t = await page.content(); console.log("browser", resp?.status(), u, t.slice(0, 120).replace(/\s+/g, " ")); } catch (e) { console.log("browser ERR", u, String(e).slice(0, 80)); }
}
await browser.close();
