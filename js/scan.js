'use strict';
/* ============================================================
   DocKit — image enhancement (สแกนเอกสาร)
   crop (perspective) -> enhance -> rotate
   ============================================================ */

const Scan = { p: null, bm: null, corners: null, cropOn: false, prevScale: 1 };

/* summed-area table of an 8-bit plane (used by flat-field + adaptive threshold) */
function integralOf(gray, w, h){
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++){
    let run = 0;
    for (let x = 0; x < w; x++){
      run += gray[y * w + x];
      S[(y + 1) * (w + 1) + (x + 1)] = S[y * (w + 1) + (x + 1)] + run;
    }
  }
  return S;
}

/* ---------- pixel filters ---------- */
function applyFilter(cv, enh){
  const mode = enh.mode || 'orig';
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = im.data, n = d.length;

  if (mode === 'bw'){
    adaptiveBW(im, cv.width, cv.height, enh.bright | 0, enh.contrast | 0);
    ctx.putImageData(im, 0, 0);
    return cv;
  }

  if (mode !== 'orig'){
    // Flat-field: divide by a heavily blurred copy of the page so that vignette
    // and shadow gradients (the usual phone-photo problem) are removed. A global
    // histogram stretch cannot do this — it leaves half the sheet grey.
    const gray = new Uint8Array(n / 4);
    for (let i = 0, j = 0; i < n; i += 4, j++)
      gray[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;

    const w = cv.width, h = cv.height;
    const S = integralOf(gray, w, h);
    const r = Math.max(12, Math.round(Math.min(w, h) / 7));
    for (let y = 0; y < h; y++){
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++){
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const bg = (S[(y1 + 1) * (w + 1) + (x1 + 1)] - S[y0 * (w + 1) + (x1 + 1)]
                  - S[(y1 + 1) * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / area;
        const gain = 238 / Math.max(24, bg);
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++){
          const v = d[i + c] * gain;
          d[i + c] = v > 255 ? 255 : v;
        }
      }
    }

    // then a global stretch so ink goes properly black
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i += 4)
      hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
    const total = n / 4;
    let acc = 0, lo = 0;
    for (let v = 0; v < 256; v++){ acc += hist[v]; if (acc > total * 0.012){ lo = v; break; } }

    // จุดขาว = "ระดับของกระดาษ" (median ของพิกเซลฝั่งสว่าง)
    // ห้ามใช้ percentile บนสุด เพราะโดนแสงสะท้อนจุดเดียวดึงขึ้นไป
    // แล้วกระดาษทั้งแผ่นจะจบต่ำกว่าขาว = ภาพหม่นทั้งใบ
    let bright = 0;
    for (let v = 128; v < 256; v++) bright += hist[v];
    let paper = 238;
    if (bright > total * 0.05){
      let a2 = 0;
      for (let v = 128; v < 256; v++){ a2 += hist[v]; if (a2 >= bright / 2){ paper = v; break; } }
    }
    lo = Math.max(0, Math.min(lo, paper - 55));
    const k = 255 / Math.max(30, paper - lo);
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++){
      const x = (v - lo) * k;
      lut[v] = x < 0 ? 0 : x > 255 ? 255 : x;
    }
    for (let i = 0; i < n; i += 4){ d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }

    if (mode === 'gray'){
      for (let i = 0; i < n; i += 4){
        const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
        d[i] = d[i + 1] = d[i + 2] = g;
      }
    }
  }

  // brightness / contrast sliders
  const b = (enh.bright | 0), cst = (enh.contrast | 0);
  if (b || cst){
    const f = (259 * (cst + 255)) / (255 * (259 - cst));
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++){
      let x = f * (v - 128) + 128 + b;
      lut[v] = x < 0 ? 0 : x > 255 ? 255 : x;
    }
    for (let i = 0; i < n; i += 4){ d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  }
  ctx.putImageData(im, 0, 0);
  return cv;
}

/* adaptive threshold (integral image) — crisp black/white document */
function adaptiveBW(im, w, h, bright, contrast){
  const d = im.data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < w * h; i += 4, j++)
    gray[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;

  const S = integralOf(gray, w, h);
  const r = Math.max(8, Math.round(Math.min(w, h) / 22));   // half window
  const bias = 8 + contrast * 0.12 - bright * 0.25;         // sliders nudge threshold

  for (let y = 0; y < h; y++){
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++){
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = S[(y1 + 1) * (w + 1) + (x1 + 1)] - S[y0 * (w + 1) + (x1 + 1)]
                - S[(y1 + 1) * (w + 1) + x0] + S[y0 * (w + 1) + x0];
      const mean = sum / area;
      const v = gray[y * w + x] < mean - bias ? 0 : 255;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
}

/* ---------- perspective warp ---------- */
function solve8(A, b){
  const n = 8;
  for (let i = 0; i < n; i++){
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    if (piv !== i){ const t = A[i]; A[i] = A[piv]; A[piv] = t; const tb = b[i]; b[i] = b[piv]; b[piv] = tb; }
    const p = A[i][i];
    if (Math.abs(p) < 1e-12) return null;
    for (let r = i + 1; r < n; r++){
      const f = A[r][i] / p;
      if (!f) continue;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--){
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

/* corners: [[x,y]x4] in src pixels, order TL,TR,BR,BL. Returns warped canvas. */
function warpQuad(srcCv, corners, outW, outH){
  const dst = [[0, 0], [outW, 0], [outW, outH], [0, outH]];
  const A = [], b = [];
  for (let k = 0; k < 4; k++){
    const [u, v] = dst[k], [x, y] = corners[k];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  const H = solve8(A, b);
  if (!H) return srcCv;
  const [a, bb, c, dd, e, f, g, hh] = H;

  const sctx = srcCv.getContext('2d', { willReadFrequently: true });
  const src = sctx.getImageData(0, 0, srcCv.width, srcCv.height);
  const sd = src.data, sw = srcCv.width, sh = srcCv.height;

  const out = mkCanvas(outW, outH);
  const octx = out.getContext('2d');
  const oi = octx.createImageData(out.width, out.height);
  const od = oi.data;
  const W = out.width, Hh = out.height;

  for (let y = 0; y < Hh; y++){
    for (let x = 0; x < W; x++){
      const den = g * x + hh * y + 1;
      const sx = (a * x + bb * y + c) / den;
      const sy = (dd * x + e * y + f) / den;
      const o = (y * W + x) * 4;
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1){
        od[o] = od[o + 1] = od[o + 2] = 255; od[o + 3] = 255; continue;
      }
      const x0 = sx | 0, y0 = sy | 0;
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4,
            i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let ch = 0; ch < 3; ch++){
        const top = sd[i00 + ch] * (1 - fx) + sd[i10 + ch] * fx;
        const bot = sd[i01 + ch] * (1 - fx) + sd[i11 + ch] * fx;
        od[o + ch] = top * (1 - fy) + bot * fy;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(oi, 0, 0);
  return out;
}

/* ---------- build final canvas for an image page ---------- */
async function buildImageCanvas(p, maxPx){
  const bm = await blobToBitmap(p.img.blob);
  let cv = mkCanvas(bm.width, bm.height);
  cv.getContext('2d').drawImage(bm, 0, 0);
  if (bm.close) bm.close();

  if (p.img.crop){
    const c = p.img.crop.map(([x, y]) => [x * cv.width, y * cv.height]);
    const dist = (a, b2) => Math.hypot(a[0] - b2[0], a[1] - b2[1]);
    let w = Math.max(dist(c[0], c[1]), dist(c[3], c[2]));
    let h = Math.max(dist(c[0], c[3]), dist(c[1], c[2]));
    w = Math.max(40, Math.round(w)); h = Math.max(40, Math.round(h));
    cv = warpQuad(cv, c, w, h);
  }

  if (maxPx){
    const s = maxPx / Math.max(cv.width, cv.height);
    if (s < 1){
      const t = mkCanvas(cv.width * s, cv.height * s);
      t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height);
      cv = t;
    }
  }

  applyFilter(cv, p.img.enh);
  p.img.outW = cv.width; p.img.outH = cv.height;
  if (p.rotate) cv = rotateCanvas(cv, p.rotate);
  return cv;
}

/* ---------- auto edge detection ---------- */
function autoCorners(cv){
  const W = 260, s = W / Math.max(cv.width, cv.height);
  const w = Math.max(1, Math.round(cv.width * s)), h = Math.max(1, Math.round(cv.height * s));
  const sm = mkCanvas(w, h);
  sm.getContext('2d').drawImage(cv, 0, 0, w, h);
  const d = sm.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;

  const gray = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < w * h; i += 4, j++){
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[j] = g; hist[g]++;
  }
  // Otsu
  const tot = w * h;
  let sum = 0; for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let v = 0; v < 256; v++){
    wB += hist[v]; if (!wB) continue;
    const wF = tot - wB; if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best){ best = between; thr = v; }
  }
  // paper = brighter side; keep only the component touching the image centre
  const mask = new Uint8Array(w * h);
  for (let j = 0; j < w * h; j++) mask[j] = gray[j] > thr ? 1 : 0;

  const seedX = w >> 1, seedY = h >> 1;
  if (!mask[seedY * w + seedX]) return null;
  const stack = [seedY * w + seedX], seen = new Uint8Array(w * h);
  seen[seedY * w + seedX] = 1;
  let cnt = 0, pts = [];
  while (stack.length){
    const j = stack.pop(); cnt++;
    const x = j % w, y = (j / w) | 0;
    pts.push([x, y]);
    if (x > 0 && mask[j - 1] && !seen[j - 1]){ seen[j - 1] = 1; stack.push(j - 1); }
    if (x < w - 1 && mask[j + 1] && !seen[j + 1]){ seen[j + 1] = 1; stack.push(j + 1); }
    if (y > 0 && mask[j - w] && !seen[j - w]){ seen[j - w] = 1; stack.push(j - w); }
    if (y < h - 1 && mask[j + w] && !seen[j + w]){ seen[j + w] = 1; stack.push(j + w); }
  }
  if (cnt < tot * 0.10 || cnt > tot * 0.985) return null;   // no useful edge found

  let tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0];
  let minS = 1e9, maxS = -1e9, minD = 1e9, maxD = -1e9;
  for (const [x, y] of pts){
    const S = x + y, D = x - y;
    if (S < minS){ minS = S; tl = [x, y]; }
    if (S > maxS){ maxS = S; br = [x, y]; }
    if (D > maxD){ maxD = D; tr = [x, y]; }
    if (D < minD){ minD = D; bl = [x, y]; }
  }
  return [tl, tr, br, bl].map(([x, y]) => [x / w, y / h]);
}

/* ---------- scan view ---------- */

/* leaving crop mode must keep the corners the user set, otherwise switching
   filter/rotate right after cropping silently throws the crop away */
function commitCrop(){
  if (!Scan.p) return;
  Scan.p.img.crop = (Scan.cropOn && Scan.corners) ? Scan.corners.map(c => c.slice()) : Scan.p.img.crop;
  Scan.cropOn = false;
}
async function openScan(id){
  const p = App.pages.find(x => x.id === id);
  if (!p || p.kind !== 'img') return;
  Scan.p = p; Scan.cropOn = false;
  Scan.corners = p.img.crop ? p.img.crop.map(c => c.slice()) : null;
  App.scanId = id;
  $('slBright').value = p.img.enh.bright;
  $('slContrast').value = p.img.enh.contrast;
  document.querySelectorAll('#modeSeg button').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === p.img.enh.mode));
  showView('scan');
  busy(true, 'กำลังเปิด…');
  Scan.bm = await blobToBitmap(p.img.blob);
  await drawScan();
  busy(false);
}

async function drawScan(){
  const p = Scan.p, cv = $('scanCv');
  const maxW = Math.min(window.innerWidth - 20, 640);
  const maxH = window.innerHeight * 0.46;

  let img;
  if (Scan.cropOn){
    img = mkCanvas(Scan.bm.width, Scan.bm.height);
    img.getContext('2d').drawImage(Scan.bm, 0, 0);
  } else {
    img = await buildImageCanvas(p, 1100);
  }
  const s = Math.min(maxW / img.width, maxH / img.height, 1);
  cv.width = Math.round(img.width * s);
  cv.height = Math.round(img.height * s);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  cv.style.width = cv.width + 'px';
  cv.style.height = cv.height + 'px';
  drawCropOverlay();
}

function drawCropOverlay(){
  const svg = $('cropSvg'), cv = $('scanCv');
  svg.classList.toggle('on', Scan.cropOn);
  if (!Scan.cropOn){ svg.innerHTML = ''; return; }
  const c = Scan.corners || [[.06, .06], [.94, .06], [.94, .94], [.06, .94]];
  Scan.corners = c;
  svg.setAttribute('viewBox', '0 0 ' + cv.width + ' ' + cv.height);
  svg.setAttribute('width', cv.width); svg.setAttribute('height', cv.height);
  const pts = c.map(([x, y]) => (x * cv.width) + ',' + (y * cv.height)).join(' ');
  let html = '<polygon points="' + pts + '"></polygon>';
  c.forEach(([x, y], i) => {
    html += '<circle data-i="' + i + '" cx="' + (x * cv.width) + '" cy="' + (y * cv.height) + '" r="13"></circle>';
  });
  svg.innerHTML = html;
}

function wireCropDrag(){
  const svg = $('cropSvg');
  let drag = null;
  svg.addEventListener('pointerdown', e => {
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    let best = -1, bd = 0.09;
    Scan.corners.forEach(([x, y], i) => {
      const d = Math.hypot(x - px, y - py);
      if (d < bd){ bd = d; best = i; }
    });
    if (best >= 0){ drag = best; svg.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  svg.addEventListener('pointermove', e => {
    if (drag === null) return;
    const r = svg.getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    Scan.corners[drag] = [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
    drawCropOverlay();
    e.preventDefault();
  });
  const up = () => { drag = null; };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
}
