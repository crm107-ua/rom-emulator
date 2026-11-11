// Device test pass "portrait" (Android 0.5), run by web-device-test.js (screens group). Checks results, never speed.
// Phones, tablets and foldables in portrait and landscape (android-early.js lays the page out from the window: a wide
// window keeps the Thor's numbers, a tall or narrow one gets 360-756 CSS px and the app's narrow layout). On each size
// the pretend device (?fakeNative=1) comes up with a filled shelf; checked: the layout width, nothing spills sideways,
// the shelf, Details, the quick menu and Settings open and fit, the key text is big enough to read, a rotation lays the
// page out again (once) without script errors, and the Thor's layout is unchanged (1280). Screenshots: portrait-*.png.
'use strict';
const path = require('path');

const SIZES = [
  { name: 'phone-portrait', width: 390, height: 844, dpr: 3, want: [448, 452], rotate: true },
  { name: 'phone-landscape', width: 844, height: 390, dpr: 3, want: [1280, 1280] },
  { name: 'phone-small-portrait', width: 360, height: 640, dpr: 3, want: [412, 416] },
  { name: 'tablet-portrait', width: 800, height: 1280, dpr: 2, want: [756, 756] },
  { name: 'tablet-landscape', width: 1280, height: 800, dpr: 2, want: [1440, 1440] },
  { name: 'fold-inner', width: 884, height: 1104, dpr: 2.625, want: [756, 756] },
  { name: 'thor', width: 853, height: 480, dpr: 2.25, want: [1280, 1280] },
];

module.exports = async function portraitPass({ browser, base, check, OUT }) {
  const shot = (page, f) => page.screenshot({ path: path.join(OUT, 'portrait-' + f + '.png'), scale: 'css', timeout: 90000 }).catch(() => {});
  const wait = (page, ms) => page.waitForTimeout(ms);
  // the box of an element, the page's size, and whether anything spills sideways
  const fit = (page, sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return { sel, missing: true }; const b = e.getBoundingClientRect();
    return { sel, l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height), vw: innerWidth, vh: innerHeight,
      sw: document.scrollingElement.scrollWidth }; }, sel);
  const fits = b => !b.missing && b.w > 0 && b.l >= -2 && b.r <= b.vw + 2 && b.t >= -2 && b.b <= b.vh + 2 && b.sw <= b.vw + 1;
  // the smallest visible text inside an element (CSS px of the layout), with what it is
  const smallest = (page, sel) => page.evaluate(sel => { const root = document.querySelector(sel); if (!root) return { px: 0, what: 'missing ' + sel };
    let px = 999, what = '';
    for (const e of root.querySelectorAll('*')) {
      if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const b = e.getBoundingClientRect(); if (!b.width || !b.height || b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue;
      const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      let z = 1; for (let p = e; p && p !== document.documentElement; p = p.parentElement) { const ps = getComputedStyle(p); z *= parseFloat(ps.zoom) || 1;
        if (ps.transform && ps.transform !== 'none') { const m = new DOMMatrixReadOnly(ps.transform); z *= Math.hypot(m.a, m.b) || 1; } }
      const f = parseFloat(cs.fontSize) * z; if (f < px) { px = f; what = (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) + ' "' + e.textContent.trim().slice(0, 24) + '"'; }
    }
    return { px: Math.round(px * 10) / 10, what }; }, sel);
  const errorsOf = page => { const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); }); return errors; };

  for (const sz of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: sz.width, height: sz.height }, deviceScaleFactor: sz.dpr, isMobile: true, hasTouch: true });
    ctx.setDefaultTimeout(90000);
    const page = await ctx.newPage(), errors = errorsOf(page), narrow = sz.want[1] <= 760;
    try {
      await page.goto(base + '?fakeNative=1'); await wait(page, 4000);
      // a fresh install: the setup wizard fits the screen
      const su = await fit(page, '#setup .su-card');
      if (!su.missing) await shot(page, sz.name + '-firstrun');
      check(`Portrait pass (${sz.name}): a fresh install's setup wizard fits the screen`, fits(su), JSON.stringify(su));
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
      for (let i = 0; i < 6 && !/^Pikmin/.test(await page.evaluate(() => Shelf._qs().g || '')); i++) { await page.keyboard.press('ArrowRight'); await wait(page, 600); }
      await wait(page, 1500);
      const lw = await page.evaluate(() => ({ lw: window.__bsLayoutW, iw: innerWidth, narrow: document.documentElement.classList.contains('bs-narrow'), sw: document.scrollingElement.scrollWidth,
        meta: document.querySelector('meta[name="viewport"]').getAttribute('content') }));
      check(`Portrait pass (${sz.name} ${sz.width}x${sz.height}): the page is laid out ${sz.want[0]}${sz.want[1] !== sz.want[0] ? '-' + sz.want[1] : ''} px wide and nothing spills sideways`,
        lw.lw >= sz.want[0] && lw.lw <= sz.want[1] && lw.iw === lw.lw && lw.narrow === narrow && lw.sw <= lw.iw + 1, JSON.stringify(lw));
      const shelf = await page.evaluate(() => {
        const vw = innerWidth, vh = innerHeight, box = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
        const slots = [...document.querySelectorAll('#track > *')].map(box).filter(b => b && b.w > 0);
        const mid = slots.sort((a, b) => Math.abs((a.l + a.r) / 2 - vw / 2) - Math.abs((b.l + b.r) / 2 - vw / 2))[0] || null;
        const fs = s => { const e = document.querySelector(s); return e && e.offsetWidth ? parseFloat(getComputedStyle(e).fontSize) : 0; };
        const hints = [...document.querySelectorAll('.hints .hint, #hints .hint')].filter(h => h.offsetWidth).map(box);
        return { vw, vh, tabs: box(document.getElementById('tabs')), mid, title: box(document.querySelector('.g-title')), hints: hints.length, hintOut: hints.filter(h => h.l < -1 || h.r > vw + 1 || h.b > vh + 1).length,
          f: { tab: fs('.tab-strip .tab'), meta: fs('.g-meta span'), hint: fs('.hint .lab'), count: fs('#sysCount') } };
      });
      await shot(page, sz.name + '-shelf');
      const on = b => !!b && b.l >= -2 && b.r <= shelf.vw + 2 && b.t >= -2 && b.b <= shelf.vh + 2;
      const minF = 15;
      check(`Portrait pass (${sz.name}): the shelf has the tabs, the chosen case and the hints on screen, with readable labels (${minF}+ px)`,
        on(shelf.tabs) && on(shelf.mid) && shelf.mid.h > shelf.vh * (narrow ? .18 : .25) && !shelf.hintOut && shelf.f.tab >= 16 && shelf.f.meta >= minF && (!shelf.f.hint || shelf.f.hint >= minF), JSON.stringify(shelf).slice(0, 600));
      // Details
      await page.keyboard.press('i'); await wait(page, 1600);
      const det = await fit(page, '#details'), detMode = await page.evaluate(() => Shelf.getMode()), detSmall = await smallest(page, '#details');
      const detBtns = await page.evaluate(() => { const L = [...document.querySelectorAll('#details .d-actions > button')].filter(b => b.offsetWidth), vw = innerWidth;
        return { n: L.length, inside: L.every(b => { const r = b.getBoundingClientRect(); return r.left >= -1 && r.right <= vw + 1; }), minH: Math.min(...L.map(b => Math.round(b.getBoundingClientRect().height))) }; });
      await shot(page, sz.name + '-details');
      check(`Portrait pass (${sz.name}): Details opens and fits, its buttons are on screen and tall enough for a thumb, its text is readable`,
        detMode === 'details' && fits(det) && detBtns.n >= 2 && detBtns.inside && detBtns.minH >= 44 && (!narrow || detSmall.px >= 13), JSON.stringify({ det, detBtns, detSmall }));
      await page.keyboard.press('Escape'); await wait(page, 900);
      // the quick menu
      await page.evaluate(async () => { Shelf.quickMenu(); for (let i = 0; i < 30 && !Shelf._qs().open; i++) await new Promise(r => setTimeout(r, 150)); await new Promise(r => setTimeout(r, 700)); });
      const qm = await fit(page, '#quickMenu'), qmSmall = await smallest(page, '#quickMenu');
      await shot(page, sz.name + '-quickmenu');
      check(`Portrait pass (${sz.name}): the quick menu opens and fits, its text readable`, fits(qm) && (!narrow || qmSmall.px >= 13), JSON.stringify({ qm, qmSmall }));
      await page.keyboard.press('Escape'); await wait(page, 900);
      // Settings
      const st = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
        Setup.open(); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150); await w(900);
        const rows = [...document.querySelectorAll('#bss .bss-row')].filter(r => r.offsetWidth), vw = innerWidth;
        return { rows: rows.length, rowsIn: rows.every(r => { const b = r.getBoundingClientRect(); return b.left >= -1 && b.right <= vw + 1; }), minRowH: rows.length ? Math.min(...rows.map(r => Math.round(r.getBoundingClientRect().height))) : 0,
          navs: [...document.querySelectorAll('#bss .bss-nav')].filter(n => n.offsetWidth).length }; });
      const bss = await fit(page, '#bss'), bssSmall = await smallest(page, '#bss .bss-page');
      await shot(page, sz.name + '-settings');
      check(`Portrait pass (${sz.name}): Settings opens and fits, rows on screen and at least 44 px tall, sections reachable, text readable`,
        fits(bss) && st.rows >= 1 && st.rowsIn && st.minRowH >= 44 && st.navs >= 5 && (!narrow || bssSmall.px >= 13), JSON.stringify({ bss, st, bssSmall }));
      await page.evaluate(async () => { if (window.Settings && Settings.isOpen && Settings.isOpen()) await Settings.close(); await new Promise(r => setTimeout(r, 900)); });
      // a rotation: the page is laid out again for the new shape (once), and back
      if (sz.rotate) {
        const relayouts = await page.evaluate(() => { window.__bsMetaWrites = 0; const m = document.querySelector('meta[name="viewport"]');
          new MutationObserver(l => { window.__bsMetaWrites += l.length; }).observe(m, { attributes: true }); return 0; });
        await page.setViewportSize({ width: sz.height, height: sz.width }); await wait(page, 1500);
        const land = await page.evaluate(() => ({ lw: window.__bsLayoutW, iw: innerWidth, sw: document.scrollingElement.scrollWidth, writes: window.__bsMetaWrites, mode: Shelf.getMode() }));
        const tabsL = await fit(page, '#tabs');
        await shot(page, sz.name + '-rotated');
        await page.setViewportSize({ width: sz.width, height: sz.height }); await wait(page, 1500);
        const back = await page.evaluate(() => ({ lw: window.__bsLayoutW, iw: innerWidth, sw: document.scrollingElement.scrollWidth, writes: window.__bsMetaWrites, narrow: document.documentElement.classList.contains('bs-narrow') }));
        const tabsP = await fit(page, '#tabs');
        check(`Portrait pass (${sz.name}): turned to landscape the page is laid out again at 1280 (one viewport change), turned back it is narrow again, nothing spills either way`,
          relayouts === 0 && land.lw === 1280 && land.iw === 1280 && land.sw <= land.iw + 1 && land.writes === 1 && fits(tabsL) && back.lw === lw.lw && back.iw === lw.lw && back.narrow && back.writes === 2 && back.sw <= back.iw + 1 && fits(tabsP),
          JSON.stringify({ land, back }));
      }
      check(`Portrait pass (${sz.name}): no script errors`, !errors.length, errors.slice(0, 3).join(' | '));
    } catch (e) { check(`Portrait pass (${sz.name}) ran to the end`, false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
    await ctx.close();
  }

  // a phone in portrait: the achievements screen (the browser double's pretend set) and the museum's way in
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    ctx.setDefaultTimeout(90000);
    const page = await ctx.newPage(), errors = errorsOf(page);
    try {
      await page.goto(base + '?platform=android&shelf=1&ra=1');
      await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
      await wait(page, 1500);
      for (let i = 0; i < 12; i++) { if (await page.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await page.keyboard.press('ArrowRight'); await wait(page, 350); }
      await page.keyboard.press('i'); await page.waitForFunction(() => { const b = document.getElementById('dAchBtn'); return b && !b.hidden; }, null, { timeout: 20000, polling: 200 });
      await page.click('#dAchBtn'); await page.waitForFunction(() => Shelf.getMode() === 'achv' && document.querySelectorAll('#achList .ach').length > 0, null, { timeout: 15000, polling: 200 });
      await wait(page, 900);
      const a = await page.evaluate(() => { const c = document.getElementById('achCard').getBoundingClientRect(), l = document.getElementById('achList').getBoundingClientRect();
        return { vw: innerWidth, vh: innerHeight, sw: document.scrollingElement.scrollWidth, card: [Math.round(c.left), Math.round(c.right), Math.round(c.top), Math.round(c.bottom)], list: [Math.round(l.left), Math.round(l.right), Math.round(l.top), Math.round(l.bottom)],
          cardT: parseFloat(getComputedStyle(document.querySelector('#achCard .ach-card-t')).fontSize) }; });
      await shot(page, 'phone-portrait-achievements');
      check('Portrait pass (phone portrait): the achievements screen has the wall and its card on screen, one above the other, nothing spills sideways',
        a.sw <= a.vw + 1 && a.card[0] >= -1 && a.card[1] <= a.vw + 1 && a.card[3] <= a.vh + 1 && a.list[0] >= -1 && a.list[1] <= a.vw + 1 && a.list[3] <= a.card[2] + 1 && a.cardT >= 16, JSON.stringify(a));
      await page.keyboard.press('Escape'); await wait(page, 700); await page.keyboard.press('Escape'); await wait(page, 900);
      await page.keyboard.press('m'); await wait(page, 7000);
      await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 6 && window.Museum && Museum._dv && Museum._dv(); i++) { Museum.skipDelivery(); await w(800); } });
      await wait(page, 1500);
      const m = await page.evaluate(() => ({ mode: Shelf.getMode(), open: document.getElementById('app').classList.contains('museum-open'), vw: innerWidth, sw: document.scrollingElement.scrollWidth }));
      await shot(page, 'phone-portrait-museum');
      check('Portrait pass (phone portrait): the museum opens, nothing spills sideways', m.open && m.sw <= m.vw + 1, JSON.stringify(m));
      check('Portrait pass (phone portrait, achievements + museum): no script errors', !errors.length, errors.slice(0, 3).join(' | '));
    } catch (e) { check('Portrait pass (achievements + museum) ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
    await ctx.close();
  }
};
