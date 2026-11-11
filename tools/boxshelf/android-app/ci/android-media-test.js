// Device test (beta.12, Android): Details' Media tab on a phone-like touch screen. A tap on a screenshot opens the
// full-screen viewer (a close button, "k / n"); a swipe goes to the next; the close button brings Details back. The
// trailer's sound button shows once a trailer plays, says off, and a tap turns the video's sound on (and back off).
// Thor-like 853x480 @2.25, touch.
'use strict';
module.exports = async function androidMediaPass({ browser, base, check }) {
  const errors = [], o = {};
  const ctx = await browser.newContext({ viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, hasTouch: true });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  const sv = () => page.evaluate(() => { const v = document.getElementById('shotView'), x = v && v.querySelector('.sv-x'), i = v && v.querySelector('.sv-img'), b = v && v.querySelector('.sv-bar');
    const xr = x ? x.getBoundingClientRect() : null, fits = (() => { if (!i || !b || !i.naturalWidth) return null; const r = i.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; })();
    return { mode: Shelf.getMode(), on: !!(v && v.classList.contains('on')), n: v ? v.querySelector('.sv-n').textContent : '', keys: v ? v.querySelector('.sv-keys').textContent : '', x: xr ? Math.round(Math.min(xr.width, xr.height) * (innerWidth / document.documentElement.clientWidth || 1)) : 0, xShown: !!(x && getComputedStyle(x).display !== 'none'), fits,
      barPx: b ? parseFloat(getComputedStyle(b).fontSize) : 0, over: document.scrollingElement.scrollWidth > innerWidth + 1 }; });
  const snd = () => page.evaluate(() => { const b = document.getElementById('dSound'), v = document.getElementById('dVideo'); const src = !!v.getAttribute('src'); return { hidden: !b || b.hidden, text: b ? b.textContent : '', muted: src ? v.muted : window.__ytMuted !== false, src }; }); // (a video file: its own mute; YouTube's player: how it was last started)
  try {
    await page.goto(base + '?platform=android&shelf=1&shots=1&previews=shelf&clips=1&helper=1');
    await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 12; i++) { if (await page.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom' && g.info && (g.info.shots || []).length > 2); })) break; await page.keyboard.press('ArrowRight'); await page.waitForTimeout(350); }
    await page.keyboard.press('i'); await page.waitForFunction(() => Shelf.getMode() === 'details', null, { timeout: 15000, polling: 200 }); await page.waitForTimeout(700);
    await page.evaluate(() => { const t = document.getElementById('dTabMedia'); if (t && !t.hidden) t.click(); }); await page.waitForTimeout(900);
    o.shots = await page.evaluate(() => document.querySelectorAll('#dShots .d-shot').length);
    // the viewer: a tap opens it, a swipe left goes on, the close button goes back
    await page.evaluate(() => document.querySelector('#dShots .d-shot').click()); await page.waitForTimeout(700); o.open = await sv();
    await page.evaluate(async () => { const el = document.getElementById('shotView'), ev = (t, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 5, pointerType: 'touch', clientX: x, clientY: y }));
      ev('pointerdown', 600, 240); await new Promise(r => setTimeout(r, 60)); ev('pointerup', 300, 250); }); await page.waitForTimeout(500); o.swiped = await sv();
    await page.evaluate(() => document.querySelector('#shotView .sv-x').click()); await page.waitForTimeout(700); o.closed = await sv();
    // the trailer's sound button (the browser double's clip plays in the Media box)
    for (let i = 0; i < 60 && (await snd()).hidden; i++) await page.waitForTimeout(250);
    o.s0 = await snd();
    await page.evaluate(() => document.getElementById('dSound').click()); await page.waitForTimeout(300); o.s1 = await snd();
    await page.evaluate(() => document.getElementById('dSound').click()); await page.waitForTimeout(300); o.s2 = await snd();
    await page.keyboard.press('Escape'); await page.waitForTimeout(600); await page.keyboard.press('i'); await page.waitForFunction(() => Shelf.getMode() === 'details', null, { timeout: 15000, polling: 200 });
  } catch (e) { o.err = e.message; }
  await ctx.close();
  const a = o.open || {}, s = o.swiped || {}, c = o.closed || {};
  check('Android (beta.12): a tap on a screenshot opens it full screen with a close button big enough for a finger, readable words, nothing off the screen',
    o.shots > 2 && a.mode === 'shot' && a.on && a.n === '1 / ' + o.shots && a.xShown && a.x >= 28 && a.barPx >= 20 && a.fits !== false && !a.over && /Swipe/.test(a.keys), JSON.stringify({ shots: o.shots, a, err: o.err }));
  check('Android: a swipe goes to the next screenshot; the close button brings Details back', s.n === '2 / ' + o.shots && s.mode === 'shot' && c.mode === 'details' && !c.on, JSON.stringify({ s, c }));
  check('Android: the trailer\'s sound button shows with the trailer (off), a tap turns the sound on, another off',
    o.s0 && !o.s0.hidden && /off$/.test(o.s0.text) && o.s0.muted === true && o.s1 && /on$/.test(o.s1.text) && o.s1.muted === false && o.s2 && /off$/.test(o.s2.text) && o.s2.muted === true, JSON.stringify({ s0: o.s0, s1: o.s1, s2: o.s2 }));
  check('Android media pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
