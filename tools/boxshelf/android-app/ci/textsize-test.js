// Device test (beta.12): readable on the Thor. Automatic text size lays the page out 1280 px wide on a handheld (it was
// 1440: 11-14 px labels at arm's length), Largest gives 1024; the shelf's and Details' small labels have readable sizes
// and every Details button is on the panel; the bottom screen's pill buttons are tall enough for a thumb.
'use strict';
module.exports = async function textSizePass({ browser, base, check }) {
  const thor = { viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, isMobile: true, hasTouch: true };
  const errors = [];
  const top = async (pref) => {
    const ctx = await browser.newContext(thor); if (pref) await ctx.addInitScript(p => { try { localStorage.setItem('bs-textsize', p); } catch {} }, pref);
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); let o = {};
    try {
      await p.goto(base + '?platform=android&shelf=1'); await p.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
      await p.waitForTimeout(1500);
      o = await p.evaluate(() => { const fs = s => { const e = document.querySelector(s); return e ? parseFloat(getComputedStyle(e).fontSize) : 0; };
        return { w: window.__bsLayoutW, inner: innerWidth, sysCount: fs('#sysCount'), menu: fs('#menuBtn'), hint: fs('.hint .lab'), tab: fs('.tab-strip .tab'), meta: fs('.g-meta span') }; });
      if (!pref) {
        for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300); }
        await p.keyboard.press('i'); await p.waitForTimeout(1500);
        Object.assign(o, await p.evaluate(() => { const pr = document.getElementById('details').getBoundingClientRect(), L = [...document.querySelectorAll('#details .d-actions > button')].filter(b => b.offsetWidth);
          return { btns: L.length, inside: L.every(b => { const r = b.getBoundingClientRect(); return r.left >= pr.left - 1 && r.right <= pr.right + 1; }), desc: parseFloat(getComputedStyle(document.getElementById('dDesc')).fontSize) }; }));
      }
    } catch (e) { o.err = e.message; }
    await ctx.close(); return o;
  };
  const a = await top(null);
  check('Text size (beta.12): Automatic lays the Thor page out 1280 px wide (bigger than the old 1440)', a.w === 1280 && a.inner === 1280, JSON.stringify(a));
  check('Text size: the shelf\'s small labels are readable (console count, Menu, hints, console tabs, the game line: 15-16 px)', a.sysCount >= 15 && a.menu >= 15 && a.hint >= 15 && a.tab >= 16 && a.meta >= 16, JSON.stringify(a));
  check('Text size: in Details every button is on the panel (Play on its own row when they don\'t fit) and the text is 17 px', a.btns >= 2 && a.inside && a.desc >= 17, JSON.stringify(a));
  const l = await top('largest');
  check('Text size: Largest lays the page out 1024 px wide', l.w === 1024 && l.inner === 1024, JSON.stringify(l));
  // the bottom screen (1240x1080, its stage zoomed to fit)
  let bo = {};
  { const ctx = await browser.newContext({ viewport: { width: 1240, height: 1080 }, deviceScaleFactor: 1, hasTouch: true }); const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
    try { await p.goto(base.replace('index.html', 'bottom.html?demo=1')); await p.waitForTimeout(2000);
      bo = await p.evaluate(() => { const z = parseFloat(getComputedStyle(document.getElementById('stage') || document.body).zoom) || 1, h = s => { const e = document.querySelector(s); return e && e.offsetHeight ? e.getBoundingClientRect().height / z : 0; };
        return { z, open: h('.open-btn'), qk: h('.qk'), statB: (() => { const e = document.querySelector('.stat b'); return e ? e.scrollWidth <= e.clientWidth + 1 : true; })() }; });
    } catch (e) { bo.err = e.message; }
    await ctx.close(); }
  check('Bottom screen (beta.12): Inspect and Game details are tall enough for a thumb (48 / 44 stage px), stats not cut off', bo.open >= 47 && bo.qk >= 43 && bo.statB, JSON.stringify(bo));
  check('Text size pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
