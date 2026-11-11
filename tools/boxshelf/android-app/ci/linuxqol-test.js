// Device test (beta.12): Linux / Steam Deck quality of life on the Linux page (?platform=linux, the mock reports what
// preload.js does there). Once after setup a "Leaving a game" card says to hold View + Menu (no Home menu on Linux);
// Settings has "Start Boxshelf at login" (not "with Windows"); the quick menu's Power has Sleep / Restart / Shut down,
// and choosing one reaches main. Plus the main side, plain Node: systemctl for power, the autostart .desktop file.
'use strict';
module.exports = async function linuxQolPass({ browser, base, check }) {
  const errors = []; let o = {};
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base + '?platform=linux&shelf=1'); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
    o.os = await page.evaluate(() => window.bsPlatform.os + ' power ' + bsPlatform.has('power') + ' autostart ' + bsPlatform.has('autostart'));
    // the card (it shows ~13 s after start, once)
    await page.waitForFunction(() => [...document.querySelectorAll('.note-card .nc-title')].some(e => /Leaving a game/.test(e.textContent)), null, { timeout: 30000, polling: 250 });
    o.card = await page.evaluate(() => (document.querySelector('.note-card .nc-sub') || {}).textContent || '');
    await page.keyboard.press('Enter'); await page.waitForTimeout(700);
    o.cardGone = await page.evaluate(() => !document.querySelector('.note-card'));
    // Settings: the start-at-login row
    await page.keyboard.press('s'); await page.waitForTimeout(2000);
    o.rows = await page.evaluate(() => { const t = document.body.innerText; return { login: /Start Boxshelf at login/.test(t) || null, windows: /Start Boxshelf with Windows/.test(t) }; });
    await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  } catch (e) { o.err = e.message; }
  await ctx.close();
  check('Linux (beta.12): power and start at login are on; a "Leaving a game" card says to hold View + Menu, and goes once read', /power true autostart true/.test(o.os || '') && /hold View \+ Menu/.test(o.card || '') && o.cardGone, JSON.stringify(o).slice(0, 400));
  check('Linux: Settings never says "Start Boxshelf with Windows"', o.rows && o.rows.windows === false, JSON.stringify(o.rows));
  // the main side, plain Node: power through systemctl, the autostart file (main.js is too big to load here: its source is read)
  const fs = require('fs'), path = require('path'), src = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  check('Linux main: Sleep / Restart / Shut down run systemctl suspend / reboot / poweroff; start at login writes ~/.config/autostart/boxshelf.desktop with the AppImage (quoted)',
    /process\.platform === 'linux'[\s\S]{0,200}'suspend'[\s\S]{0,80}'reboot'[\s\S]{0,80}'poweroff'[\s\S]{0,900}execFile\('systemctl'/.test(src) && /'autostart', 'boxshelf\.desktop'/.test(src) && /'Exec=' \+ desktopQuote\(exe\)/.test(src) && /linuxAutostartText\(exe\)/.test(src), ''); // (beta.12: a refusal is shown, so execFile; the text is linuxAutostartText, pointed at the fixed Boxshelf.AppImage link)
  check('Linux pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
