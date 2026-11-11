// Device test (beta.12): the screenshot viewer in Details (Windows / Linux). A (Enter) on a screenshot opens it full
// screen with "k / n"; left / right go through them; B (Esc) brings Details back on the screenshot you ended on, the
// viewer gone. The mouse too: a click on a thumbnail opens it, a click beside the picture closes it. Windows 1600x900.
'use strict';
module.exports = async function shotViewPass({ browser, base, check }) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); const o = {};
  const st = () => page.evaluate(() => { const v = document.getElementById('shotView'), a = document.activeElement;
    return { mode: Shelf.getMode(), on: !!(v && v.classList.contains('on')), shown: !!(v && getComputedStyle(v).display !== 'none'), n: v ? (v.querySelector('.sv-n') || {}).textContent : '',
      img: !!(v && (v.querySelector('.sv-img') || {}).getAttribute && v.querySelector('.sv-img').getAttribute('src')),
      fits: (() => { const i = v && v.querySelector('.sv-img'), b = v && v.querySelector('.sv-bar'); if (!i || !b || !i.naturalWidth) return null; const r = i.getBoundingClientRect(), s = Math.min(r.width / i.naturalWidth, r.height / i.naturalHeight), h = i.naturalHeight * s, top = r.top + (r.height - h) / 2;
        return top >= 0 && top + h <= b.getBoundingClientRect().top + 1 && r.right <= innerWidth + 1; })(), focusShot: a && a.classList && a.classList.contains('d-shot') ? [...a.parentNode.children].indexOf(a) : -1 }; });
  try {
    await page.goto(base + '?platform=windows&shelf=1&shots=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(1200);
    for (let i = 0; i < 8; i++) { if (await page.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await page.keyboard.press('ArrowRight'); await page.waitForTimeout(350); }
    await page.keyboard.press('i'); await page.waitForFunction(() => Shelf.getMode() === 'details' && document.querySelectorAll('#dShots .d-shot').length > 2, null, { timeout: 15000, polling: 200 });
    await page.waitForTimeout(900);
    // the keyboard: Enter on the 2nd screenshot, right, left, Esc
    await page.focus('#dShots .d-shot:nth-child(2)'); await page.keyboard.press('Enter'); await page.waitForTimeout(600); o.open = await st();
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400); o.next = await st();
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(400); o.prev = await st();
    // (closing: waited for until the viewer has shrunk away, which takes longer on a slow machine)
    const gone = () => page.waitForFunction(() => { const v = document.getElementById('shotView'); return !v || getComputedStyle(v).display === 'none'; }, null, { timeout: 6000, polling: 150 }).catch(() => {});
    await page.keyboard.press('Escape'); await page.waitForTimeout(700); await gone(); o.closed = await st();
    // the mouse: a click on the 4th thumbnail, then beside the picture
    await page.click('#dShots .d-shot:nth-child(4)'); await page.waitForTimeout(600); o.mOpen = await st();
    await page.mouse.click(20, 20); await page.waitForTimeout(700); await gone(); o.mClosed = await st();
  } catch (e) { o.err = e.message; }
  await ctx.close();
  // the controller in the viewer: RB / LB and right on the d-pad go through them, B back to Details
  const pctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await pctx.addInitScript(`(() => { const pad = window.__pad = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }; Navigator.prototype.getGamepads = function () { return [pad, null, null, null]; }; })();`);
  const pp = await pctx.newPage(); pp.on('pageerror', e => errors.push(e.message));
  const sn = () => pp.evaluate(() => { const v = document.getElementById('shotView'); return { mode: Shelf.getMode(), n: v ? v.querySelector('.sv-n').textContent : '', keys: v ? v.querySelector('.sv-keys').textContent : '' }; });
  const press = b => pp.evaluate(async b => { const w = ms => new Promise(r => setTimeout(r, ms)); if (window.__padHold) { await __padHold(__pad, b, 250); await w(350); return; } __pad.buttons[b] = { pressed: true, touched: true, value: 1 }; __pad.timestamp++; await w(250);
    __pad.buttons[b] = { pressed: false, touched: false, value: 0 }; __pad.timestamp++; await w(350); }, b);
  try {
    await pp.goto(base + '?platform=windows&shelf=1&shots=1'); await pp.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
    await pp.waitForTimeout(2500);
    for (let i = 0; i < 8; i++) { if (await pp.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await pp.keyboard.press('ArrowRight'); await pp.waitForTimeout(350); }
    await pp.keyboard.press('i'); await pp.waitForFunction(() => Shelf.getMode() === 'details' && document.querySelectorAll('#dShots .d-shot').length > 2, null, { timeout: 15000, polling: 200 });
    await pp.waitForTimeout(900); await pp.focus('#dShots .d-shot:nth-child(1)'); await pp.keyboard.press('Enter'); await pp.waitForTimeout(600);
    await press(5); o.pRb = await sn(); await press(15); o.pRight = await sn(); await press(4); o.pLb = await sn();
    await press(1); await pp.waitForTimeout(500); o.pBack = await sn();
  } catch (e) { o.perr = e.message; }
  await pctx.close();
  check('Screenshots: the controller goes through them (RB, right, LB) and B goes back to Details', (o.pRb || {}).n === '2 / 8' && (o.pRight || {}).n === '3 / 8' && (o.pLb || {}).n === '2 / 8' && /RB/.test((o.pLb || {}).keys || '') && (o.pBack || {}).mode === 'details',
    JSON.stringify({ rb: o.pRb, right: o.pRight, lb: o.pLb, back: o.pBack, err: o.perr }));
  const a = o.open || {}, n = o.next || {}, p = o.prev || {}, c = o.closed || {};
  check('Screenshots (beta.12, Windows): A / Enter on one opens it full screen ("2 / 8"); right and left go through them', a.mode === 'shot' && a.on && a.img && a.fits !== false && a.n === '2 / 8' && n.n === '3 / 8' && p.n === '1 / 8', JSON.stringify({ a, n, p }));
  check('Screenshots: B / Esc goes back to Details on the screenshot you ended on, the viewer gone', c.mode === 'details' && !c.on && !c.shown && c.focusShot === 0, JSON.stringify(c));
  check('Screenshots: the mouse opens one with a click and closes it with a click beside the picture', (o.mOpen || {}).mode === 'shot' && (o.mOpen || {}).n === '4 / 8' && (o.mClosed || {}).mode === 'details' && !(o.mClosed || {}).shown, JSON.stringify({ mOpen: o.mOpen, mClosed: o.mClosed, err: o.err }));
  check('Screenshot viewer pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
