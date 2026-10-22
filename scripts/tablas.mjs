// =====================================================================
//  DIMAYOR · Tablas de posiciones oficiales -> tablas.json
//  Lo ejecuta cada hora el contenedor "tablas-dimayor" del servidor Docker de DIMAYOR
//  (dimayor.com.co bloquea los servidores de GitHub, por eso no corre en GitHub Actions).
//  Lee dimayor.com.co, arma tablas.json y lo sube al repositorio con la API de GitHub,
//  solo si cambió. Variables: GITHUB_TOKEN y GITHUB_REPO (usuario/repositorio).
// =====================================================================
const REPO = process.env.GITHUB_REPO || "Dimayor-Colombia/Pantallas-Dimayor";
const TOKEN = process.env.GITHUB_TOKEN || "";
const ARCHIVO = "tablas.json";
const GH = { "Authorization": "Bearer " + TOKEN, "Accept": "application/vnd.github+json", "User-Agent": "tablas-dimayor" };

async function leerAnterior() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${ARCHIVO}`, { headers: GH });
  if (r.status === 404) return { sha: null, data: { competencias: [] } };
  if (!r.ok) throw new Error("GitHub HTTP " + r.status + " al leer " + ARCHIVO + " (revisa el token)");
  const j = await r.json();
  return { sha: j.sha, data: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")) };
}
async function guardar(texto, sha) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${ARCHIVO}`, {
    method: "PUT", headers: { ...GH, "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Actualizar tablas de posiciones", content: Buffer.from(texto, "utf8").toString("base64"), ...(sha ? { sha } : {}) })
  });
  if (!r.ok) throw new Error("GitHub HTTP " + r.status + " al guardar: " + (await r.text()).slice(0, 200));
}
if (!TOKEN) { console.log("Falta la variable GITHUB_TOKEN"); process.exit(1); }
console.log(new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }) + " · actualizando tablas");

// ===================== CONFIGURACIÓN =====================
// Qué tablas se muestran de cada competencia (posiciones | reclasificacion | descenso)
const COMPETENCIAS = [
  { id: "liga",     tipo: "Liga BetPlay",   tablas: ["posiciones", "reclasificacion", "descenso"] },
  { id: "torneo",   tipo: "Torneo BetPlay", tablas: ["posiciones", "reclasificacion"] },
  { id: "femenina", tipo: "Liga Femenina",  tablas: ["posiciones"] },
  { id: "copa",     tipo: "Copa BetPlay",   tablas: ["posiciones"] }
];
// "actual" = solo la fase EN CURSO (la misma que dimayor.com.co muestra por defecto), aunque tenga 2 equipos
//            (una final). Si esa fase todavía no tiene ningún partido jugado (todo en 0), se muestra la anterior.
// "todas"  = una tabla por cada fase que tenga partidos jugados (de la más reciente a la más antigua)
const FASES = "actual";
const MIN_EQUIPOS = 4;   // mínimo de equipos con partidos para la reclasificación, el descenso y el modo "todas"
// ==========================================================

const BASE = "https://dimayor.com.co";
const AJAX = BASE + "/wp-admin/admin-ajax.php";
// Se identifica como un navegador Chrome normal (los firewalls suelen bloquear nombres raros)
const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  "Referer": "https://dimayor.com.co/"
};
let cookies = "";
async function pedir(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}), ...(cookies ? { Cookie: cookies } : {}) },
                              signal: AbortSignal.timeout(60000) });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookies = sc.map((c) => c.split(";")[0]).join("; ");
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return r.text();
}
async function ajax(campos) {
  const t = await pedir(AJAX, { method: "POST", body: new URLSearchParams(campos),
                                headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  return JSON.parse(t.replace(/^﻿/, ""));
}
const limpio = (s) => String(s || "").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
const num = (s) => { const n = parseInt(limpio(s).replace("+", ""), 10); return Number.isNaN(n) ? 0 : n; };
const esTBD = (f) => /^tbd$/i.test(f.equipo);
const celdas = (tr) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
const logoDe = (td) => (((td || "").match(/<img[^>]+src="([^"]+)"/i) || [])[1] || "").replace(/^http:\/\//, "https://");
const filasDe = (tabla) => [...((tabla.match(/<tbody[\s\S]*?<\/tbody>/i) || [tabla])[0]).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => celdas(m[1]));

// Tabla de posiciones normal (las columnas se ubican por su título). Devuelve los grupos con su nombre.
function leerGrupos(html, conPorDefinir) {
  const grupos = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m, desde = 0;
  while ((m = re.exec(html))) {
    const antes = html.slice(desde, m.index);
    const titulos = [...antes.matchAll(/class="[^"]*dimayor-group-title[^"]*"[^>]*>([\s\S]*?)<\//gi)];
    const nombre = titulos.length ? limpio(titulos[titulos.length - 1][1]) : "";
    desde = m.index + m[0].length;
    const t = m[0];
    const head = [...t.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((x) => limpio(x[1]).toUpperCase());
    const col = (...n) => head.findIndex((h) => n.includes(h));
    const C = { pos: col("#", "POS"), eq: col("EQUIPO"), pts: col("PT", "PTS"), pj: col("PJ"), g: col("PG"), e: col("PE"),
                p: col("PP"), gf: col("GF"), gc: col("GC"), dg: col("DG") };
    const filas = filasDe(t).filter((td) => td.length >= 5).map((td) => ({
      pos: num(td[C.pos]), equipo: limpio(td[C.eq]), logo: logoDe(td[C.eq]),
      pj: num(td[C.pj]), g: num(td[C.g]), e: num(td[C.e]), p: num(td[C.p]),
      gf: num(td[C.gf]), gc: num(td[C.gc]), dg: num(td[C.dg]), pts: num(td[C.pts])
    })).filter((f) => f.equipo && (conPorDefinir || !esTBD(f)))
       .map((f) => esTBD(f) ? { ...f, equipo: "Por definir", logo: "" } : f);
    if (filas.length) grupos.push({ nombre, filas });
  }
  return grupos;
}

// Tabla de descenso: #, equipo, (PJ, PTS) por cada año, totales PJ, PTS y PRO (promedio)
function leerDescenso(html) {
  const t = (html.match(/<table[\s\S]*?<\/table>/i) || [""])[0];
  const anios = [...t.matchAll(/<th[^>]*year-header[^>]*>([\s\S]*?)<\/th>/gi)].map((x) => limpio(x[1]));
  const filas = filasDe(t).filter((td) => td.length >= 5).map((td) => {
    const n = td.length;
    return {
      pos: num(td[0]), equipo: limpio(td[1]), logo: logoDe(td[1]),
      anios: anios.map((_, i) => ({ pj: num(td[2 + i * 2]), pts: num(td[3 + i * 2]) })),
      pj: num(td[n - 3]), pts: num(td[n - 2]), pro: limpio(td[n - 1])
    };
  }).filter((f) => f.equipo && !esTBD(f));
  return { anios, filas };
}

// Orden de las fases: "FASE 1A" = 1, "FASE 1B" = 1.1, "FASE II" = 2, "FASE IV - FINAL" = 4 ...
const ROMANOS = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
function numeroFase(nombre, i) {
  const m = String(nombre).match(/FASE\s+([IVX]+|\d+)\s*([AB])?\b/i);
  if (!m) return i / 100;
  const n = ROMANOS[m[1].toUpperCase()] || parseInt(m[1], 10) || 0;
  return n + (m[2] && m[2].toUpperCase() === "B" ? 0.1 : 0);
}
const jugados = (grupos) => grupos.reduce((a, g) => a + g.filas.filter((f) => f.pj > 0).length, 0);

// 1) Página de inicio: clave de seguridad (nonce) y temporada actual
const inicio = await pedir(BASE + "/");
const nonce = (inicio.match(/nonce\s*=\s*"([^"]+)"/) || [])[1];
const season = (inicio.match(/class="season-filter">\s*<option value="(\d+)"/) || [])[1];
if (!nonce || !season) { console.log("No se encontró nonce/temporada en dimayor.com.co; no se cambia nada"); process.exit(0); }
console.log(`nonce=${nonce} temporada=${season}`);

const previo = await leerAnterior();
const anterior = previo.data;
const salida = [];
for (const T of COMPETENCIAS) {
  const prev = (anterior.competencias || []).find((c) => c.id === T.id);
  try {
    // 2) Competencia y fase vigentes
    const act = await ajax({ action: "get_active_filters", nonce, season_id: season, competition_type: T.tipo });
    if (!act.success || !act.data?.competition_id) throw new Error("sin competencia activa");
    const { competition_id, phase_id, matchday } = act.data;
    const comps = await ajax({ action: "get_competitions_for_season_ajax_v5", nonce, season_id: season, competition_type: T.tipo });
    const fasesResp = await ajax({ action: "get_phases_for_competition", nonce, competition_id });
    const nombreComp = (comps.data || []).find((c) => String(c.id) === String(competition_id))?.name || T.tipo;
    let fases = (fasesResp.data || []).map((f, i) => ({ ...f, orden: numeroFase(f.name, i) }));
    fases.sort((a, b) => b.orden - a.orden);   // la más reciente primero

    const contenido = (type, fase, md) => ajax({ action: "get_dynamic_content_v5", nonce, type, competition_id, competition_type: T.tipo,
                                                 phase_id: fase, matchday: md ?? "", is_live: "0", live_provider: "comet" });
    const bloques = [];
    for (const tab of T.tablas) {
      if (tab === "posiciones") {
        // fase en curso: la que dimayor.com.co marca como activa (si no aparece en la lista, la más reciente)
        const enCurso = fases.find((f) => String(f.id) === String(phase_id)) || fases[0];
        // en modo "actual" se revisa la fase en curso y, si está toda en 0, las anteriores (de la más reciente hacia atrás)
        const lista = FASES === "actual" ? (enCurso ? fases.slice(fases.indexOf(enCurso)) : []) : fases;
        let respaldo = null;
        for (const f of lista) {
          const esActual = String(f.id) === String(phase_id);
          const md = esActual ? matchday : f.matchdays;
          const grupos = leerGrupos((await contenido("posiciones", f.id, md)).data?.html || "", true);
          const n = jugados(grupos);
          const total = grupos.reduce((a, g) => a + g.filas.length, 0);
          console.log(`  ${T.id} · posiciones · ${f.name}: ${grupos.length} grupo(s), ${total} equipos, ${n} con partidos`);
          if (FASES === "actual") {
            if (n > 0) { bloques.push({ tipo: "posiciones", fase: f.name, actual: esActual, grupos }); respaldo = null; break; }
            if (!respaldo && total > 0) respaldo = { tipo: "posiciones", fase: f.name, actual: esActual, grupos };
            console.log(`    sin partidos jugados: se busca la fase anterior`);
          } else if (esActual ? total > 0 : n >= MIN_EQUIPOS) {
            bloques.push({ tipo: "posiciones", fase: f.name, actual: esActual, grupos });
          }
        }
        // si ninguna fase tiene partidos (ej. inicio de temporada), se muestra la fase en curso en 0
        if (respaldo) bloques.push(respaldo);
      } else if (tab === "reclasificacion") {
        const grupos = leerGrupos((await contenido("reclasificacion", phase_id, matchday)).data?.html || "")
          .map((g) => ({ ...g, filas: g.filas.filter((f) => f.pj > 0) }));
        const n = jugados(grupos);
        console.log(`  ${T.id} · reclasificación: ${n} equipos con partidos`);
        if (n >= MIN_EQUIPOS) bloques.push({ tipo: "reclasificacion", grupos });
      } else if (tab === "descenso") {
        const d = leerDescenso((await contenido("descenso", phase_id, matchday)).data?.html || "");
        console.log(`  ${T.id} · descenso: ${d.filas.length} equipos (${d.anios.join(", ")})`);
        if (d.filas.length >= MIN_EQUIPOS) bloques.push({ tipo: "descenso", ...d });
      }
    }
    if (!bloques.length) { console.log(`${T.id}: sin tablas para mostrar`); continue; }
    // la fecha solo cambia si cambiaron los datos (así no se guarda cada hora sin motivo)
    const igual = prev && JSON.stringify(prev.bloques) === JSON.stringify(bloques) && prev.competicion === nombreComp;
    salida.push({ id: T.id, competicion: nombreComp, fuente: "dimayor.com.co",
                  actualizado: igual ? prev.actualizado : new Date().toISOString(), bloques });
    console.log(`${T.id}: ${nombreComp} · ${bloques.length} tabla(s)${igual ? " · sin cambios" : " · ACTUALIZADA"}`);
  } catch (e) {
    console.log(`${T.id}: ERROR ${e.message} · se conserva la tabla anterior`);
    if (prev && prev.bloques) salida.push(prev);
  }
}
if (!salida.length) { console.log("Ninguna tabla disponible; no se cambia el archivo"); process.exit(0); }
const nuevo = JSON.stringify({ competencias: salida }, null, 1) + "\n";
if (nuevo === JSON.stringify(anterior, null, 1) + "\n") console.log("Sin cambios: no se sube nada");
else { await guardar(nuevo, previo.sha); console.log("tablas.json actualizado en GitHub"); }
