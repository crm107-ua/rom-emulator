#!/usr/bin/env python3
"""
ROM Manager Web UI  —  Multi-provider interface
Proveedores: coolrom.com · romsfun.com
Ejecutar:   python web_app.py
Abrir:      http://localhost:5000
"""

import sys, os, re
from html import unescape as hu
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, jsonify, request, render_template_string, Response, stream_with_context
import requests as req_lib

# CoolROM connector
from api_client import (
    create_session  as coolrom_session,
    RomLink,
    list_roms_for_system,
    warm_session as coolrom_warm,
    session_get as coolrom_get,
    BASE_URL as COOLROM_URL,
    SYSTEMS  as COOLROM_SYSTEMS,
    PROVIDER as COOLROM_PROVIDER,
    _extract_image_from_html,
)

# Romsfun connector
import romsfun_connector as rf

from urllib.parse import unquote

import system_map
import emulators as emu_catalog
import jobs as download_jobs

app = Flask(__name__)

# Una sesión por proveedor (reutilizable)
SESSION_COOLROM  = coolrom_session()
SESSION_ROMSFUN  = rf.create_session()
try:
    coolrom_warm(SESSION_COOLROM)
except Exception:
    pass

# ── listas de sistemas para la UI ────────────────────────────────────────────
COOLROM_SYS_LIST = sorted(COOLROM_SYSTEMS.items(), key=lambda x: x[1])
ROMSFUN_SYS_LIST = sorted(rf.SYSTEMS.items(),       key=lambda x: x[1])

# Lista unificada sin duplicados para el modo "Todos"
# Estrategia: por cada nombre de plataforma, usar CoolROM si está disponible,
# si no, RomsFun. Resultado: [slug, label, provider]
def _build_unified_sys_list() -> list[tuple[str, str, str]]:
    # nombre → (slug, provider)
    seen: dict[str, tuple[str, str]] = {}
    # Primero CoolROM (prioridad)
    for slug, label in COOLROM_SYS_LIST:
        seen[label.lower()] = (slug, "coolrom.com")
    # Luego RomsFun — solo añade los que no existen ya por nombre
    for slug, label in ROMSFUN_SYS_LIST:
        if label.lower() not in seen:
            seen[label.lower()] = (slug, "romsfun.com")
    # Reconstruir lista con nombre original y ordenar alfabéticamente
    # Mapas inversos para recuperar el label original
    coolrom_inv = {v: k for k, v in COOLROM_SYSTEMS.items()}
    romsfun_inv = {v: k for k, v in rf.SYSTEMS.items()}
    result = []
    for label_lc, (slug, provider) in seen.items():
        # Recuperar el label con capitalización correcta
        if provider == "coolrom.com":
            label = COOLROM_SYSTEMS.get(slug, slug)
        else:
            label = rf.SYSTEMS.get(slug, slug)
        result.append((slug, label, provider))
    return sorted(result, key=lambda x: x[1])

UNIFIED_SYS_LIST = _build_unified_sys_list()

# ── HTML ─────────────────────────────────────────────────────────────────────
HTML = r"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ROM Manager</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f0f13;color:#e0e0e0;min-height:100vh}
header{background:#1a1a24;border-bottom:1px solid #2a2a3a;padding:10px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
header h1{font-size:1.1rem;font-weight:700;color:#fff;white-space:nowrap}
.search-global{display:flex;gap:6px;flex:1;min-width:260px;max-width:520px}
.search-global input{flex:1;background:#0f0f13;border:1px solid #3a3a4a;color:#e0e0e0;border-radius:6px;padding:6px 11px;font-size:.85rem;outline:none;transition:border .15s}
.search-global input:focus{border-color:#7eb8f7}
.search-global button{background:#2a5fad;color:#fff;border:none;border-radius:6px;padding:6px 13px;font-size:.83rem;cursor:pointer;font-weight:600;white-space:nowrap}
.search-global button:hover{background:#3a6fbd}
.provider-tabs{display:flex;gap:4px;margin-left:auto}
.ptab{background:#1a1a24;border:1px solid #2a2a3a;color:#888;border-radius:6px;padding:5px 11px;font-size:.78rem;cursor:pointer;transition:all .12s;white-space:nowrap}
.ptab:hover{border-color:#7eb8f7;color:#7eb8f7}
.ptab.active{background:#2a3f5a;border-color:#7eb8f7;color:#7eb8f7;font-weight:700}
.layout{display:grid;grid-template-columns:195px 1fr;height:calc(100vh - 56px)}
aside{background:#14141e;border-right:1px solid #2a2a3a;overflow-y:auto;padding:8px 0}
aside h2{font-size:.66rem;text-transform:uppercase;letter-spacing:.08em;color:#555;padding:6px 12px 3px}
aside a{display:block;padding:5px 12px;font-size:.8rem;color:#aaa;text-decoration:none;border-left:3px solid transparent;transition:all .12s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
aside a:hover{background:#1e1e2e;color:#fff}
aside a.active{background:#1e1e2e;color:#7eb8f7;border-left-color:#7eb8f7;font-weight:600}
main{display:flex;flex-direction:column;overflow:hidden}
.toolbar{padding:8px 14px;background:#16161f;border-bottom:1px solid #2a2a3a;display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.letters{display:flex;flex-wrap:wrap;gap:3px}
.letters button{background:#1a1a24;border:1px solid #2a2a3a;color:#888;border-radius:4px;padding:3px 7px;font-size:.72rem;cursor:pointer;transition:all .12s}
.letters button:hover{border-color:#7eb8f7;color:#7eb8f7}
.letters button.active{background:#2a3f5a;border-color:#7eb8f7;color:#7eb8f7;font-weight:700}
.sep{width:1px;height:20px;background:#2a2a3a;margin:0 3px}
.local-search input{background:#0f0f13;border:1px solid #2a2a3a;color:#e0e0e0;border-radius:5px;padding:4px 9px;font-size:.8rem;width:170px;outline:none}
.local-search input:focus{border-color:#7eb8f7}
.btn-load{background:#2a5fad;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:.8rem;cursor:pointer;font-weight:600}
.btn-load:hover{background:#3a6fbd}
.btn-load:disabled{background:#2a2a3a;color:#555;cursor:default}
.status{font-size:.75rem;color:#666;margin-left:3px;white-space:nowrap}
.prog{height:3px;background:#1a1a24}
.prog-bar{height:100%;background:#7eb8f7;width:0%;transition:width .25s}
.table-wrap{overflow-y:auto;flex:1}
table{width:100%;border-collapse:collapse;font-size:.8rem}
thead th{background:#1a1a26;color:#777;font-weight:600;text-transform:uppercase;font-size:.66rem;letter-spacing:.06em;padding:8px 10px;text-align:left;position:sticky;top:0;z-index:1;border-bottom:1px solid #2a2a3a}
tbody tr{border-bottom:1px solid #1c1c26}
tbody tr:hover{background:#181822}
td{padding:7px 10px;vertical-align:middle}
td.tid{color:#555;width:55px;font-size:.72rem}
td.timg{width:52px;padding:4px 8px}
td.timg img{width:44px;height:44px;object-fit:cover;border-radius:4px;border:1px solid #2a2a3a;background:#1a1a24;display:block}
td.timg .img-ph{width:44px;height:44px;border-radius:4px;border:1px solid #1e1e2e;background:#1a1a24;display:block}
td.tname{color:#ddd;font-weight:500}
td.tprovider{width:95px}
.badge{font-size:.67rem;padding:2px 6px;border-radius:9px;font-weight:600;white-space:nowrap}
.badge-coolrom{background:#1e2535;color:#7eb8f7;border:1px solid #2a3f5a}
.badge-romsfun{background:#251e35;color:#b87ef7;border:1px solid #3f2a5a}
.badge-sys{background:#1e2535;color:#7eb8f7;border:1px solid #2a3f5a;font-size:.64rem}
.url-cell{display:flex;align-items:center;gap:6px}
.url-text{color:#7eb8f7;font-size:.73rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;cursor:pointer;font-family:monospace}
.url-text.empty{color:#444;font-style:normal;font-family:inherit}
.url-text.err{color:#c05050}
.btn-copy{background:#1e2d1e;border:1px solid #2d4a2d;color:#6dbf6d;border-radius:4px;padding:2px 7px;font-size:.68rem;cursor:pointer;white-space:nowrap;flex-shrink:0}
.btn-copy:hover{background:#2d4a2d}
.btn-copy.ok{background:#2d4a2d;color:#9ddf9d}
.btn-dl{background:#1e2535;border:1px solid #2a3f5a;color:#7eb8f7;border-radius:4px;padding:3px 8px;font-size:.68rem;text-decoration:none;white-space:nowrap;display:inline-block}
.btn-dl:hover{background:#2a3f5a}
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;gap:10px;color:#444;padding:40px}
.spinner{width:16px;height:16px;border:2px solid #333;border-top-color:#7eb8f7;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<header>
  <h1>🎮 ROM Manager</h1>
  <div class="search-global">
    <input id="q-global" type="text" placeholder="Buscar ROM en todos los proveedores…" onkeydown="if(event.key==='Enter')globalSearch()">
    <button onclick="globalSearch()">Buscar</button>
  </div>
  <div class="provider-tabs">
    <button class="ptab active" id="tab-all"     onclick="setProvider('all')">Todos</button>
    <button class="ptab"        id="tab-coolrom" onclick="setProvider('coolrom.com')">CoolROM</button>
    <button class="ptab"        id="tab-romsfun" onclick="setProvider('romsfun.com')">RomsFun</button>
  </div>
</header>

<div class="layout">
  <aside id="sidebar">
    <h2>Sistemas</h2>
    <!-- Rendered by JS based on selected provider -->
  </aside>

  <main>
    <div class="toolbar">
      <div class="letters" id="letters"></div>
      <div class="sep" id="sep-local" style="display:none"></div>
      <div class="local-search" id="local-search" style="display:none">
        <input id="q-local" type="text" placeholder="Filtrar en esta lista…" oninput="localFilter()">
      </div>
      <button class="btn-load" id="btn-load" onclick="loadRoms()" disabled>Cargar ROMs</button>
      <span class="status" id="status-txt">← Elige un sistema o usa el buscador</span>
    </div>
    <div class="prog"><div class="prog-bar" id="prog-bar"></div></div>
    <div class="table-wrap" id="content">
      <div class="empty-state"><p>Selecciona un sistema o usa el buscador global</p></div>
    </div>
  </main>
</div>

<script>
// ── datos de sistemas ───────────────────────────────────────────────────────
const SYS_COOLROM = {{ coolrom_systems | tojson }};
const SYS_ROMSFUN = {{ romsfun_systems | tojson }};
// Lista unificada sin duplicados: [slug, label, provider]
const SYS_UNIFIED = {{ unified_systems | tojson }};

let currentProvider = 'all';
let currentSystem   = null;
let currentProviderForSystem = null;
let allRoms         = [];
let resolveToken    = 0;

const LETTERS = ['#','a','b','c','d','e','f','g','h','i','j','k','l','m',
                 'n','o','p','q','r','s','t','u','v','w','x','y','z'];

/* ── proveedor / sidebar ────────────────────────────────────────────────── */
function setProvider(p) {
  currentProvider = p;
  document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + (p === 'all' ? 'all' : p.replace('.',''))).classList.add('active');
  renderSidebar();
  currentSystem = null;
  document.getElementById('btn-load').disabled = true;
  setContent('<div class="empty-state"><p>Elige un sistema</p></div>');
  setStatus('← Elige un sistema o usa el buscador');
}

function renderSidebar() {
  const aside = document.getElementById('sidebar');
  let html = '';

  if (currentProvider === 'all') {
    // ── Modo "Todos": lista unificada sin duplicados ──────────────────────
    html += '<h2>Sistemas (' + SYS_UNIFIED.length + ')</h2>';
    SYS_UNIFIED.forEach(([slug, label, provider]) => {
      const badgeClass = provider === 'romsfun.com' ? 'badge-romsfun' : 'badge-coolrom';
      const badgeTxt   = provider === 'romsfun.com' ? 'RF' : 'CR';
      html += `<a href="#" data-sys="${slug}" data-provider="${provider}"
                onclick="selectSystem('${slug}','${escH(label)}','${provider}');return false">
                  ${escH(label)}&nbsp;<span class="badge ${badgeClass}" style="font-size:.6rem;padding:1px 4px">${badgeTxt}</span>
               </a>`;
    });

  } else if (currentProvider === 'coolrom.com') {
    html += '<h2>CoolROM (' + SYS_COOLROM.length + ')</h2>';
    SYS_COOLROM.forEach(([slug, label]) => {
      html += `<a href="#" data-sys="${slug}" data-provider="coolrom.com"
                onclick="selectSystem('${slug}','${escH(label)}','coolrom.com');return false">${escH(label)}</a>`;
    });

  } else if (currentProvider === 'romsfun.com') {
    html += '<h2>RomsFun (' + SYS_ROMSFUN.length + ')</h2>';
    SYS_ROMSFUN.forEach(([slug, label]) => {
      html += `<a href="#" data-sys="${slug}" data-provider="romsfun.com"
                onclick="selectSystem('${slug}','${escH(label)}','romsfun.com');return false">${escH(label)}</a>`;
    });
  }

  aside.innerHTML = html;
}

function selectSystem(slug, label, provider) {
  currentSystem = slug;
  currentProviderForSystem = provider;
  allRoms = [];
  resolveToken++;

  document.querySelectorAll('aside a').forEach(a =>
    a.classList.toggle('active', a.dataset.sys === slug && a.dataset.provider === provider));

  const lc = document.getElementById('letters');
  if (provider === 'coolrom.com') {
    lc.innerHTML = LETTERS.map(l =>
      `<button onclick="toggleLetter('${l}')" data-l="${l}">${l.toUpperCase()}</button>`
    ).join('');
  } else {
    lc.innerHTML = '';  // RomsFun no tiene filtro por letra
  }

  document.getElementById('sep-local').style.display   = '';
  document.getElementById('local-search').style.display = '';
  document.getElementById('btn-load').disabled = false;
  setStatus(`${label} [${provider}] — pulsa Cargar ROMs`);
  setContent('<div class="empty-state"><p>Pulsa <strong>Cargar ROMs</strong></p></div>');
}

function toggleLetter(l) {
  const btn = document.querySelector(`#letters button[data-l="${l}"]`);
  const wasActive = btn.classList.contains('active');
  document.querySelectorAll('#letters button').forEach(b => b.classList.remove('active'));
  if (!wasActive) btn.classList.add('active');
}

function activeLetter() {
  const b = document.querySelector('#letters button.active');
  return b ? b.dataset.l : '';
}

/* ── cargar ROMs ─────────────────────────────────────────────────────────── */
async function loadRoms() {
  if (!currentSystem) return;
  resolveToken++;
  const myToken = resolveToken;
  const letter  = activeLetter();
  const provider = currentProviderForSystem;

  document.getElementById('btn-load').disabled = true;
  document.getElementById('btn-load').textContent = 'Cargando…';
  document.getElementById('q-local').value = '';
  setProgress(5);
  setStatus('Obteniendo lista…');
  setContent('<div class="empty-state"><div class="spinner"></div><p>Cargando…</p></div>');

  try {
    const r    = await fetch(`/api/roms?system=${currentSystem}&letter=${letter}&provider=${encodeURIComponent(provider)}`);
    const data = await r.json();
    if (myToken !== resolveToken) return;

    allRoms = (data.roms || []).map(rom => ({...rom, download_url: null, _err: null}));
    setProgress(20);
    renderTable(allRoms, false);
    setStatus(`${allRoms.length} ROMs — resolviendo URLs…`);

    if (provider === 'coolrom.com') {
      await resolveAll(myToken);
    } else {
      // RomsFun: las URLs se resuelven por separado también
      await resolveAll(myToken);
    }
  } catch(e) {
    setContent(`<div class="empty-state"><p style="color:#e06060">Error: ${e.message}</p></div>`);
  }

  document.getElementById('btn-load').disabled = false;
  document.getElementById('btn-load').textContent = 'Cargar ROMs';
}

/* ── resolución de URLs ──────────────────────────────────────────────────── */
async function resolveAll(token) {
  const total = allRoms.length;
  for (let i = 0; i < total; i++) {
    if (token !== resolveToken) return;

    const rom = allRoms[i];
    if (rom.download_url) continue;

    try {
      const provider = rom.provider || 'coolrom.com';
      let url;
      if (provider === 'coolrom.com') {
        const r = await fetch(
          `/api/url?system=${encodeURIComponent(rom.system)}&id=${rom.id}&name=${encodeURIComponent(rom.url_name||'')}`
        );
        const d = await r.json();
        rom.download_url = d.download_url || null;
        rom._err         = d.error        || null;
        if (d.image_url && !rom.image_url) rom.image_url = d.image_url;
      } else {
        const r = await fetch(
          `/api/url?rom_url=${encodeURIComponent(rom.url||'')}&provider=${encodeURIComponent(provider)}`
        );
        const d = await r.json();
        rom.download_url = d.download_url || null;
        rom._err         = d.error        || null;
      }
    } catch(e) {
      rom._err = e.message;
    }

    if (token !== resolveToken) return;
    updateRow(rom);
    const pct = 20 + Math.round((i + 1) / total * 80);
    setProgress(pct);
    setStatus(`Resolviendo URLs… ${i + 1} / ${total}`);
  }

  if (token !== resolveToken) return;
  const ok = allRoms.filter(r => r.download_url).length;
  setStatus(`✓ ${total} ROMs · ${ok} URLs obtenidas`);
  setProgress(0);
}

/* ── búsqueda global ─────────────────────────────────────────────────────── */
async function globalSearch() {
  const q = document.getElementById('q-global').value.trim();
  if (!q) return;

  resolveToken++;
  const myToken = resolveToken;
  allRoms = [];
  currentSystem = null;

  document.querySelectorAll('aside a').forEach(a => a.classList.remove('active'));
  document.getElementById('btn-load').disabled = true;
  setProgress(10);
  setStatus(`Buscando "${q}"…`);
  setContent('<div class="empty-state"><div class="spinner"></div><p>Buscando…</p></div>');

  try {
    const provFilter = currentProvider !== 'all' ? `&provider=${encodeURIComponent(currentProvider)}` : '';
    const r    = await fetch(`/api/search?q=${encodeURIComponent(q)}${provFilter}`);
    const data = await r.json();
    if (myToken !== resolveToken) return;

    allRoms = (data.roms || []).map(rom => ({...rom, download_url: null, _err: null}));
    setProgress(30);

    if (!allRoms.length) {
      setContent(`<div class="empty-state"><p>Sin resultados para "<strong>${escH(q)}</strong>"</p></div>`);
      setStatus('Sin resultados');
      setProgress(0);
      return;
    }

    renderTable(allRoms, true);
    setStatus(`${allRoms.length} resultados para "${q}" — resolviendo URLs…`);
    await resolveAll(myToken);
  } catch(e) {
    setContent(`<div class="empty-state"><p style="color:#e06060">Error: ${e.message}</p></div>`);
  }

  document.getElementById('btn-load').disabled = !currentSystem;
}

/* ── filtro local ────────────────────────────────────────────────────────── */
function localFilter() {
  const q = document.getElementById('q-local').value.toLowerCase().trim();
  const list = q ? allRoms.filter(r => r.name.toLowerCase().includes(q)) : allRoms;
  renderTable(list, !currentSystem);
  list.forEach(rom => { if (rom.download_url || rom._err) updateRow(rom); });
}

/* ── renderizado ─────────────────────────────────────────────────────────── */
function renderTable(roms, showSystem=false) {
  if (!roms || !roms.length) {
    setContent('<div class="empty-state"><p>Sin resultados</p></div>');
    return;
  }
  const sysTh = showSystem ? '<th>Plataforma</th>' : '';
  const rows  = roms.map(r => rowHTML(r, showSystem)).join('');
  setContent(`
    <table>
      <thead><tr>
        <th>Img</th><th>ID</th>${sysTh}
        <th>Nombre</th><th>Proveedor</th>
        <th>Enlace de descarga directa</th><th></th>
      </tr></thead>
      <tbody id="tbody">${rows}</tbody>
    </table>`);
}

function rowHTML(rom, showSystem=false) {
  if (!rom) return '';
  const rowId = rom.provider === 'romsfun.com'
    ? `rfn_${encodeURIComponent(rom.id||rom.url||'').replace(/[^a-zA-Z0-9_]/g,'_')}`
    : `${rom.id}`;

  const sysTd = showSystem
    ? `<td><span class="badge badge-sys">${escH(rom.platform||rom.system||'')}</span></td>`
    : '';

  // Imagen
  let imgHtml;
  if (rom.image_url) {
    const proxied = `/proxy/image?url=${encodeURIComponent(rom.image_url)}`;
    imgHtml = `<img src="${proxied}" alt="" loading="lazy" onerror="this.style.display='none'">`;
  } else {
    imgHtml = `<span class="img-ph" id="img-${rowId}"></span>`;
  }

  // Badge de proveedor
  const provClass = (rom.provider||'').includes('romsfun') ? 'badge-romsfun' : 'badge-coolrom';
  const provLabel = (rom.provider||'').replace('coolrom.com','CoolROM').replace('romsfun.com','RomsFun');

  // URL de descarga
  let urlHtml;
  if (rom.download_url) {
    const u = escH(rom.download_url);
    const uq = escQ(rom.download_url);
    urlHtml = `
      <span class="url-text" title="${u}" onclick="copyUrl('${rowId}','${uq}')">${u}</span>
      <button class="btn-copy" id="cp-${rowId}" onclick="copyUrl('${rowId}','${uq}')">Copiar</button>`;
  } else if (rom._err) {
    urlHtml = `<span class="url-text err" title="${escH(rom._err)}">✗ ${escH(rom._err)}</span>`;
  } else {
    urlHtml = `<span class="url-text empty" id="url-pend-${rowId}">⏳ obteniendo…</span>`;
  }

  // Botón de descarga
  let dlHref;
  if (rom.provider === 'romsfun.com') {
    dlHref = `/download?provider=romsfun.com&rom_url=${encodeURIComponent(rom.url||'')}`;
  } else {
    dlHref = `/download?system=${encodeURIComponent(rom.system||'')}&id=${rom.id}&name=${encodeURIComponent(rom.url_name||'')}`;
  }
  const dlBtn = `<a class="btn-dl" href="${dlHref}" download>↓ Descargar</a>`;

  return `<tr id="row-${rowId}">
    <td class="timg" id="imgcell-${rowId}">${imgHtml}</td>
    <td class="tid">${escH(String(rom.id||''))}</td>
    ${sysTd}
    <td class="tname">${escH(rom.name||'')}</td>
    <td class="tprovider"><span class="badge ${provClass}">${escH(provLabel)}</span></td>
    <td><div class="url-cell" id="urlcell-${rowId}">${urlHtml}</div></td>
    <td id="dlcell-${rowId}">${dlBtn}</td>
  </tr>`;
}

function updateRow(rom) {
  if (!rom) return;
  const rowId = rom.provider === 'romsfun.com'
    ? `rfn_${encodeURIComponent(rom.id||rom.url||'').replace(/[^a-zA-Z0-9_]/g,'_')}`
    : `${rom.id}`;

  // Imagen (si se obtuvo después del renderizado inicial)
  if (rom.image_url) {
    const imgCell = document.getElementById(`imgcell-${rowId}`);
    if (imgCell && !imgCell.querySelector('img')) {
      const proxied = `/proxy/image?url=${encodeURIComponent(rom.image_url)}`;
      imgCell.innerHTML = `<img src="${proxied}" alt="" loading="lazy" onerror="this.style.display='none'">`;
    }
  }

  const cell = document.getElementById(`urlcell-${rowId}`);
  if (!cell) return;

  if (rom.download_url) {
    const u  = escH(rom.download_url);
    const uq = escQ(rom.download_url);
    cell.innerHTML = `
      <span class="url-text" title="${u}" onclick="copyUrl('${rowId}','${uq}')">${u}</span>
      <button class="btn-copy" id="cp-${rowId}" onclick="copyUrl('${rowId}','${uq}')">Copiar</button>`;
  } else if (rom._err) {
    cell.innerHTML = `<span class="url-text err">✗ ${escH(rom._err)}</span>`;
  }
}

/* ── copiar ──────────────────────────────────────────────────────────────── */
function copyUrl(id, url) {
  navigator.clipboard.writeText(url).catch(() => {
    const t = document.createElement('textarea');
    t.value = url; document.body.appendChild(t); t.select();
    document.execCommand('copy'); document.body.removeChild(t);
  });
  const btn = document.getElementById(`cp-${id}`);
  if (btn) {
    btn.textContent = '✓ Copiado'; btn.classList.add('ok');
    setTimeout(() => { if (btn) { btn.textContent = 'Copiar'; btn.classList.remove('ok'); } }, 1500);
  }
}

/* ── utilidades ──────────────────────────────────────────────────────────── */
function setContent(html) { document.getElementById('content').innerHTML = html; }
function setStatus(t)     { document.getElementById('status-txt').textContent = t; }
function setProgress(p)   { document.getElementById('prog-bar').style.width = (p||0) + '%'; }
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escQ(s) { return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

// Inicializar sidebar al cargar
renderSidebar();
</script>
</body>
</html>
"""

# ── API ──────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template_string(
        HTML,
        coolrom_systems=COOLROM_SYS_LIST,
        romsfun_systems=ROMSFUN_SYS_LIST,
        unified_systems=UNIFIED_SYS_LIST,
    )


# ── Endpoints disponibles ───────────────────────────────────────────────────

@app.route("/api/endpoints")
def api_endpoints():
    """Devuelve la lista completa de endpoints de esta API."""
    endpoints = [
        {
            "method": "GET",
            "path":   "/api/endpoints",
            "desc":   "Este listado — todos los endpoints disponibles.",
            "params": {},
        },
        {
            "method": "GET",
            "path":   "/api/systems",
            "desc":   "Lista unificada de sistemas (sin duplicados). "
                      "Acepta ?provider=coolrom.com|romsfun.com para filtrar.",
            "params": {"provider": "opcional — 'coolrom.com' | 'romsfun.com'"},
        },
        {
            "method": "GET",
            "path":   "/api/roms",
            "desc":   "ROMs de un sistema. CoolROM soporta filtro por letra.",
            "params": {
                "system":   "requerido — slug del sistema",
                "provider": "requerido — 'coolrom.com' | 'romsfun.com'",
                "letter":   "opcional (solo CoolROM) — 'a'–'z' | '#'",
            },
        },
        {
            "method": "GET",
            "path":   "/api/url",
            "desc":   "URL de descarga directa (firmada/CDN) para un ROM.",
            "params": {
                "provider":  "requerido — 'coolrom.com' | 'romsfun.com'",
                "[CoolROM]system": "slug del sistema",
                "[CoolROM]id":     "ID numérico del ROM",
                "[CoolROM]name":   "slug URL del ROM",
                "[RomsFun]rom_url": "URL completa de la página del ROM",
            },
        },
        {
            "method": "GET",
            "path":   "/api/search",
            "desc":   "Búsqueda global en uno o todos los proveedores.",
            "params": {
                "q":        "requerido — texto a buscar",
                "provider": "opcional — 'coolrom.com' | 'romsfun.com' | 'all' (default)",
            },
        },
        {
            "method": "GET",
            "path":   "/download",
            "desc":   "Descarga streaming de un ROM directamente al navegador.",
            "params": {
                "provider":  "requerido — 'coolrom.com' | 'romsfun.com'",
                "[CoolROM]system": "slug del sistema",
                "[CoolROM]id":     "ID numérico del ROM",
                "[CoolROM]name":   "slug URL del ROM",
                "[RomsFun]rom_url": "URL completa de la página del ROM",
            },
        },
        {
            "method": "GET",
            "path":   "/proxy/image",
            "desc":   "Proxy de imagen para evitar CORS. Solo dominios coolrom.com y romsfun.com.",
            "params": {"url": "requerido — URL absoluta de la imagen"},
        },
    ]
    return jsonify({"endpoints": endpoints, "total": len(endpoints)})


@app.route("/api/systems")
def api_systems():
    """Lista de sistemas, con deduplicación opcional por proveedor."""
    provider = request.args.get("provider", "all").strip()
    if provider == "coolrom.com":
        systems = [{"slug": s, "label": l, "provider": "coolrom.com"}
                   for s, l in COOLROM_SYS_LIST]
    elif provider == "romsfun.com":
        systems = [{"slug": s, "label": l, "provider": "romsfun.com"}
                   for s, l in ROMSFUN_SYS_LIST]
    else:
        systems = [{"slug": s, "label": l, "provider": p}
                   for s, l, p in UNIFIED_SYS_LIST]
    return jsonify({"systems": systems, "total": len(systems), "provider_filter": provider})


# ── Proxy de imagen (evita CORS) ─────────────────────────────────────────────

@app.route("/proxy/image")
def proxy_image():
    """Sirve una imagen remota desde el servidor para evitar problemas de CORS."""
    img_url = request.args.get("url", "").strip()
    if not img_url:
        return "Missing url", 400

    # Permitir sólo dominios conocidos
    allowed = ("coolrom.com", "romsfun.com")
    from urllib.parse import urlparse as _up
    host = _up(img_url).hostname or ""
    if not any(host == d or host.endswith("." + d) for d in allowed):
        return "Forbidden domain", 403

    try:
        s = SESSION_COOLROM if "coolrom" in host else SESSION_ROMSFUN
        r = s.get(img_url, timeout=15, stream=True,
                  headers={"Referer": "https://" + host})
        r.raise_for_status()
        content_type = r.headers.get("Content-Type", "image/jpeg")
        def gen():
            for chunk in r.iter_content(16384):
                if chunk:
                    yield chunk
        return Response(stream_with_context(gen()),
                        status=200,
                        headers={
                            "Content-Type": content_type,
                            "Cache-Control": "public, max-age=86400",
                        })
    except Exception as e:
        return f"Error: {e}", 502


# ── ROMs por sistema ─────────────────────────────────────────────────────────

@app.route("/api/roms")
def api_roms():
    system   = request.args.get("system", "").strip()
    letter   = request.args.get("letter", "").strip()
    provider = request.args.get("provider", "coolrom.com").strip()
    boxshelf_id = request.args.get("boxshelf_id", "").strip()

    if boxshelf_id and not system:
        mapped = system_map.provider_params_for(boxshelf_id, provider)
        if not mapped:
            return jsonify({"error": f"boxshelf_id desconocido: {boxshelf_id}"}), 400
        system = mapped["system"]
        provider = mapped["provider"]

    if not system:
        return jsonify({"error": "falta system o boxshelf_id"}), 400

    errors = []
    clean = []
    used_provider = provider
    try:
        if provider == "romsfun.com":
            roms = rf.list_roms(SESSION_ROMSFUN, system)
            clean = roms
        else:
            try:
                roms = list_roms_for_system(SESSION_COOLROM, system, letter=letter, resolve_urls=False)
                clean = [{k: v for k, v in r.items() if k != "link"} for r in roms]
            except Exception as e_cr:
                errors.append(str(e_cr))
                # Fallback automático a RomsFun si CoolROM responde 403/bloquea
                mapped = system_map.provider_params_for(boxshelf_id, "romsfun.com") if boxshelf_id else None
                rf_sys = (mapped or {}).get("system") or system
                try:
                    clean = rf.list_roms(SESSION_ROMSFUN, rf_sys)
                    used_provider = "romsfun.com"
                except Exception as e_rf:
                    errors.append(str(e_rf))
                    return jsonify({"error": " · ".join(errors), "roms": [], "total": 0}), 502

        clean = system_map.dedupe_and_rank([system_map.annotate_rom(r) for r in clean], "")
        return jsonify({
            "roms": clean,
            "total": len(clean),
            "system": system,
            "provider": used_provider,
            "boxshelf_id": boxshelf_id or None,
            "warnings": errors or None,
        })
    except Exception as e:
        return jsonify({"error": str(e), "roms": [], "total": 0}), 502


# ── URL de descarga ──────────────────────────────────────────────────────────

@app.route("/api/url")
def api_url():
    provider = request.args.get("provider", "coolrom.com").strip()

    if provider == "romsfun.com":
        rom_url = request.args.get("rom_url", "").strip()
        if not rom_url:
            return jsonify({"error": "falta rom_url"}), 400
        try:
            dl_url = rf.get_download_url(SESSION_ROMSFUN, rom_url)
            img_url = rf.get_rom_image(SESSION_ROMSFUN, rom_url)
            return jsonify({"download_url": dl_url, "image_url": img_url})
        except Exception as e:
            return jsonify({"error": str(e), "download_url": None})

    # CoolROM
    system   = request.args.get("system",   "").strip()
    rom_id   = request.args.get("id",        "").strip()
    rom_name = request.args.get("name",      "").strip()
    if not all([system, rom_id, rom_name]):
        return jsonify({"error": "faltan parámetros"}), 400
    try:
        link = RomLink(system, int(rom_id), rom_name)
        url  = link.get_url(SESSION_COOLROM)
        return jsonify({
            "download_url": url,
            "valid":        link.is_token_valid,
            "image_url":    link.image_url,
            "provider":     COOLROM_PROVIDER,
            "platform":     COOLROM_SYSTEMS.get(system, system),
        })
    except Exception as e:
        return jsonify({"error": str(e), "download_url": None})


# ── Búsqueda global ──────────────────────────────────────────────────────────

@app.route("/api/search")
def api_search():
    q        = request.args.get("q", "").strip()
    provider = request.args.get("provider", "all").strip()
    if not q:
        return jsonify({"error": "falta q"}), 400

    roms = []

    # ── CoolROM — chip-aware search (recoge resultados de TODOS los sistemas) ─
    if provider in ("all", "coolrom.com"):
        try:
            seen_cr: set = set()

            # Patrones reutilizables
            _row_pat  = re.compile(
                r'<a[^>]+class="crs-row"[^>]+href="(/roms/([a-z0-9]+)/(\d+)/([^"]+?)\.php)"'
                r'[^>]*>(.*?)</a>',
                re.DOTALL,
            )
            _name_pat = re.compile(
                r'<td[^>]+class="crs-name"[^>]*>(.*?)</td>', re.DOTALL
            )
            _loose_pat = re.compile(
                r'/roms/([a-z0-9]+)/(\d+)/([^"\'<>\s]+?)\.php'
            )

            def _parse_cr_page(html_cr: str) -> int:
                """Extrae ROMs de CoolROM de una página ya descargada.
                Devuelve el número de NUEVOS resultados añadidos."""
                new_count = 0

                # Pasada 1 — estricta: bloques <a class="crs-row"> completos
                for m in _row_pat.finditer(html_cr):
                    rel_path, system, rom_id, url_name, inner = m.groups()
                    key = f"{system}_{rom_id}"
                    if key in seen_cr:
                        continue
                    seen_cr.add(key)

                    # Nombre: extraer texto del <td class="crs-name">, limpiar tags
                    nm = _name_pat.search(inner)
                    if nm:
                        raw = re.sub(r'<[^>]+>', ' ', nm.group(1))
                        display = hu(re.sub(r'\s+', ' ', raw).strip())
                    else:
                        display = hu(unquote(url_name).replace("_", " "))

                    new_count += 1
                    roms.append({
                        "id":           int(rom_id),
                        "name":         display,
                        "url_name":     url_name,
                        "system":       system,
                        "platform":     COOLROM_SYSTEMS.get(system, system),
                        "provider":     COOLROM_PROVIDER,
                        "image_url":    None,
                        "download_url": None,
                        "page_url":     f"{COOLROM_URL}{rel_path}",
                    })

                # Pasada 2 — suelta: cualquier URL de ROM no capturada antes
                for m2 in _loose_pat.finditer(html_cr):
                    system2, rom_id2, url_name2 = m2.groups()
                    key2 = f"{system2}_{rom_id2}"
                    if key2 in seen_cr:
                        continue
                    seen_cr.add(key2)
                    new_count += 1
                    display2 = unquote(url_name2).replace("_", " ")
                    roms.append({
                        "id":           int(rom_id2),
                        "name":         display2,
                        "url_name":     url_name2,
                        "system":       system2,
                        "platform":     COOLROM_SYSTEMS.get(system2, system2),
                        "provider":     COOLROM_PROVIDER,
                        "image_url":    None,
                        "download_url": None,
                        "page_url":     f"{COOLROM_URL}/roms/{system2}/{rom_id2}/{url_name2}.php",
                    })

                return new_count

            # 1. Página inicial de búsqueda (session_get reintenta tras 403)
            resp_init = coolrom_get(
                SESSION_COOLROM,
                f"{COOLROM_URL}/search",
                params={"q": q},
                timeout=15,
            )
            if resp_init.status_code == 403:
                raise RuntimeError("coolrom search 403")
            resp_init.raise_for_status()
            html_init = resp_init.text
            _parse_cr_page(html_init)

            # 2. Extraer chips de sistema desde la página inicial
            #    HTML: <a class="crs-chip" href="/search?q=...&amp;system=SLUG">
            chip_pat = re.compile(
                r'href="(/search\?[^"]*system=([^"&\s]+))"',
                re.IGNORECASE,
            )
            chip_systems: list[str] = []
            for chip_m in chip_pat.finditer(html_init.replace("&amp;", "&")):
                sys_slug = chip_m.group(2)
                if sys_slug not in chip_systems:
                    chip_systems.append(sys_slug)

            # 3. Fetch cada sistema chip (máx. 15) + paginar hasta 3 páginas por sistema
            for sys_slug in chip_systems[:15]:
                try:
                    resp_sys = coolrom_get(
                        SESSION_COOLROM,
                        f"{COOLROM_URL}/search",
                        params={"q": q, "system": sys_slug},
                        timeout=15,
                    )
                    if resp_sys.status_code >= 400:
                        continue
                    new_sys = _parse_cr_page(resp_sys.text)

                    # Paginar dentro del sistema si hay resultados
                    if new_sys > 0:
                        for page in range(2, 4):
                            try:
                                resp_p = coolrom_get(
                                    SESSION_COOLROM,
                                    f"{COOLROM_URL}/search",
                                    params={"q": q, "system": sys_slug, "p": page},
                                    timeout=15,
                                )
                                if resp_p.status_code >= 400:
                                    break
                                if _parse_cr_page(resp_p.text) == 0:
                                    break
                            except Exception:
                                break
                except Exception:
                    pass  # ignorar chips que fallen

            # 4. Si no había chips, paginar la búsqueda general (hasta 5 páginas)
            if not chip_systems:
                for page in range(2, 6):
                    try:
                        resp_p = coolrom_get(
                            SESSION_COOLROM,
                            f"{COOLROM_URL}/search",
                            params={"q": q, "p": page},
                            timeout=15,
                        )
                        if resp_p.status_code >= 400:
                            break
                        if _parse_cr_page(resp_p.text) == 0:
                            break
                    except Exception:
                        break

        except Exception:
            pass  # no bloquear por CoolROM — RomsFun sigue

    # ── RomsFun (paginada, con resiliencia 429) ───────────────────────────────
    if provider in ("all", "romsfun.com"):
        try:
            rf_results = rf.search_roms(SESSION_ROMSFUN, q, max_pages=5)
            for r in rf_results:
                roms.append(r)
        except Exception:
            pass  # no bloquear por RomsFun

    roms = [system_map.annotate_rom(r) for r in roms]
    roms = system_map.dedupe_and_rank(roms, q)
    return jsonify({"roms": roms, "total": len(roms), "query": q})


# ── Descarga directa (streaming) ─────────────────────────────────────────────

@app.route("/download")
def download_file():
    provider = request.args.get("provider", "coolrom.com").strip()

    # ── RomsFun ──
    if provider == "romsfun.com":
        rom_url = request.args.get("rom_url", "").strip()
        if not rom_url:
            return "Falta rom_url", 400
        try:
            cdn_url = rf.get_download_url(SESSION_ROMSFUN, rom_url)
        except Exception as e:
            return f"No se pudo obtener la URL: {e}", 502

        try:
            cdn_resp = SESSION_ROMSFUN.get(
                cdn_url,
                headers={"Referer": "https://romsfun.com/"},
                stream=True,
                timeout=60,
                allow_redirects=True,
            )
            cdn_resp.raise_for_status()
        except Exception as e:
            return f"Error al descargar desde CDN: {e}", 502

        filename = cdn_url.split("?")[0].rstrip("/").split("/")[-1]
        from urllib.parse import unquote as _uq
        filename = _uq(filename) or "rom.zip"

        def gen_rf():
            for chunk in cdn_resp.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk

        headers = {
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Type":        cdn_resp.headers.get("Content-Type", "application/octet-stream"),
        }
        if cdn_resp.headers.get("Content-Length"):
            headers["Content-Length"] = cdn_resp.headers["Content-Length"]
        return Response(stream_with_context(gen_rf()), status=200, headers=headers)

    # ── CoolROM ──
    system   = request.args.get("system",   "").strip()
    rom_id   = request.args.get("id",        "").strip()
    rom_name = request.args.get("name",      "").strip()

    if not all([system, rom_id, rom_name]):
        return "Faltan parámetros", 400

    try:
        link    = RomLink(system, int(rom_id), rom_name)
        cdn_url = link.get_url(SESSION_COOLROM)
    except Exception as e:
        return f"No se pudo obtener la URL: {e}", 502

    try:
        cdn_resp = SESSION_COOLROM.get(
            cdn_url,
            headers={"Referer": "https://coolrom.com/"},
            stream=True,
            timeout=60,
            allow_redirects=True,
        )
        cdn_resp.raise_for_status()
    except Exception:
        # Token revocado → renovar una vez
        try:
            link.invalidate()
            cdn_url  = link.get_url(SESSION_COOLROM)
            cdn_resp = SESSION_COOLROM.get(
                cdn_url,
                headers={"Referer": "https://coolrom.com/"},
                stream=True, timeout=60, allow_redirects=True,
            )
            cdn_resp.raise_for_status()
        except Exception as e2:
            return f"Error al descargar: {e2}", 502

    try:
        from urllib.parse import urlparse, unquote as _uq2
        path_parts = urlparse(cdn_url).path.strip("/").split("/")
        filename = _uq2(path_parts[2]) if len(path_parts) > 2 else f"{rom_name}.zip"
    except Exception:
        filename = f"{rom_name}.zip"

    content_length = cdn_resp.headers.get("Content-Length")

    def gen_cr():
        for chunk in cdn_resp.iter_content(chunk_size=65536):
            if chunk:
                yield chunk

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Type":        cdn_resp.headers.get("Content-Type", "application/zip"),
    }
    if content_length:
        headers["Content-Length"] = content_length

    return Response(stream_with_context(gen_cr()), status=200, headers=headers)


# ── Health / catálogo Boxshelf / jobs / emuladores ────────────────────────────

@app.route("/api/health")
def api_health():
    return jsonify({
        "ok": True,
        "service": "rom-manager",
        "providers": ["coolrom.com", "romsfun.com"],
        "catalog_systems": len(system_map.catalog_systems()),
        "emulators": len(emu_catalog.list_emulators()),
    })


@app.route("/api/catalog/systems")
def api_catalog_systems():
    systems = system_map.catalog_systems()
    return jsonify({"systems": systems, "total": len(systems)})


@app.route("/api/emulators")
def api_emulators():
    system = request.args.get("system", "").strip() or None
    items = emu_catalog.list_emulators(system)
    return jsonify({"emulators": items, "total": len(items)})


@app.route("/api/emulators/<emu_id>")
def api_emulator_one(emu_id: str):
    item = emu_catalog.get_emulator(emu_id)
    if not item:
        return jsonify({"error": "emulador desconocido"}), 404
    return jsonify(item)


@app.route("/api/jobs", methods=["GET"])
def api_jobs_list():
    return jsonify({"jobs": download_jobs.list_jobs()})


@app.route("/api/jobs/<job_id>", methods=["GET"])
def api_job_get(job_id: str):
    job = download_jobs.get_job(job_id)
    if not job:
        return jsonify({"error": "job no encontrado"}), 404
    return jsonify(job)


@app.route("/api/jobs/download", methods=["POST"])
def api_jobs_download():
    """
    Resuelve URL CDN y encola descarga a dest_dir.
    Body JSON:
      { provider, dest_dir, filename?,
        # CoolROM: system, id, name
        # RomsFun: rom_url
      }
    """
    data = request.get_json(silent=True) or {}
    dest_dir = str(data.get("dest_dir") or "").strip()
    if not dest_dir:
        return jsonify({"error": "falta dest_dir"}), 400

    provider = str(data.get("provider") or "coolrom.com").strip()
    referer = "https://romsfun.com/" if provider == "romsfun.com" else "https://coolrom.com/"
    session = SESSION_ROMSFUN if provider == "romsfun.com" else SESSION_COOLROM

    try:
        if provider == "romsfun.com":
            rom_url = str(data.get("rom_url") or "").strip()
            if not rom_url:
                return jsonify({"error": "falta rom_url"}), 400
            cdn_url = rf.get_download_url(SESSION_ROMSFUN, rom_url)
        else:
            system = str(data.get("system") or "").strip()
            rom_id = str(data.get("id") or "").strip()
            rom_name = str(data.get("name") or "").strip()
            if not all([system, rom_id, rom_name]):
                return jsonify({"error": "faltan system/id/name"}), 400
            link = RomLink(system, int(rom_id), rom_name)
            cdn_url = link.get_url(SESSION_COOLROM)
    except Exception as e:
        return jsonify({"error": f"no se pudo resolver URL: {e}"}), 502

    job = download_jobs.create_download_job(
        download_url=cdn_url,
        dest_dir=dest_dir,
        filename=data.get("filename"),
        referer=referer,
        session=session,
    )
    return jsonify({"job": job, "download_url": cdn_url}), 202


# ── Arranque ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 52)
    print("  ROM Manager  →  http://localhost:5000")
    print("  Proveedores: coolrom.com · romsfun.com")
    print("  Catálogo Boxshelf: /api/catalog/systems")
    print("=" * 52)
    app.run(host="0.0.0.0", port=5000, debug=False)
