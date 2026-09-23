// Sofascore tennis poller — runs in a real browser session (Sofascore
// refuses server fetches by fingerprint) and pushes the live tennis list
// into Prism every ~2s, with the point-by-point tail for watched matches.
// Env: PRISM_URL (default https://prismbet.app), TENNIS_INGEST_KEY,
// DURATION_S (default 21000), EVERY_MS (default 2000).
import { chromium } from "playwright";
const PRISM = process.env.PRISM_URL || "https://prismbet.app";
const KEY = process.env.TENNIS_INGEST_KEY;
const END = Date.now() + Number(process.env.DURATION_S || 21000) * 1000;
const EVERY = Number(process.env.EVERY_MS || 3000);
const IDLE_EVERY = Number(process.env.IDLE_MS || 15000); // no watched match live → just keep the list warm
const PROBE = process.env.PROBE === "1";
if (!KEY) { console.error("TENNIS_INGEST_KEY missing"); process.exit(1); }
const log = (m) => console.log(new Date().toISOString(), m);
const norm = (s) => (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").trim();
const toks = (s) => norm(s).split(/\s+/).filter((t) => t.length >= 2);
// loose pairing for deciding which events deserve a point-by-point fetch — Prism does the strict match
const wanted = (ev, watch) => watch.some((w) => { const names = [...toks(w.away), ...toks(w.home)]; const evn = [...toks(ev.homeTeam?.name), ...toks(ev.awayTeam?.name)]; return names.filter((t) => t.length >= 3 && evn.includes(t)).length >= 2; });
const compact = (ev, pbp) => ({
  id: ev.id, status: { type: ev.status?.type, description: ev.status?.description },
  home: { name: ev.homeTeam?.name, short: ev.homeTeam?.shortName }, away: { name: ev.awayTeam?.name, short: ev.awayTeam?.shortName },
  startTimestamp: ev.startTimestamp, tournament: ev.tournament?.name, category: ev.tournament?.category?.name,
  firstToServe: ev.firstToServe ?? null, lastPeriod: ev.lastPeriod ?? null, homeScore: ev.homeScore ?? {}, awayScore: ev.awayScore ?? {}, pbp: pbp ?? null,
});
let browser = await chromium.launch();
let page = await browser.newPage();
const open = async () => { await page.goto("https://www.sofascore.com/tennis", { waitUntil: "domcontentloaded", timeout: 60000 }); };
await open();
if (PROBE) {
  const r = await page.evaluate(async () => { const r = await fetch("/api/v1/sport/tennis/events/live"); return { status: r.status, n: r.status === 200 ? ((await r.json()).events ?? []).length : null }; }).catch((e) => ({ err: String(e) }));
  log(`probe: ${JSON.stringify(r)}`); await browser.close(); process.exit(0);
}
let watch = [], watchAt = 0, lastPbp = new Map(), polls = 0, posts = 0, fails = 0, lastReload = Date.now(), anyWatched = false;
while (Date.now() < END) {
  const t0 = Date.now();
  try {
    if (t0 - watchAt > 30_000) {
      const r = await fetch(`${PRISM}/api/tennis/watch`, { headers: { "x-ingest-key": KEY } });
      if (r.ok) { watch = (await r.json()).watch ?? []; watchAt = t0; }
    }
    const live = await page.evaluate(async () => { const r = await fetch("/api/v1/sport/tennis/events/live"); return r.status === 200 ? (await r.json()).events ?? [] : { err: r.status }; });
    if (!Array.isArray(live)) throw new Error(`live ${JSON.stringify(live)}`);
    polls++;
    const events = [];
    anyWatched = false;
    for (const ev of live) {
      let pbp = null;
      if (wanted(ev, watch)) {
        anyWatched = true;
        const stamp = ev.changes?.changeTimestamp ?? 0;
        const prev = lastPbp.get(ev.id);
        if (!prev || prev.stamp !== stamp) {
          const p = await page.evaluate(async (id) => { const r = await fetch(`/api/v1/event/${id}/point-by-point`); return r.status === 200 ? await r.json() : null; }, ev.id).catch(() => null);
          const sets = p?.pointByPoint ?? [];
          const last = sets[sets.length - 1]; const g = last?.games?.[last.games.length - 1]; const pt = g?.points?.[g.points.length - 1];
          pbp = g ? { set: last.set, game: g.game, serving: g.score?.serving ?? null, lastWinner: pt ? (pt.homePointType === 1 ? 1 : pt.awayPointType === 1 ? 2 : null) : null } : null;
          lastPbp.set(ev.id, { stamp, pbp });
        } else pbp = prev.pbp;
      }
      events.push(compact(ev, pbp));
    }
    const r = await fetch(`${PRISM}/api/tennis/ingest`, { method: "POST", headers: { "content-type": "application/json", "x-ingest-key": KEY }, body: JSON.stringify({ events }) });
    const j = await r.json().catch(() => ({}));
    posts++;
    if (polls % 30 === 1) log(`polls ${polls} live ${live.length} watch ${watch.length} → matched ${j.matched ?? "?"} wrote ${j.wrote ?? "?"} unmatched ${(j.unmatched ?? []).slice(0, 3).join(" | ")}`);
    fails = 0;
  } catch (e) {
    fails++;
    log(`error ${String(e).slice(0, 160)}`);
    if (fails >= 3) { try { await open(); } catch {} fails = 0; }
  }
  if (Date.now() - lastReload > 10 * 60_000) { try { await open(); } catch {} lastReload = Date.now(); }
  const wait = (anyWatched ? EVERY : IDLE_EVERY) - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
log(`done: polls ${polls} posts ${posts}`);
await browser.close();
