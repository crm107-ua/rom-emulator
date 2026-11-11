// Device test pass "screens" (Android 0.4.0), run by web-device-test.js. Checks results, never speed.
// The Android build on screens other than the Thor's (the adapter's pretend device, ?fakeNative=1): a 20:9 phone, a small
// phone and a 16:10 tablet, all landscape. On each: the shelf comes up with a game chosen, nothing spills sideways (no
// horizontal scroll), the console tabs and the chosen case are on screen, Settings fits, the test meter is off, and there
// are no script errors. A screenshot of each is kept (screens-<name>.png / -settings.png).
'use strict';
const path = require('path');

const SIZES = [
  { name: 'phone-20x9', width: 915, height: 412, dpr: 2.625 },  // a 2400×1080 phone
  { name: 'phone-small', width: 740, height: 360, dpr: 3 },     // a small 2220×1080 phone
  { name: 'tablet-16x10', width: 1280, height: 800, dpr: 2 },   // a 2560×1600 tablet
];

module.exports = async function screensPass({ browser, base, check, OUT }) {
  for (const sz of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: sz.width, height: sz.height }, deviceScaleFactor: sz.dpr, isMobile: true, hasTouch: true });
    ctx.setDefaultTimeout(90000);
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    try {
      await page.goto(base + '?fakeNative=1'); await page.waitForTimeout(4000);
      // set up three consoles the way pass 2 does, then start again on a filled shelf
      await page.evaluate(async () => {
        const api = window.boxshelf, info = await api.getConfig(), det = await api.detect(), c = info.config;
        const dirs = [await api.pick({ kind: 'folder' }), await api.pick({ kind: 'folder' }), await api.pick({ kind: 'folder' })];
        c.systems.gc.romDirs = [dirs[0]]; c.systems.gc.emulator = det.systems.gc.emulator;
        c.systems.psx.romDirs = [dirs[1]]; c.systems.psx.emulator = det.systems.psx.emulator;
        c.systems.snes.romDirs = [dirs[2]]; c.systems.snes.emulator = det.systems.snes.emulator;
        c.setupDone = true; await api.saveConfig(c); await api.scan();
      });
      await page.reload();
      await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(2500);
      const r = await page.evaluate(() => {
        const vw = innerWidth, vh = innerHeight, box = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
        const tabs = box(document.getElementById('tabs')), hud = document.getElementById('thorHud');
        // the chosen case: the slot nearest the middle of the screen
        const slots = [...document.querySelectorAll('#track > *')].map(box).filter(b => b && b.w > 0);
        const mid = slots.sort((a, b) => Math.abs((a.l + a.r) / 2 - vw / 2) - Math.abs((b.l + b.r) / 2 - vw / 2))[0] || null;
        return { vw, vh, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, tabs, mid, game: Shelf._qs().g,
          hud: hud ? getComputedStyle(hud).display : 'none' };
      });
      await page.screenshot({ path: path.join(OUT, `screens-${sz.name}.png`) }).catch(() => {});
      const fits = b => !!b && b.l >= -2 && b.r <= r.vw + 2 && b.t >= -2 && b.b <= r.vh + 2;
      check(`Screens (${sz.name} ${sz.width}×${sz.height}): the shelf comes up with a game chosen, nothing spills sideways, the tabs and the chosen case are on screen, the test meter is off`,
        !!r.game && r.scrollW <= r.vw + 1 && fits(r.tabs) && !!r.mid && r.mid.h > r.vh * 0.25 && r.mid.t >= -2 && r.mid.b <= r.vh + 2 && r.hud === 'none', JSON.stringify(r).slice(0, 500));
      // Settings fits the screen
      const s = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
        Setup.open(); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150); await w(900);
        const el = document.getElementById('bss'), b = el ? el.getBoundingClientRect() : null, rows = document.querySelectorAll('#bss .bss-row').length;
        return { open: !!(el && el.classList.contains('on')), rows, l: b && Math.round(b.left), r: b && Math.round(b.right), t: b && Math.round(b.top), b: b && Math.round(b.bottom), vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth }; });
      await page.screenshot({ path: path.join(OUT, `screens-${sz.name}-settings.png`) }).catch(() => {});
      check(`Screens (${sz.name}): Settings opens and fits the screen`,
        s.open && s.rows >= 1 && s.l >= -2 && s.r <= s.vw + 2 && s.t >= -2 && s.b <= s.vh + 2 && s.scrollW <= s.vw + 1, JSON.stringify(s));
      await page.evaluate(async () => { if (window.Settings && Settings.isOpen && Settings.isOpen()) await Settings.close(); });
      check(`Screens (${sz.name}): no script errors`, !errors.length, errors.slice(0, 3).join(' | '));
    } catch (e) { check(`Screens (${sz.name}) ran to the end`, false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
    await ctx.close();
  }

  // (beta.11) Text size (android-early.js): the page's layout width. (beta.12) Automatic gives a handheld 1280 (the Thor's
  // labels were too small at 1440); a small screen or a bigger Android font size gets a narrower page (so everything is
  // drawn bigger, down to 1024); a tablet-sized screen keeps 1440; the choice in Settings wins over all of them
  const TS = [
    { name: 'Thor, Automatic', w: 853, h: 480, dpr: 2.25, want: 1280 },
    { name: 'small 4-inch screen, Automatic', w: 640, h: 360, dpr: 3, want: 1024 },
    { name: 'Thor, Android font size 1.3, Automatic', w: 853, h: 480, dpr: 2.25, fs: '1.3', want: 1024 },
    { name: '10-inch tablet, Automatic', w: 1280, h: 800, dpr: 2, want: 1440 },
    { name: 'Thor, Large', w: 853, h: 480, dpr: 2.25, pref: 'large', want: 1280 },
    { name: 'Thor, Largest', w: 853, h: 480, dpr: 2.25, pref: 'largest', want: 1024 },
    { name: 'small 4-inch screen, Normal', w: 640, h: 360, dpr: 3, pref: 'normal', want: 1440 },
  ];
  for (const t of TS) {
    const ctx = await browser.newContext({ viewport: { width: t.w, height: t.h }, deviceScaleFactor: t.dpr, isMobile: true, hasTouch: true });
    await ctx.addInitScript(o => { try { if (o.pref) localStorage.setItem('bs-textsize', o.pref); if (o.fs) localStorage.setItem('bs-fontscale', o.fs); } catch {} }, { pref: t.pref, fs: t.fs });
    const page = await ctx.newPage();
    try {
      await page.goto(base + '?fakeNative=1'); await page.waitForFunction(() => window.Shelf, null, { timeout: 90000, polling: 250 });
      const r = await page.evaluate(() => ({ iw: innerWidth, lw: window.__bsLayoutW, sw: document.documentElement.scrollWidth }));
      check(`Text size (${t.name}): the page is ${t.want} wide and nothing spills sideways`, r.iw === t.want && r.lw === t.want && r.sw <= r.iw + 1, JSON.stringify(r));
    } catch (e) { check(`Text size (${t.name}) ran to the end`, false, e && e.message); }
    await ctx.close();
  }
  // Larger on the Thor: the shelf, Settings (with its Text size row), the quick menu and Details all fit the narrower page
  {
    const ctx = await browser.newContext({ viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, isMobile: true, hasTouch: true });
    ctx.setDefaultTimeout(90000);
    await ctx.addInitScript(() => { try { localStorage.setItem('bs-textsize', 'larger'); } catch {} });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(base + '?platform=android&shelf=1');
      await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.Setup, null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(2000);
      const fit = sel => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return { sel, missing: true }; const b = e.getBoundingClientRect();
        return { sel, l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth }; }, sel);
      const fits = b => !b.missing && b.w > 0 && b.l >= -2 && b.r <= b.vw + 2 && b.t >= -2 && b.b <= b.vh + 2 && b.sw <= b.vw + 1;
      const shelf = await fit('#tabs');
      check('Text size (Thor, Larger): the page is 1152 wide and the console tabs fit', shelf.vw === 1152 && fits(shelf), JSON.stringify(shelf));
      const s = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
        Setup.open({ page: 'display' }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150); await w(900);
        return [...document.querySelectorAll('#bss .bss-row .nm')].map(e => e.textContent.trim()); });
      const sb = await fit('#bss');
      await page.screenshot({ path: path.join(OUT, 'textsize-larger-settings.png') }).catch(() => {});
      check('Text size (Thor, Larger): Settings fits, and Display & sound has the Text size row', fits(sb) && s.includes('Text size'), JSON.stringify({ sb, rows: s.slice(0, 6) }));
      await page.evaluate(async () => { if (window.Settings && Settings.isOpen && Settings.isOpen()) await Settings.close(); await new Promise(r => setTimeout(r, 800)); });
      await page.evaluate(async () => { Shelf.quickMenu(); for (let i = 0; i < 30 && !Shelf._qs().open; i++) await new Promise(r => setTimeout(r, 150)); await new Promise(r => setTimeout(r, 600)); });
      const qm = await fit('#quickMenu');
      check('Text size (Thor, Larger): the quick menu opens and fits', fits(qm), JSON.stringify(qm));
      await page.keyboard.press('Escape'); await page.waitForTimeout(800);
      await page.keyboard.press('i'); await page.waitForTimeout(1500);
      const det = await fit('#details'), mode = await page.evaluate(() => Shelf.getMode());
      await page.screenshot({ path: path.join(OUT, 'textsize-larger-details.png') }).catch(() => {});
      check('Text size (Thor, Larger): Details opens and fits', mode === 'details' && fits(det), JSON.stringify({ mode, det }));
      check('Text size (Thor, Larger): no script errors', !errors.length, errors.slice(0, 3).join(' | '));
    } catch (e) { check('Text size (Thor, Larger) ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
    await ctx.close();
  }
  // Larger on the Thor: the Art Studio's five rows don't fit the shorter page, so they move up together; each one, when
  // it's open, sits whole between the header and the hints (android-studio.js rowLift)
  {
    const ctx = await browser.newContext({ viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, isMobile: true, hasTouch: true });
    ctx.setDefaultTimeout(90000);
    await ctx.addInitScript(() => { try { localStorage.setItem('bs-textsize', 'larger'); } catch {} });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      const url = base + '?fakeNative=1';
      await page.goto(url); await page.waitForTimeout(4000);
      await page.evaluate(async () => { const api = window.boxshelf, info = await api.getConfig(), det = await api.detect(), c = info.config;
        const d0 = await api.pick({ kind: 'folder' }); c.systems.gc.romDirs = [d0]; c.systems.gc.emulator = det.systems.gc.emulator; c.setupDone = true; await api.saveConfig(c); await api.scan(); });
      await page.goto(url); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g, null, { timeout: 90000, polling: 250 }); await page.waitForTimeout(2500);
      // (onto a game first: the shelf opens on its Surprise me / emulator case, which has no box art)
      for (let i = 0; i < 6 && !/^Pikmin/.test(await page.evaluate(() => Shelf._qs().g || '')); i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(700); }
      await page.evaluate(() => Shelf.bottomCmd('art'));
      await page.waitForFunction(() => window.BS_STUDIO && BS_STUDIO.isOpen(), null, { timeout: 30000, polling: 250 }); await page.waitForTimeout(1500);
      await page.keyboard.press('ArrowUp'); const rows = [];
      for (let k = 0; k < 5; k++) {
        await page.waitForTimeout(700);
        rows.push(await page.evaluate(() => { const on = document.querySelector('#bsStudio .bst-row.on'), body = document.querySelector('#bsStudio .bst-body').getBoundingClientRect(), r = on && on.getBoundingClientRect();
          return { part: on && on.dataset.part, t: r && Math.round(r.top), b: r && Math.round(r.bottom), top: Math.round(body.top), bottom: Math.round(body.bottom), ok: !!r && r.top >= body.top - 1 && r.bottom <= body.bottom + 1 }; }));
        if (k === 4) await page.screenshot({ path: path.join(OUT, 'textsize-larger-studio.png') }).catch(() => {});
        await page.keyboard.press('ArrowDown');
      }
      check('Text size (Thor, Larger): every Art Studio row, when open, is fully on screen', rows.length === 5 && new Set(rows.map(r => r.part)).size === 5 && rows.every(r => r.ok) && !errors.length,
        JSON.stringify(rows) + (errors.length ? ' errors: ' + errors.slice(0, 2).join(' | ') : ''));
    } catch (e) { check('Text size (Thor, Larger): Art Studio ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
    await ctx.close();
  }
};
