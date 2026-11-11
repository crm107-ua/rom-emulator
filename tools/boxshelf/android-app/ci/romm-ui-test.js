// Device test (beta.12): RomM on the Windows page, with the pretend API (renderer/mock.js): Settings → Accounts & services →
// RomM (the address, Pair shows the QR card and pairs once approved, the code route, Test, the rows that need a pairing),
// and the shelf (a RomM game not on this device has the cloud badge; B on its download stops it). Checks results only.
'use strict';
module.exports = async function rommUiPass({ browser, base, check }) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [null, null, null, null] }); } catch (e) {}
    // the scan gives one GameCube game a RomM "not downloaded" mark, as main does for RomM games
    let real; Object.defineProperty(window, 'boxshelf', { configurable: true, get() { return real; }, set(v) { real = v; const scan = v.scan;
      v.scan = async (...a) => { const out = await scan(...a); const gc = out.find(s => s.id === 'gc'); if (gc && gc.games && gc.games[1]) gc.games[1].romm = { id: 7, cloud: true, size: 1e9 }; return out; };
      v.scanIfChanged = () => v.scan();
      const lg = v.launchGame; v.launchGame = async (...a) => { if (window.__holdLaunch) { await new Promise(r => { window.__releaseLaunch = r; }); } return lg(...a); }; } }); });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '?platform=windows&shelf=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.Setup && window.Settings, null, { timeout: 90000, polling: 250 });
    const s = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), o = {};
      const rows = () => [...document.querySelectorAll('#bss .bss-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim().slice(0, 120));
      const row = n => [...document.querySelectorAll('#bss .bss-row')].find(r => ((r.querySelector('.nm') || {}).textContent || '') === n);
      const c = (await window.boxshelf.getConfig()).config; c.romm = { server: 'http://192.168.1.20:8080', skipTls: false, cloud: true }; await window.boxshelf.saveConfig(c);
      const ci = Shelf.config && Shelf.config(); if (ci && ci.config) ci.config.romm = c.romm;
      Setup.open({ page: 'acct' }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150); await w(800);
      o.acct = rows().filter(n => /^RomM/.test(n));
      if (row('RomM')) { row('RomM').click(); await w(900); } o.page = rows().slice(0, 4);
      o.unpairedHidden = !row('Look for new games now') && !row('Sign out of RomM');
      const p = row('Pair Boxshelf with RomM'); if (p) { p.click(); await w(600); }
      o.card = !!document.querySelector('#bss .bss-pairbox .qr svg') && /ABCD-EFGH/.test((document.querySelector('#bss .bss-pairbox') || {}).textContent || '');
      for (let i = 0; i < 30 && !/Paired/.test((document.querySelector('#bss .bss-pairbox') || {}).textContent || ''); i++) await w(200);
      o.paired = /Paired/.test((document.querySelector('#bss .bss-pairbox') || {}).textContent || ''); await w(600);
      o.pairedRows = !!row('Look for new games now') && !!row('Sign out of RomM') && !!row('Show games that aren\'t on this device');
      const t = row('Test the connection'); if (t) { t.click(); for (let i = 0; i < 20 && !/Connected/.test(t.innerText); i++) await w(150); } o.test = t ? t.innerText.replace(/\s+/g, ' ') : '';
      await Settings.close(); await w(800);
      // the shelf: GameCube's 2nd game is a RomM game not downloaded: its case has the cloud
      const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      for (let i = 0; i < 20 && !(Shelf._qs().s === 'gc' || /GameCube/i.test(((document.getElementById('sysWord') || {}).textContent || ''))); i++) { key('ArrowDown'); await w(400); }
      await w(1200); o.cloud = document.querySelectorAll('.slot.cloud').length;
      return o; });
    check('RomM (beta.12): Accounts & services lists RomM; its page pairs by QR (the card shows the code, then Paired), the paired-only rows appear, Test says Connected',
      s.acct.length === 1 && s.page.some(n => /^Server address/.test(n)) && s.unpairedHidden && s.card && s.paired && s.pairedRows && /Connected/.test(s.test), JSON.stringify(s).slice(0, 600));
    check('RomM (beta.12): a RomM game not on this device has the cloud on its case', s.cloud >= 1, JSON.stringify({ cloud: s.cloud }));
    check('RomM pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) { check('RomM pass ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
  await ctx.close();
};
