/**
 * Penyelarasan AKURAT koordinat Puncak, Basecamp, Pos & Jalur berdasarkan data nyata:
 *   - OpenStreetMap (Overpass API): puncak, camp/shelter/pos bernama, desa basecamp, jaringan jalur setapak
 *   - Open-Meteo Elevation API (DEM satelit Copernicus 90 m): elevasi basecamp & pos
 *
 * Alur per gunung:
 *   1. Puncak     : dicocokkan dengan node OSM (natural=peak / "Puncak X") -> koordinat puncak asli
 *   2. Basecamp   : dicocokkan dengan node OSM bernama via (camp_site/information/parking/desa), jika tidak ada dipakai koordinat DB
 *   3. Jalur      : routing (Dijkstra) pada jaringan jalan/jalur setapak OSM dari basecamp ke puncak -> disimpan di Basecamp.jalurGeo
 *   4. Pos        : jika ada node OSM bernama sama -> dipakai; jika tidak -> ditempatkan berurutan di sepanjang jalur nyata
 *   5. Elevasi    : dari DEM satelit pada koordinat final (bukan perkiraan persentase)
 *
 * Pemakaian (butuh internet):
 *   node scripts/osm_accurate_align.js                 -> semua gunung, tulis ke database
 *   DRY=1 node scripts/osm_accurate_align.js           -> simulasi, tidak menulis database
 *   ONLY="pangrango,gede" node scripts/osm_accurate_align.js
 * Respons Overpass di-cache di scripts/.osm-cache/ sehingga aman diulang.
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../config/database');

const CACHE = path.join(__dirname, '.osm-cache');
fs.mkdirSync(CACHE, { recursive: true });
const UA = 'KANIMAP-GIS-academic-project/1.0';
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const DRY = process.env.DRY === '1';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[OSM]', ...a);

function hav(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ───────────────────────── Normalisasi & pencocokan nama ─────────────────────────
const STOP = new Set(['gunung', 'gn', 'mt', 'mount', 'bukit', 'pos', 'basecamp', 'base', 'camp', 'bc', 'via', 'jalur', 'pintu',
  'gerbang', 'desa', 'dusun', 'kampung', 'puncak', 'taman', 'nasional', 'tn', 'area', 'pendakian', 'jalan', 'the', 'dan', 'utama']);
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/y/g, 'i').replace(/([a-z])\1+/g, '$1').trim();
}
function toks(s) {
  return [...new Set(norm(s).split(' ').filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)))];
}
const tokEq = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
function nameMatch(targetToks, featNames) {
  if (!targetToks.length) return false;
  for (const fn of featNames) {
    const ft = toks(fn);
    if (!ft.length) continue;
    if (targetToks.every(t => ft.some(x => tokEq(t, x)))) return true;
    if (ft.every(x => targetToks.some(t => tokEq(t, x))) && ft.some(x => x.length >= 4)) return true;
  }
  return false;
}
const featNames = tg => [tg.name, tg['name:id'], tg.alt_name, tg.official_name, tg.old_name, tg.loc_name].filter(Boolean);

// ───────────────────────── Overpass ─────────────────────────
async function overpass(query, key) {
  const f = path.join(CACHE, key + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const server = SERVERS[attempt % SERVERS.length];
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 240000);
      const r = await fetch(server, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      });
      clearTimeout(to);
      const t = await r.text();
      if ([429, 503, 504].includes(r.status)) { lastErr = new Error('HTTP ' + r.status); await sleep(12000 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 120));
      const j = JSON.parse(t);
      if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) { lastErr = new Error(j.remark); await sleep(8000); continue; }
      fs.writeFileSync(f, JSON.stringify(j));
      await sleep(1500);
      return j;
    } catch (e) { lastErr = e; await sleep(8000); }
  }
  throw lastErr;
}

const HW_EXCLUDE = 'motorway|motorway_link|trunk|trunk_link|cycleway|proposed|construction|raceway|corridor|elevator|bus_guideway';
async function fetchWays(slug, bb) {
  const f = path.join(CACHE, slug + '-ways.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const [s, w, n, e] = bb;
  const j = await overpass(`[out:json][timeout:180][maxsize:1073741824];
way["highway"]["highway"!~"${HW_EXCLUDE}"](${s},${w},${n},${e});
out body geom;`, slug + '-ways-raw');
  const ways = j.elements.filter(x => x.type === 'way' && x.geometry && x.nodes).map(x => ({
    t: x.tags.highway, n: x.tags.name || x.tags.ref || '', ids: x.nodes, g: x.geometry.map(p => [p.lat, p.lon])
  }));
  fs.writeFileSync(f, JSON.stringify(ways));
  try { fs.unlinkSync(path.join(CACHE, slug + '-ways-raw.json')); } catch (_) {}
  return ways;
}
async function fetchFeatures(slug, bb) {
  const [s, w, n, e] = bb;
  const j = await overpass(`[out:json][timeout:90];
(
 node["natural"~"^(peak|saddle|spring)$"](${s},${w},${n},${e});
 node["tourism"~"^(camp_site|information|alpine_hut|wilderness_hut|guest_house|hostel)$"](${s},${w},${n},${e});
 node["amenity"~"^(shelter|parking|ranger_station|drinking_water)$"](${s},${w},${n},${e});
 node["place"~"^(village|hamlet|suburb|isolated_dwelling|locality)$"](${s},${w},${n},${e});
 way["tourism"="camp_site"](${s},${w},${n},${e});
);
out center tags;`, slug + '-feat');
  return j.elements.map(x => ({
    lat: x.lat !== undefined ? x.lat : (x.center && x.center.lat),
    lon: x.lon !== undefined ? x.lon : (x.center && x.center.lon),
    tags: x.tags || {}
  })).filter(x => x.lat !== undefined && Object.keys(x.tags).length);
}

// ───────────────────────── Graf jalur & routing ─────────────────────────
const TRAIL_TYPES = new Set(['path', 'footway', 'steps', 'track', 'bridleway']);
function buildGraph(ways) {
  const idx = new Map(); const lat = []; const lng = []; const adj = [];
  const get = (id, p) => {
    let i = idx.get(id);
    if (i === undefined) { i = lat.length; idx.set(id, i); lat.push(p[0]); lng.push(p[1]); adj.push([]); }
    return i;
  };
  ways.forEach((w, wi) => {
    let prev = get(w.ids[0], w.g[0]);
    for (let k = 1; k < w.ids.length; k++) {
      const cur = get(w.ids[k], w.g[k]);
      if (cur !== prev) {
        const d = hav(lat[prev], lng[prev], lat[cur], lng[cur]);
        adj[prev].push(cur, d, wi); adj[cur].push(prev, d, wi);
      }
      prev = cur;
    }
  });
  const grid = new Map();
  for (let i = 0; i < lat.length; i++) {
    const key = Math.floor(lat[i] / 0.002) + ',' + Math.floor(lng[i] / 0.002);
    (grid.get(key) || grid.set(key, []).get(key)).push(i);
  }
  return { lat, lng, adj, grid, n: lat.length };
}
function nearestNodes(G, la, ln, maxM, limit) {
  const r = Math.ceil(maxM / 200) + 1; const cy = Math.floor(la / 0.002), cx = Math.floor(ln / 0.002);
  const out = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const c = G.grid.get(y + ',' + x); if (!c) continue;
    for (const i of c) { const d = hav(la, ln, G.lat[i], G.lng[i]); if (d <= maxM) out.push([d, i]); }
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.slice(0, limit);
}
class Heap {
  constructor() { this.d = []; this.i = []; }
  get size() { return this.d.length; }
  push(d, i) {
    let k = this.d.length; this.d.push(d); this.i.push(i);
    while (k > 0) { const p = (k - 1) >> 1; if (this.d[p] <= d) break; this.d[k] = this.d[p]; this.i[k] = this.i[p]; k = p; }
    this.d[k] = d; this.i[k] = i;
  }
  pop() {
    const n = this.d.length; const td = this.d[0], ti = this.i[0];
    const ld = this.d.pop(), li = this.i.pop();
    if (n > 1) {
      let k = 0; const m = n - 1;
      while (true) {
        let c = 2 * k + 1; if (c >= m) break;
        if (c + 1 < m && this.d[c + 1] < this.d[c]) c++;
        if (this.d[c] >= ld) break;
        this.d[k] = this.d[c]; this.i[k] = this.i[c]; k = c;
      }
      this.d[k] = ld; this.i[k] = li;
    }
    return [td, ti];
  }
}
function dijkstra(G, factors, src) {
  const dist = new Float64Array(G.n).fill(Infinity); const prev = new Int32Array(G.n).fill(-1);
  const h = new Heap(); dist[src] = 0; h.push(0, src);
  while (h.size) {
    const [d, u] = h.pop(); if (d > dist[u]) continue; if (d > 120000) break;
    const a = G.adj[u];
    for (let k = 0; k < a.length; k += 3) {
      const v = a[k], nd = d + a[k + 1] * factors[a[k + 2]];
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; h.push(nd, v); }
    }
  }
  return { dist, prev };
}

/** Cari rute basecamp -> puncak. Mengembalikan {coords, lenM, startSnap, gap} atau null */
function routeBcToPeak(G, ways, wayBase, bc, peak, viaToks) {
  const factors = wayBase.map((b, wi) => (viaToks.length && ways[wi].n && nameMatch(viaToks, [ways[wi].n])) ? b * 0.5 : b);
  let starts = [];
  for (const rad of [600, 1500, 3000]) {
    const near = nearestNodes(G, bc[0], bc[1], rad, 60);
    for (const c of near) if (starts.every(s => hav(G.lat[s[1]], G.lng[s[1]], G.lat[c[1]], G.lng[c[1]]) > 60)) starts.push(c);
    if (starts.length >= 4) break;
  }
  starts = starts.slice(0, 4);
  let best = null;
  for (const [sd, s] of starts) {
    const { dist, prev } = dijkstra(G, factors, s);
    let end = null;
    for (const rad of [250, 600, 1200, 2500]) {
      const cand = nearestNodes(G, peak[0], peak[1], rad, 400).filter(c => dist[c[1]] < Infinity);
      if (cand.length) { end = cand.reduce((a, b) => (dist[a[1]] + 2 * a[0] <= dist[b[1]] + 2 * b[0] ? a : b)); break; }
    }
    if (!end) continue;
    const score = dist[end[1]] + 2 * end[0] + 3 * sd;
    if (!best || score < best.score) best = { score, prev, s, e: end[1], gap: end[0], sd };
  }
  if (!best) return null;
  const nodes = []; for (let v = best.e; v !== -1; v = best.prev[v]) nodes.push(v);
  nodes.reverse();
  const coords = nodes.map(i => [G.lat[i], G.lng[i]]);
  if (best.sd > 25) coords.unshift([bc[0], bc[1]]);
  if (best.gap > 25) coords.push([peak[0], peak[1]]);
  let lenM = 0; for (let i = 1; i < coords.length; i++) lenM += hav(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  return { coords, lenM, startSnap: best.sd, gap: best.gap };
}

function cumDist(coords) {
  const c = [0];
  for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + hav(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
  return c;
}
function pointAt(coords, cum, d) {
  if (d <= 0) return coords[0]; const L = cum[cum.length - 1]; if (d >= L) return coords[coords.length - 1];
  let i = 1; while (i < cum.length && cum[i] < d) i++;
  const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t];
}
function projectOnRoute(coords, cum, la, ln) {
  let bd = Infinity, bi = 0;
  for (let i = 0; i < coords.length; i++) { const d = hav(la, ln, coords[i][0], coords[i][1]); if (d < bd) { bd = d; bi = i; } }
  return { dist: bd, along: cum[bi] };
}
function simplify(coords, tolM) {
  if (coords.length < 3) return coords;
  const k = Math.cos(coords[0][0] * Math.PI / 180) * 111320, kl = 110540;
  const P = coords.map(p => [p[1] * k, p[0] * kl]);
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
  const st = [[0, P.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, ay] = P[a], [bx, by] = P[b]; const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let t = L2 ? ((P[i][0] - ax) * dx + (P[i][1] - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(P[i][0] - (ax + t * dx), P[i][1] - (ay + t * dy));
      if (d > md) { md = d; mi = i; }
    }
    if (md > tolM && mi !== -1) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return coords.filter((_, i) => keep[i]);
}

// ───────────────────────── Elevasi DEM ─────────────────────────
async function getElevations(pts) {
  const out = new Array(pts.length).fill(null);
  for (let i = 0; i < pts.length; i += 100) {
    const ch = pts.slice(i, i + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${ch.map(p => p[0].toFixed(5)).join(',')}&longitude=${ch.map(p => p[1].toFixed(5)).join(',')}`;
    for (let a = 0; a < 5; a++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (r.status === 429) { await sleep(20000 * (a + 1)); continue; }
        const j = await r.json();
        if (j.elevation) j.elevation.forEach((e, k) => { out[i + k] = e; });
        break;
      } catch (e) { await sleep(5000); }
    }
    await sleep(400);
  }
  return out;
}

// ───────────────────────── Proses satu gunung ─────────────────────────
const BC_FEATURE_OK = f => (f.tags.tourism && /^(camp_site|information|alpine_hut|wilderness_hut|guest_house|hostel)$/.test(f.tags.tourism))
  || (f.tags.amenity && /^(parking|ranger_station|shelter)$/.test(f.tags.amenity));
const POS_FEATURE_OK = f => !f.tags.place && (f.tags.natural || f.tags.tourism || f.tags.amenity);
const SUMMIT_NAME = /puncak|summit|hargo dumilah|mahameru|triangulasi|\btugu\b/i;

async function processMountain(g) {
  const out = { gunung: g.nama, status: 'ok', peak: null, routes: [], notes: [] };
  const peakDb = [g.latitude, g.longitude];
  if (!g.latitude || !g.longitude) { out.status = 'skip-no-coord'; return out; }

  // Bounding box: puncak ± 0.07°, diperluas ke basecamp (maks ±0.14°)
  let s = peakDb[0] - 0.07, n = peakDb[0] + 0.07, w = peakDb[1] - 0.07, e = peakDb[1] + 0.07;
  for (const b of g.basecamps) {
    if (Math.abs(b.latitude - peakDb[0]) > 0.14 || Math.abs(b.longitude - peakDb[1]) > 0.14) continue;
    s = Math.min(s, b.latitude - 0.025); n = Math.max(n, b.latitude + 0.025);
    w = Math.min(w, b.longitude - 0.025); e = Math.max(e, b.longitude + 0.025);
  }
  const bb = [s, w, n, e].map(x => Number(x.toFixed(4)));

  const feats = await fetchFeatures(g.slug, bb);
  const ways = await fetchWays(g.slug, bb);
  const G = buildGraph(ways);
  const wayBase = ways.map(wy => (TRAIL_TYPES.has(wy.t) ? 1.0 : 2.2));
  out.graph = { ways: ways.length, nodes: G.n, feats: feats.length };

  // 1) PUNCAK
  const gToks = toks(g.nama);
  const peakCands = feats.filter(f => (f.tags.natural === 'peak' || /puncak/i.test(f.tags.name || '')) && nameMatch(gToks, featNames(f.tags))
    && hav(peakDb[0], peakDb[1], f.lat, f.lon) <= 6000)
    .map(f => ({ f, rank: f.tags.natural === 'peak' ? 0 : 1, d: hav(peakDb[0], peakDb[1], f.lat, f.lon) }))
    .sort((a, b) => a.rank - b.rank || a.d - b.d);
  let peak = { lat: peakDb[0], lng: peakDb[1], src: 'db' };
  if (peakCands.length) {
    const c = peakCands[0];
    peak = { lat: c.f.lat, lng: c.f.lon, src: 'osm', name: c.f.tags.name, ele: c.f.tags.ele, movedM: Math.round(c.d) };
  }
  out.peak = peak;

  // 2) BASECAMP + 3) ROUTE + 4) POS
  const allPts = []; const refs = [];
  for (const b of g.basecamps) {
    const viaToks = toks(b.jalurVia);
    let bc = { lat: b.latitude, lng: b.longitude, src: 'db', name: null };
    if (viaToks.length) {
      const cands = feats.filter(f => nameMatch(viaToks, featNames(f.tags)) && !f.tags.natural
        && hav(peak.lat, peak.lng, f.lat, f.lon) <= 16000)
        .map(f => ({ f, rank: BC_FEATURE_OK(f) ? 1 : (f.tags.place ? 2 : 9), d: hav(b.latitude, b.longitude, f.lat, f.lon) }))
        .filter(c => c.rank < 9).sort((a, c) => a.rank - c.rank || a.d - c.d);
      if (cands.length) bc = { lat: cands[0].f.lat, lng: cands[0].f.lon, src: 'osm', name: cands[0].f.tags.name };
    }

    const pos = [...b.pos].sort((a, c) => a.urutan - c.urutan);
    let route = routeBcToPeak(G, ways, wayBase, [bc.lat, bc.lng], [peak.lat, peak.lng], viaToks);
    const straight = hav(bc.lat, bc.lng, peak.lat, peak.lng);
    let mode = 'route';
    if (!route || route.gap > 800 || route.startSnap > 1500 || route.lenM / Math.max(straight, 1) > 5) {
      out.notes.push(`${b.jalurVia}: rute OSM tidak meyakinkan` + (route ? ` (gap ${Math.round(route.gap)} m, snap ${Math.round(route.startSnap)} m, rasio ${(route.lenM / Math.max(straight, 1)).toFixed(1)})` : ' (graf tidak terhubung)'));
      route = { coords: [[bc.lat, bc.lng], [peak.lat, peak.lng]], lenM: straight, startSnap: null, gap: null };
      mode = 'straight';
    }
    const cum = cumDist(route.coords); const L = cum[cum.length - 1] || 1;

    // pencocokan pos dengan node OSM bernama
    const fr = new Array(pos.length).fill(null); const srcName = new Array(pos.length).fill(null);
    if (mode === 'route') {
      let lastF = 0.01;
      pos.forEach((p, i) => {
        const pt = toks(p.namaPos);
        if (!pt.length || pt.every(t => viaToks.some(v => tokEq(t, v)))) return;
        let best = null;
        for (const f of feats) {
          if (!POS_FEATURE_OK(f) || !nameMatch(pt, featNames(f.tags))) continue;
          const pr = projectOnRoute(route.coords, cum, f.lat, f.lon);
          if (pr.dist <= 250 && (!best || pr.dist < best.dist)) best = { ...pr, f };
        }
        if (best) {
          const ff = best.along / L;
          if (ff > lastF + 0.005 && ff < 0.995) { fr[i] = ff; srcName[i] = best.f.tags.name; lastF = ff; }
        }
      });
    }
    pos.forEach((p, i) => { if (fr[i] === null && i === pos.length - 1 && SUMMIT_NAME.test(p.namaPos)) { fr[i] = 1; srcName[i] = 'puncak'; } });
    // interpolasi sisanya di antara jangkar
    let i = 0;
    while (i < pos.length) {
      if (fr[i] !== null) { i++; continue; }
      let j = i; while (j < pos.length && fr[j] === null) j++;
      const a = i === 0 ? 0 : fr[i - 1]; const bnd = j === pos.length ? 1 : fr[j]; const m = j - i;
      for (let k = 0; k < m; k++) fr[i + k] = a + (bnd - a) * (k + 1) / (m + 1);
      i = j;
    }
    const posOut = pos.map((p, k) => {
      const pt = pointAt(route.coords, cum, fr[k] * L);
      return { id: p.id, lat: Number(pt[0].toFixed(6)), lng: Number(pt[1].toFixed(6)), osmName: srcName[k], summit: fr[k] === 1 };
    });

    const rec = { bc: b, bcOut: bc, mode, route, posOut, matched: srcName.filter(Boolean).length, viaToks };
    refs.push(rec);
    allPts.push([bc.lat, bc.lng]); posOut.forEach(p => allPts.push([p.lat, p.lng]));
    out.routes.push({
      via: b.jalurVia, bcSrc: bc.src, bcName: bc.name, mode, routeKm: Number((route.lenM / 1000).toFixed(2)),
      startSnapM: route.startSnap === null ? null : Math.round(route.startSnap), gapM: route.gap === null ? null : Math.round(route.gap),
      posTotal: pos.length, posMatchedOsm: rec.matched
    });
  }

  // 5) ELEVASI DEM
  allPts.push([peak.lat, peak.lng]);
  const ele = await getElevations(allPts);
  const peakDem = ele[ele.length - 1];
  out.peak.demElev = peakDem; out.peak.ketinggianDb = g.ketinggian;
  let pi = 0;
  for (const rc of refs) {
    const bcEle = ele[pi++]; rc.bcElev = bcEle === null ? rc.bc.elevasi : Math.round(Math.min(bcEle, g.ketinggian));
    let run = rc.bcElev;
    rc.posOut.forEach(p => {
      const e = ele[pi++];
      let v = e === null ? null : Math.round(Math.min(e, g.ketinggian));
      if (p.summit) v = g.ketinggian;
      if (v === null) { p.elev = null; return; }
      run = Math.max(run, v); p.elev = run;
    });
  }

  // ── TULIS DATABASE
  if (!DRY) {
    if (peak.src === 'osm') await prisma.gunung.update({ where: { id: g.id }, data: { latitude: Number(peak.lat.toFixed(6)), longitude: Number(peak.lng.toFixed(6)) } });
    for (const rc of refs) {
      const geo = rc.mode === 'route' ? JSON.stringify(simplify(rc.route.coords, 6).map(p => [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))])) : null;
      const sumber = `Basecamp: ${rc.bcOut.src === 'osm' ? 'node OSM "' + rc.bcOut.name + '"' : 'koordinat database (tidak ada node OSM bernama sama)'}; ` +
        (rc.mode === 'route' ? `Jalur: routing jaringan OSM ${(rc.route.lenM / 1000).toFixed(2)} km` : 'Jalur: estimasi garis lurus (data jalur OSM tidak lengkap)') + '; Elevasi: DEM Copernicus 90 m';
      await prisma.basecamp.update({ where: { id: rc.bc.id }, data: { latitude: Number(rc.bcOut.lat.toFixed(6)), longitude: Number(rc.bcOut.lng.toFixed(6)), elevasi: rc.bcElev, sumber } });
      await prisma.$executeRaw`UPDATE Basecamp SET jalurGeo = ${geo} WHERE id = ${rc.bc.id}`;
      for (const p of rc.posOut) {
        const data = { latitude: p.lat, longitude: p.lng,
          sumber: p.osmName ? `Node OSM "${p.osmName}"` : (rc.mode === 'route' ? 'Estimasi berurutan di sepanjang jalur OSM' : 'Estimasi garis lurus BC-Puncak') };
        if (p.elev !== null && p.elev !== undefined) data.elevasi = p.elev;
        await prisma.posGunung.update({ where: { id: p.id }, data });
      }
    }
  }
  return out;
}

async function main() {
  log(DRY ? 'MODE SIMULASI (database tidak diubah)' : 'MODE TULIS DATABASE');
  const list = await prisma.gunung.findMany({ include: { basecamps: { include: { pos: true } } }, orderBy: { nama: 'asc' } });
  const targets = list.filter(g => !ONLY.length || ONLY.some(o => g.nama.toLowerCase().includes(o)));
  const reportFile = path.join(CACHE, DRY ? 'report-dry.json' : 'report.json');
  const report = [];
  let idx = 0;
  for (const g of targets) {
    idx++;
    try {
      log(`(${idx}/${targets.length}) ${g.nama} ...`);
      const r = await processMountain(g);
      report.push(r);
      const rt = r.routes.map(x => `${x.via}:${x.mode === 'route' ? x.routeKm + 'km' : 'LURUS'}${x.bcSrc === 'osm' ? '+bcOSM' : ''}${x.posMatchedOsm ? '+' + x.posMatchedOsm + 'pos' : ''}`).join(' | ');
      log(`   puncak=${r.peak && r.peak.src}${r.peak && r.peak.movedM !== undefined ? '(geser ' + r.peak.movedM + ' m)' : ''} DEM=${r.peak && r.peak.demElev}/${g.ketinggian} :: ${rt}`);
    } catch (err) {
      log(`   GAGAL ${g.nama}: ${err.message}`);
      report.push({ gunung: g.nama, status: 'error', error: err.message });
    }
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
  }
  const ok = report.filter(r => r.status === 'ok');
  const routes = ok.flatMap(r => r.routes);
  log('================ RINGKASAN ================');
  log(`Gunung diproses : ${ok.length}/${targets.length} (error: ${report.filter(r => r.status === 'error').length})`);
  log(`Puncak dari OSM : ${ok.filter(r => r.peak.src === 'osm').length}`);
  log(`Jalur           : ${routes.length} | rute OSM nyata: ${routes.filter(r => r.mode === 'route').length} | garis lurus: ${routes.filter(r => r.mode === 'straight').length}`);
  log(`Basecamp OSM    : ${routes.filter(r => r.bcSrc === 'osm').length}`);
  log(`Pos cocok OSM   : ${routes.reduce((a, r) => a + r.posMatchedOsm, 0)}/${routes.reduce((a, r) => a + r.posTotal, 0)}`);
  log('Laporan: ' + reportFile);
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });

