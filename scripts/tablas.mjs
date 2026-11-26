// =====================================================================
//  DIMAYOR · Tablas de posiciones y cruces oficiales -> tablas.json
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
// Qué se muestra de cada competencia:
//   "posiciones"      = la fase en curso: como TABLA o como CRUCE (llaves) según "cruces"
//   "reclasificacion" = tabla de reclasificación (siempre)
//   "descenso"        = tabla de descenso / promedios (siempre)
//   "resultados"      = marcadores de la última fecha + resumen (solo si la fase es TABLA) · no se usa por ahora (lo pidió el Área Deportiva)
//   "goleadores"      = top 10 de goleadores de la competencia (toda la temporada)
// Además, las tablas de posiciones y reclasificación llevan la RACHA de cada equipo (últimos 5 partidos).
// "cruces": fases que se muestran como CRUCE (llaves armadas con los partidos de esa fase).
//   Se escribe el número de la fase como aparece en dimayor.com.co ("FASE III", "FASE 1B" -> "III", "1B").
//   Las demás fases se muestran como TABLA. "todas" = todas las fases como cruce.
const COMPETENCIAS = [
  { id: "liga",      tipo: "Liga BetPlay",   tablas: ["posiciones", "reclasificacion", "descenso", "goleadores"], cruces: ["III", "IV", "V"] },
  { id: "torneo",    tipo: "Torneo BetPlay", tablas: ["posiciones", "reclasificacion", "goleadores"],             cruces: ["III", "IV", "V"] },
  { id: "femenina",  tipo: "Liga Femenina",  tablas: ["posiciones", "goleadores"],                                cruces: ["III", "IV"] },
  { id: "copa",      tipo: "Copa BetPlay",   tablas: ["posiciones", "goleadores"],                                cruces: ["1B", "II", "III", "IV", "V"] },
  { id: "superliga", tipo: "Superliga",      tablas: ["posiciones", "goleadores"],                                              cruces: "todas" }
];
// "actual" = solo la fase EN CURSO (la misma que dimayor.com.co muestra por defecto), aunque tenga 2 equipos
//            (una final). Si esa fase todavía no tiene ningún partido jugado (todo en 0), se muestra la anterior.
// "todas"  = una tabla por cada fase que tenga partidos jugados (de la más reciente a la más antigua)
const FASES = "actual";
// Un cruce que todavía no se ha jugado pero ya tiene los equipos definidos (ej. la final ya sorteada):
//   true = se muestra con las fechas de los partidos · false = se muestra la fase anterior hasta que se juegue
const CRUCE_SIN_JUGAR = true;
const RACHA = 5;          // partidos de la racha (últimos N)
const TOP_GOLEADORES = 10;
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

// Código de la fase: "FASE 1B" -> "1B", "FASE III - FINAL" -> "III" (sin "FASE" -> "")
function codigoFase(nombre) {
  const m = String(nombre).match(/FASE\s+([IVX]+|\d+)\s*([AB])?\b/i);
  return m ? (m[1] + (m[2] || "")).toUpperCase() : "";
}
const esCruce = (T, fase) => T.cruces === "todas" || (T.cruces || []).includes(codigoFase(fase.name));

// <<partidos  (lectura de la pestaña "Partidos" y armado de las llaves)
const MESES_ES = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };
const DIAS_CORTOS = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
const MESES_CORTOS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
function leerPartidos(html) {
  const partidos = [];
  let fecha = "";
  const re = /<h4 class="fixture-date-header">([\s\S]*?)<\/h4>|<div class="match-card">([\s\S]*?)(?=<h[34] class="fixture-|<div class="match-card">|$)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] != null) { fecha = limpio(m[1]); continue; }
    const c = m[2];
    const lado = (cls) => (c.match(new RegExp('team--' + cls + '"[\\s\\S]*?(?=<div class="(?:match-card__score-wrapper|team team--)|$)')) || [""])[0];
    const casa = lado("home"), visita = lado("away");
    const eqL = limpio((casa.match(/team__name">([\s\S]*?)</) || [])[1]);
    const eqV = limpio((visita.match(/team__name">([\s\S]*?)</) || [])[1]);
    if (!eqL || !eqV) continue;
    const score = c.match(/class="match-card__score(?:\s+([^"]*))?">([\s\S]*?)<\/div>/) || [];
    const clase = (score[1] || "").trim().toLowerCase(), marcador = limpio(score[2]);
    const g = marcador.match(/(\d+)\s*-\s*(\d+)/);
    const pen = limpio((c.match(/penalties-score">([\s\S]*?)</) || [])[1]).match(/(\d+)\s*-\s*(\d+)/);
    const f = sinTildes(fecha).match(/(\d{1,2}) DE ([A-Z]+) DE (\d{4})/);
    const mes = f ? MESES_ES[f[2]] : 0;
    const hora = limpio((c.match(/match-card__time">([\s\S]*?)</) || [])[1]);
    const d = f && mes ? new Date(Date.UTC(+f[3], mes - 1, +f[1])) : null;
    const tbd = (n) => /^tbd$/i.test(n) ? "Por definir" : n;
    partidos.push({
      local: tbd(eqL), visitante: tbd(eqV),
      logoL: /^tbd$/i.test(eqL) ? "" : logoDe(casa), logoV: /^tbd$/i.test(eqV) ? "" : logoDe(visita),
      etapa: limpio((c.match(/match-leg-badge[^"]*">([\s\S]*?)</) || [])[1]).toUpperCase(),
      fecha: d ? d.toISOString().slice(0, 10) + " " + (hora || "00:00") : "",
      dia: d ? `${DIAS_CORTOS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES_CORTOS[mes - 1]}` : "",
      hora,
      estado: clase === "finalizado" ? "fin" : (g && clase !== "programado") ? "vivo" : "prog",
      texto: g ? "" : marcador,
      gl: g ? +g[1] : null, gv: g ? +g[2] : null,
      pl: pen ? +pen[1] : null, pv: pen ? +pen[2] : null
    });
  }
  return partidos;
}
// Junta los partidos de cada pareja (ida y vuelta), suma el global y define quién pasa
function armarLlaves(partidos) {
  const mapa = new Map(), llaves = [];
  partidos.forEach((p, i) => {
    const porDefinir = p.local === "Por definir" || p.visitante === "Por definir";
    const k = porDefinir ? "pd" + i : [p.local, p.visitante].map(sinTildes).sort().join("|");
    let L = mapa.get(k);
    if (!L) { L = { a: p.local, b: p.visitante, logoA: p.logoL, logoB: p.logoV, partidos: [] }; mapa.set(k, L); llaves.push(L); }
    const aCasa = p.local === L.a;
    L.partidos.push({ etapa: p.etapa, fecha: p.fecha, dia: p.dia, hora: p.hora, estado: p.estado, texto: p.texto, casa: aCasa ? "a" : "b",
                      ga: aCasa ? p.gl : p.gv, gb: aCasa ? p.gv : p.gl, pa: aCasa ? p.pl : p.pv, pb: aCasa ? p.pv : p.pl });
  });
  for (const L of llaves) {
    L.partidos.sort((x, y) => (x.etapa === "VUELTA") - (y.etapa === "VUELTA") || x.fecha.localeCompare(y.fecha));
    const jugados = L.partidos.filter((p) => p.estado !== "prog");
    L.ga = jugados.reduce((s, p) => s + p.ga, 0);
    L.gb = jugados.reduce((s, p) => s + p.gb, 0);
    const ult = L.partidos[L.partidos.length - 1];
    L.pa = ult && ult.pa != null ? ult.pa : null;
    L.pb = ult && ult.pb != null ? ult.pb : null;
    L.estado = !jugados.length ? "prog" : jugados.length === L.partidos.length && jugados.every((p) => p.estado === "fin") ? "fin" : "curso";
    L.ganador = null;
    if (L.estado === "fin") {
      if (L.ga !== L.gb) L.ganador = L.ga > L.gb ? "a" : "b";
      else if (L.pa != null && L.pa !== L.pb) L.ganador = L.pa > L.pb ? "a" : "b";
    }
  }
  return llaves;
}
// partidos>>

// <<goleadores
// Nombre del jugador: dimayor lo publica "APELLIDO NOMBRE" en mayúsculas -> "Nombre Apellido"
function nombreJugador(s) {
  const minus = ["DE", "DEL", "LA", "LAS", "LOS", "Y"];
  const t = limpio(s).split(" ").filter(Boolean);
  const orden = t.length > 1 ? [t[t.length - 1], ...t.slice(0, -1)] : t;
  return orden.map((w, i) => i && minus.includes(w.toUpperCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
// Equipo del goleador ("ATL. NACIONAL", "IND SANTA FE", "BOCA JRS.") -> nombre completo y escudo de los partidos
const ABREV = { ATL: "ATLETICO", IND: "INDEPENDIENTE", JRS: "JUNIORS", JR: "JUNIOR", DEP: "DEP", DVO: "DEPORTIVO", INTER: "INTERNACIONAL", R: "REAL" };
const RELLENO = new Set(["FC", "F", "C", "CF", "SA", "DAF", "CLUB", "DE", "S"]);
const fichas = (s) => sinTildes(s).replace(/[^A-Z0-9 ]+/g, " ").split(" ").filter((w) => w && !RELLENO.has(w)).map((w) => ABREV[w] || w);
function buscarEquipo(nombre, equipos) {
  const q = fichas(nombre);
  let mejor = null, sobra = 99;
  for (const e of equipos) {
    const c = fichas(e.nombre);
    if (!q.every((w) => c.some((x) => x.startsWith(w)))) continue;
    const extra = c.length - q.length;
    if (extra < sobra) { mejor = e; sobra = extra; }
  }
  return mejor;
}
function leerGoleadores(html, equipos) {
  const filas = [];
  for (const m of html.matchAll(/<tr class="[^"]*dimayor-player-clickable[^"]*"[\s\S]*?<\/tr>/g)) {
    const tr = m[0];
    const equiposTd = [...tr.matchAll(/<td class="col-team">([\s\S]*?)<\/td>/g)].map((x) => x[1]);
    const jugador = limpio((tr.match(/team-name-small">([\s\S]*?)</) || [])[1]);
    const club = limpio(equiposTd[1] || "");
    const goles = num((tr.match(/col-pts">([\s\S]*?)<\/td>/) || [])[1]);
    if (!jugador || !goles) continue;
    const e = buscarEquipo(club, equipos);
    filas.push({ jugador: nombreJugador(jugador), equipo: e ? e.nombre : club.toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase()),
                 logo: e ? e.logo : "", foto: logoDe(equiposTd[0] || ""), goles });
  }
  filas.sort((a, b) => b.goles - a.goles);
  // puesto compartido cuando empatan en goles (1, 2, 2, 4...)
  filas.forEach((f, i) => { f.pos = i && f.goles === filas[i - 1].goles ? filas[i - 1].pos : i + 1; });
  const top = filas.slice(0, TOP_GOLEADORES);
  // jugadores que quedaron por fuera del top con los mismos goles que el último (ej. "y 12 más con 3 goles")
  const ult = top[top.length - 1];
  return { filas: top, mas: ult ? filas.slice(TOP_GOLEADORES).filter((f) => f.goles === ult.goles).length : 0 };
}
// Racha: últimos N partidos terminados de cada equipo ("g" ganó, "e" empató, "p" perdió), del más viejo al más reciente
function rachas(partidos) {
  const r = new Map();
  partidos.filter((p) => p.estado === "fin" && p.gl != null).sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach((p) => {
    const add = (eq, a, b) => { const k = sinTildes(eq); if (!r.has(k)) r.set(k, []); r.get(k).push(a > b ? "g" : a < b ? "p" : "e"); };
    add(p.local, p.gl, p.gv); add(p.visitante, p.gv, p.gl);
  });
  for (const [k, v] of r) r.set(k, v.slice(-RACHA));
  return r;
}
// goleadores>>

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
    // partidos de cada fase (se piden una sola vez): sirven para los cruces, la racha, los resultados y los escudos de los goleadores
    const cachePartidos = new Map();
    const partidosDe = async (faseId, md = "0") => {
      const k = faseId + "|" + md;
      if (!cachePartidos.has(k)) cachePartidos.set(k, leerPartidos((await contenido("partidos", faseId, md)).data?.html || ""));
      return cachePartidos.get(k);
    };
    let faseTabla = null;   // fase que se mostró como TABLA (para los resultados de la última fecha)
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
          let bloque, valido, total, n;
          if (esCruce(T, f)) {
            // CRUCE: llaves armadas con los partidos de la fase (jornada 0 = todos los partidos)
            const llaves = armarLlaves(await partidosDe(f.id));
            n = llaves.reduce((a, l) => a + l.partidos.filter((p) => p.estado !== "prog").length, 0);
            const definidas = llaves.filter((l) => l.a !== "Por definir" && l.b !== "Por definir").length;
            total = llaves.length;
            valido = n > 0 || (CRUCE_SIN_JUGAR && definidas > 0);
            bloque = { tipo: "cruce", fase: f.name, actual: esActual, llaves };
            console.log(`  ${T.id} · cruce · ${f.name}: ${total} llave(s), ${n} partido(s) jugado(s)`);
          } else {
            const md = esActual ? matchday : f.matchdays;
            const grupos = leerGrupos((await contenido("posiciones", f.id, md)).data?.html || "", true);
            n = jugados(grupos);
            total = grupos.reduce((a, g) => a + g.filas.length, 0);
            valido = n > 0;
            bloque = { tipo: "posiciones", fase: f.name, actual: esActual, grupos };
            console.log(`  ${T.id} · tabla · ${f.name}: ${grupos.length} grupo(s), ${total} equipos, ${n} con partidos`);
          }
          if (FASES === "actual") {
            if (valido) { bloques.push(bloque); respaldo = null; if (bloque.tipo === "posiciones") faseTabla = { f, md: esActual ? matchday : f.matchdays }; break; }
            if (!respaldo && total > 0) respaldo = bloque;
            console.log(`    sin partidos jugados: se busca la fase anterior`);
          } else if (esActual ? total > 0 : (bloque.tipo === "cruce" ? n > 0 : n >= MIN_EQUIPOS)) {
            bloques.push(bloque);
          }
        }
        // si ninguna fase tiene partidos (ej. inicio de temporada), se muestra la fase en curso en 0
        if (respaldo) bloques.push(respaldo);
      } else if (tab === "resultados") {
        // marcadores de la última fecha de la fase que salió como TABLA (si la fase en curso es un cruce, el cruce ya los muestra)
        if (!faseTabla) continue;
        let md = parseInt(faseTabla.md, 10) || 0, ps = [];
        while (md > 0) {
          ps = await partidosDe(faseTabla.f.id, String(md));
          if (ps.some((p) => p.estado !== "prog")) break;   // la fecha en curso todavía no empieza: se muestra la anterior
          md--;
        }
        const n = ps.filter((p) => p.estado !== "prog").length;
        console.log(`  ${T.id} · resultados · fecha ${md}: ${ps.length} partido(s), ${n} jugado(s)`);
        if (md > 0 && n) bloques.push({ tipo: "resultados", fase: faseTabla.f.name, fecha: md,
          partidos: ps.map(({ local, visitante, logoL, logoV, dia, hora, fecha, estado, texto, gl, gv }) => ({ local, visitante, logoL, logoV, dia, hora, fecha, estado, texto, gl, gv })) });
      } else if (tab === "goleadores") {
        // escudos: se buscan en los partidos de todas las fases de la competencia
        const equipos = new Map();
        for (const f of fases) for (const p of await partidosDe(f.id)) {
          if (p.local !== "Por definir") equipos.set(p.local, { nombre: p.local, logo: p.logoL });
          if (p.visitante !== "Por definir") equipos.set(p.visitante, { nombre: p.visitante, logo: p.logoV });
        }
        const { filas, mas } = leerGoleadores((await contenido("goleadores", phase_id, matchday)).data?.html || "", [...equipos.values()]);
        console.log(`  ${T.id} · goleadores: ${filas.length}` + (filas[0] ? ` (líder ${filas[0].jugador}, ${filas[0].goles})` : ""));
        if (filas.length) bloques.push({ tipo: "goleadores", filas, mas });
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
    // RACHA en las tablas de posiciones y reclasificación (partidos de todas las fases de la competencia)
    const todos = [];
    for (const f of fases) todos.push(...await partidosDe(f.id));
    const R = rachas(todos);
    for (const b of bloques) if (b.tipo === "posiciones" || b.tipo === "reclasificacion")
      for (const g of b.grupos) for (const fila of g.filas) { const r = R.get(sinTildes(fila.equipo)); if (r && r.length) fila.racha = r; }
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
