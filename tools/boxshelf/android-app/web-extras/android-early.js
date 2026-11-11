// Android build only (copy-web.js puts it first in <head>, before anything reads the pixel ratio).
// The Android page is laid out 1440 CSS px wide and the WebView scales it to fit the screen (page zoom), but
// window.devicePixelRatio still reports the device's own density (2.25 on the AYN Thor). Every canvas sized from it
// (Inspect, the 3D case model, the theme layer, cover thumbnails, manual pages) was drawn 1.7x too wide and tall, up to
// 2.8x the pixels the screen actually shows. Here the ratio is what it really is for this layout: screen pixels per CSS
// pixel (1920 / 1440 = 1.33 on the Thor), read live so a rotation or window change stays right.
// (beta.11) Text size. The page's layout width sets how big everything is (the WebView scales the page to fill the screen
// whatever its shape): Normal 1440, Large 1280, Larger 1152 CSS px. Automatic (the default) goes by the screen's real
// size and Android's own font size: a 6" Thor stays at 1440; a smaller screen, or a bigger system font, gets bigger
// text. Set here, before the page lays anything out (this script runs before any layout); a change in Settings reloads
// the page. bs-textsize: the choice; bs-fontscale: Android's font size (android-api.js keeps it up to date).
// (beta.12) Largest (1024) added; Automatic starts from 1280 on a handheld or phone (the Thor's text was too small at
// 1440: 11-14 px labels read at arm's length), 1440 only on a tablet-sized screen (7" or more along its long side).
// (0.5) Phones, tablets and foldables in portrait too. A wide window (landscape, at least 600 dp across) keeps exactly
// the numbers above (the Thor: 1280). A tall or narrow window (portrait, split screen) is laid out from its own width
// instead: about 1.15 CSS px per dp (Automatic), 360 to 756 px, so it gets the app's own narrow layout (style.css
// max-width:760px) with text a phone can read. On a rotation or window change the width is worked out again, once per
// change (debounced), and the viewport tag is only rewritten when the number differs: one relayout, never a loop.
(function () {
  const WIDE = { normal: 1440, large: 1280, larger: 1152, largest: 1024 };
  const NARROW = { auto: 1.15, normal: 1.3, large: 1.15, larger: 1.03, largest: .92 };
  let pref = 'auto', fs = 1;
  try { pref = localStorage.getItem('bs-textsize') || 'auto'; fs = Math.min(1.3, Math.max(1, +localStorage.getItem('bs-fontscale') || 1)); } catch {}
  if (!NARROW[pref]) pref = 'auto';
  // the window in dp. Full screen (the usual case, and always the Thor): the screen itself, as before. Only a window
  // whose shape is far from the screen's (split screen, a freeform window) is measured from the page's own zoom.
  function win() {
    const sw = screen.width || 0, sh = screen.height || 0, iw = innerWidth || 0, ih = innerHeight || 0;
    let w = sw, h = sh;
    if (sw && sh && iw && ih && sw > sh !== iw > ih) { w = sh; h = sw; }
    if (w && h && iw && ih && Math.abs((iw / ih) / (w / h) - 1) > .15) {
      const s = window.visualViewport && visualViewport.scale, e = s > 0 ? iw * s : 0;
      if (e >= 200 && e < w) { w = e; h = e * ih / iw; }
    }
    return { w, h };
  }
  function layoutW() {
    const d = win();
    if (!d.w || !d.h) return WIDE[pref] || 1280;
    if (d.w > d.h && d.w >= 600) {
      let w = WIDE[pref];
      if (!w) { const inches = Math.max(screen.width || 0, screen.height || 0) / 160; // (1 dp = 1/160 inch; the Thor: 853 dp, 5.3")
        const base = inches >= 7 ? 1440 : 1280, k = Math.min(1.25, Math.max(1, inches > 2 ? 5.3 / inches : 1)) * fs;
        w = Math.max(1024, Math.min(1440, Math.round(base / k / 16) * 16)); }
      return w;
    }
    const k = NARROW[pref] / (pref === 'auto' ? fs : 1);
    return Math.max(360, Math.min(756, Math.round(d.w * k / 4) * 4)); // (under 760: app.js sizes the cases for a narrow page below 760)
  }
  function apply(w) {
    window.__bsLayoutW = w;
    const m = document.querySelector('meta[name="viewport"]');
    if (m && m.getAttribute('content') !== 'width=' + w + ',user-scalable=no') m.setAttribute('content', 'width=' + w + ',user-scalable=no');
    const r = document.documentElement;
    if (r) r.classList.toggle('bs-narrow', w <= 760);
  }
  try { apply(layoutW()); } catch (e) { window.__bsLayoutW = 1440; }
  let t = 0;
  const again = () => { clearTimeout(t); t = setTimeout(() => { try { const w = layoutW(); if (w !== window.__bsLayoutW) apply(w); } catch {} }, 180); };
  addEventListener('orientationchange', again);
  addEventListener('resize', again);
})();
(function () {
  if (window.__bsDprFixed) return; window.__bsDprFixed = true;
  const desc = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio') || Object.getOwnPropertyDescriptor(Window.prototype, 'devicePixelRatio');
  const real = () => { try { return (desc && desc.get ? desc.get.call(window) : 0) || 1; } catch { return 1; } };
  window.__bsRealDpr = real;
  // (beta.8) worked out once and kept until the window changes size: reading innerWidth on every devicePixelRatio read
  // (cover thumbnails ask for it per case while the shelf slides) made the page lay out right then, mid-slide
  let kept = 0;
  function effective() {
    if (kept) return kept;
    const r = real(), sw = Math.max(screen.width || 0, screen.height || 0), iw = Math.max(innerWidth || 0, innerHeight || 0);
    if (!sw || !iw) return r;                     // (0 sizes while loading: not kept, asked again next time)
    const e = r * sw / iw;                        // physical screen pixels across ÷ CSS pixels across
    return (kept = e > .5 && e < r ? Math.round(e * 1000) / 1000 : r); // only ever lowers it
  }
  const forget = () => { kept = 0; };
  addEventListener('resize', forget); addEventListener('orientationchange', forget); addEventListener('load', forget);
  try { Object.defineProperty(window, 'devicePixelRatio', { configurable: true, enumerable: true, get: effective, set() {} }); } catch {}
})();
