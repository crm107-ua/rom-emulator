// Device test (beta.12): the Art Studio's Spine page. Spines are about 1:13, so the page shows the spine lying flat: an
// "Up close" strip across the page (thick enough to read), the versions as short wide cards two to a row, and the left
// column's neighbours shelf made bigger and kept inside its panel. Other parts keep the old layout. Windows 1600x900; the
// Thor-sized Android page (853x480 @2.25, touch) keeps its own Art Studio.
'use strict';
module.exports = async function spinePagePass({ browser, base, check }) {
  // the Thor has its own Art Studio (android-studio.js): it still opens, and the Settings Spine page isn't drawn there
  const thorRun = async () => {
    const ctx = await browser.newContext({ viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); let o = null;
    try {
      await page.goto(base + '?platform=android&shelf=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._tour, null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(1200);
      for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400); }
      await page.evaluate(() => Shelf._tour.artStudio());
      await page.waitForFunction(() => window.BS_STUDIO && BS_STUDIO.isOpen() && /Spine/.test(document.body.innerText), null, { timeout: 20000, polling: 250 }).catch(() => {});
      o = await page.evaluate(() => ({ open: !!(window.BS_STUDIO && BS_STUDIO.isOpen()), spine: /Spine/.test(document.body.innerText), spmode: !!document.querySelector('.bsa-pk.spmode') }));
    } catch (e) { o = { err: e.message }; }
    await ctx.close(); return { o, errors };
  };
  const run = async (q, android) => {
    const ctx = await browser.newContext(android ? { viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, isMobile: true, hasTouch: true } : { viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); let o = null;
    try {
      await page.goto(base + q); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._tour, null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(1200);
      for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400); }
      await page.evaluate(() => Shelf._tour.artStudio());
      await page.waitForFunction(() => document.querySelectorAll('#bss .bsa-part').length > 3, null, { timeout: 30000, polling: 250 });
      await page.waitForTimeout(1500);
      await page.evaluate(() => { const s = [...document.querySelectorAll('#bss .bsa-part')].find(e => /^\s*spine/i.test(e.textContent)); if (s) s.click(); });
      await page.waitForFunction(() => document.querySelectorAll('#bss .bsa-pk.spmode .bsa-card').length > 1 && document.querySelector('#bss .bsa-up .rot img.on'), null, { timeout: 30000, polling: 250 });
      await page.waitForTimeout(800);
      o = await page.evaluate(() => {
        const q = s => document.querySelector('#bss ' + s), R = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        const pk = q('.bsa-pk'), up = q('.bsa-up'), sl = q('.bsa-up .sl'), im = q('.bsa-up .rot img'), pv = q('.bsa-pv'), sc = pk.getBoundingClientRect().width / pk.offsetWidth || 1;
        const cards = [...document.querySelectorAll('#bss .bsa-card')].slice(0, 4), xs = new Set(cards.map(c => Math.round(c.getBoundingClientRect().left)));
        const spIm = q('.bsa-card .im.sp'), nbs = [...document.querySelectorAll('#bss .bsa-pv.sbig .bsa-nb .sp')], pr = R(pv);
        const o = { spmode: pk.classList.contains('spmode'), upShown: getComputedStyle(up).display !== 'none', upLong: Math.round(sl.offsetWidth), upThick: Math.round(sl.offsetHeight),
          upImg: !!(im && im.naturalWidth), upInside: R(up).r <= pk.getBoundingClientRect().right + 1, cols: xs.size, cardImH: spIm ? spIm.offsetHeight : 0, cardT: spIm ? parseFloat(spIm.style.getPropertyValue('--T')) : 0,
          sbig: pv.classList.contains('sbig'), nb: nbs.length, meH: nbs.length ? Math.round(Math.max(...nbs.map(e => e.offsetHeight))) : 0,
          nbInside: nbs.every(e => { const r = R(e); return r.l >= pr.l - 1 && r.r <= pr.r + 1 && r.b <= pr.b + 1 && r.t >= pr.t - 1; }), scale: +sc.toFixed(2) };
        return o; });
      // another part: the old layout again (no strip, the case back)
      await page.evaluate(() => { const s = [...document.querySelectorAll('#bss .bsa-part')].find(e => /^\s*front/i.test(e.textContent)); if (s) s.click(); });
      await page.waitForTimeout(1500);
      Object.assign(o, await page.evaluate(() => ({ frontSp: document.querySelector('#bss .bsa-pk').classList.contains('spmode'), frontUp: getComputedStyle(document.querySelector('#bss .bsa-up')).display, frontCase: getComputedStyle(document.querySelector('#bss .bsa-turn')).display !== 'none' })));
    } catch (e) { o = Object.assign(o || {}, { err: e.message }); }
    await ctx.close(); return { o, errors };
  };
  const win = await run('?platform=windows&shelf=1', false), w = win.o || {};
  check('Spine page (beta.12, Windows): an "Up close" strip across the page with the spine lying flat (long and thick enough to read), loaded',
    w.spmode && w.upShown && w.upImg && w.upInside && w.upLong >= 900 && w.upThick >= 70, JSON.stringify(w).slice(0, 500));
  check('Spine page: the versions are short wide cards, two to a row, the spine about twice as thick as before',
    w.cols === 2 && w.cardImH > 0 && w.cardImH <= 80 && w.cardT >= 40, JSON.stringify(w).slice(0, 300));
  check('Spine page: the left column shows the neighbours shelf bigger, all of it inside its panel',
    w.sbig && w.nb >= 2 && w.meH >= 200 && w.nbInside, JSON.stringify(w).slice(0, 300));
  check('Spine page: another part (Front) goes back to the case, without the strip', w.frontSp === false && w.frontUp === 'none' && w.frontCase, JSON.stringify(w).slice(0, 300));
  const thor = await thorRun(), t = thor.o || {};
  check('Spine page: the Thor keeps its own Art Studio (it opens, with its Spine row), untouched by the Settings Spine page', t.open && t.spine && !t.spmode, JSON.stringify(t).slice(0, 300));
  check('Spine page pass: no script errors', !win.errors.length && !thor.errors.length, [...win.errors, ...thor.errors].slice(0, 3).join(' | '));
};
