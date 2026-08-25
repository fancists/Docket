'use strict';
/* ============================================================
   DocKit — สำเนาบัตร หน้า-หลัง บนแผ่นเดียว
   ตัดขอบบัตรอัตโนมัติ ดัดให้ตรง แล้ววางบนกระดาษขนาดเท่าของจริง
   ============================================================ */

const CARD = { w: 85.6, h: 53.98, r: 3.18 };  // ID-1 + รัศมีมุมโค้งตามมาตรฐาน ISO/IEC 7810
const CARD_DPI = 300;

const IdCard = {
  front: null, back: null,                  // {blob, canvas}
  paper: 'a4', scale: 100, stamp: true, strike: true, round: true,
  lines: ['สำเนาถูกต้อง', 'ใช้สำหรับสมัครงานเท่านั้น'],
  color: '#1a3a8f'
};

/* ตัดบัตรออกจากรูปถ่าย: หาขอบ -> ดัด perspective -> ปรับให้อ่านง่าย */
async function cardFromFile(file){
  const bm = await blobToBitmap(file);
  const sc = Math.min(1, 2800 / Math.max(bm.width, bm.height));
  let cv = mkCanvas(bm.width * sc, bm.height * sc);
  cv.getContext('2d').drawImage(bm, 0, 0, cv.width, cv.height);
  if (bm.close) bm.close();

  const c = cardCorners(cv);
  const corners = c || centreQuad();
  return Object.assign(
    { src: cv, corners, auto: !!c },
    await renderCard(cv, corners)
  );
}

/* กรอบกลางภาพตามสัดส่วนบัตร — ใช้ตอนหาขอบไม่เจอ ผู้ใช้ลากปรับต่อได้ */
function centreQuad(){
  const ar = CARD.w / CARD.h;
  let w = 0.86, h = w / ar * (4 / 3);      // เดาอัตราส่วนภาพถ่ายกว้าง:สูง ~4:3
  if (h > 0.86){ h = 0.86; w = h * ar * (3 / 4); }
  const x = (1 - w) / 2, y = (1 - h) / 2;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/* เส้นทางสี่เหลี่ยมมุมโค้ง — เขียนด้วย arcTo เอง ไม่ใช้ ctx.roundRect
   เพราะ Safari รุ่นก่อน 16.4 ยังไม่มี (แอปนี้ใช้บน iPhone เป็นหลัก) */
function roundRectPath(ctx, x, y, w, h, r){
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

/* ลบมุมสี่เหลี่ยมออกให้เหลือมุมโค้งเท่าบัตรจริง
   เติมส่วนที่ตัดด้วยสีขาว (ไม่ใช้ PNG โปร่งใส) เพราะบัตรวางบนกระดาษขาวอยู่แล้ว
   และคง JPEG ไว้ได้ — ถ้าเปลี่ยนเป็น PNG ไฟล์รูปถ่ายจะใหญ่ขึ้นหลายเท่า */
function roundCardCorners(cv){
  const rPx = cv.width * (CARD.r / CARD.w);
  const keep = mkCanvas(cv.width, cv.height);
  keep.getContext('2d').drawImage(cv, 0, 0);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.save();
  roundRectPath(ctx, 0, 0, cv.width, cv.height, rPx);
  ctx.clip();
  ctx.drawImage(keep, 0, 0);
  ctx.restore();
  // เส้นขอบบางๆ ให้เห็นรูปทรงบัตรชัดบนกระดาษขาว (บัตรสีอ่อนไม่งั้นขอบจะกลืนหาย)
  ctx.strokeStyle = 'rgba(120,130,145,.55)';
  ctx.lineWidth = Math.max(1, cv.width * 0.0016);
  roundRectPath(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2,
                cv.width - ctx.lineWidth, cv.height - ctx.lineWidth, rPx);
  ctx.stroke();
  return cv;
}

/* ดัดสี่เหลี่ยมที่เลือกให้เป็นบัตรขนาดจริง */
async function renderCard(srcCv, corners){
  const W = Math.round(CARD.w / 25.4 * CARD_DPI);
  const H = Math.round(CARD.h / 25.4 * CARD_DPI);
  const pts = corners.map(([x, y]) => [x * srcCv.width, y * srcCv.height]);
  const cv = warpQuad(srcCv, pts, W, H);
  // ห้ามใช้ mode 'mag' (ตัวปรับแสงสำหรับกระดาษขาว-หมึกดำ) กับรูปบัตร — มันเข้าใจว่าพื้นบัตร
  // คือ "กระดาษพื้นหลัง" แล้วดันความสว่างให้ขาวจนภาพ/สีบนบัตรซีดจาง
  if (IdCard.round) roundCardCorners(cv);
  return { blob: await canvasToBlob(cv, 'image/jpeg', 0.96), canvas: cv };
}

/* สลับมุมโค้ง/มุมเหลี่ยม ต้องเรนเดอร์ใหม่จากภาพต้นฉบับ เพราะมุมถูกเผาลงในรูปแล้ว */
async function idRerenderSides(){
  for (const side of ['front', 'back']){
    const c = IdCard[side];
    if (c && c.src) Object.assign(c, await renderCard(c.src, c.corners));
  }
}

/* ---------- หาขอบบัตร ----------
   ตัวหาขอบของ "เอกสารเต็มเฟรม" ใช้กับบัตรใบเล็กในภาพไม่ได้ (Otsu แยกไม่ออก
   เวลาบัตรกับโต๊ะสว่างพอกัน) จึงลองหลายวิธีแล้วเลือกอันที่สัดส่วนใกล้บัตรจริงสุด */
const CARD_AR = CARD.w / CARD.h;           // ~1.586

function cardCorners(cv){
  const cands = [];
  for (const tol of [22, 34, 50, 70]){
    const q = quadFromBorderFlood(cv, tol);
    if (q) cands.push(q);
  }
  const otsu = autoCorners(cv);
  if (otsu) cands.push(otsu);

  let best = null, bestScore = -1;
  for (const q of cands){
    // ต้องวัดเป็นพิกเซลจริง ไม่ใช่พิกัด 0..1 — ภาพไม่จัตุรัส แกน x/y คนละสเกล
    const p = q.map(([x, y]) => [x * cv.width, y * cv.height]);
    const w = Math.max(dist(p[0], p[1]), dist(p[3], p[2]));
    const h = Math.max(dist(p[0], p[3]), dist(p[1], p[2]));
    if (!w || !h) continue;
    const arErr = Math.abs(Math.log((w / h) / CARD_AR));
    const frac = (w * h) / (cv.width * cv.height);
    if (arErr > 0.28 || frac < 0.015 || frac > 0.97) continue;   // ไม่ใช่ทรงบัตร
    const score = (1 - arErr / 0.28) * 0.75 + Math.min(1, frac / 0.55) * 0.25;
    if (score > bestScore){ bestScore = score; best = q; }
  }
  return best;
}
function dist(a, b){ return Math.hypot(a[0] - b[0], a[1] - b[1]); }

/* ลบ "พื้นโต๊ะ" ด้วยการ flood จากขอบภาพ แล้วเอาสิ่งที่เหลือเป็นตัวบัตร
   ทำงานได้ไม่ว่าบัตรจะสว่างหรือมืดกว่าพื้น ต่างจาก Otsu ที่ยึดความสว่างอย่างเดียว */
function quadFromBorderFlood(cv, tol){
  const S = 220, s = S / Math.max(cv.width, cv.height);
  const w = Math.max(1, Math.round(cv.width * s)), h = Math.max(1, Math.round(cv.height * s));
  const sm = mkCanvas(w, h);
  sm.getContext('2d').drawImage(cv, 0, 0, w, h);
  const d = sm.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;

  let r = 0, g = 0, b = 0, n = 0;
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.04));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++){
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
  r /= n; g /= n; b /= n;

  const lim = tol * tol * 3;
  const bgMask = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let qs = 0, qe = 0;
  const push = j => { if (!bgMask[j]){ const i = j * 4;
    const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
    if (dr * dr + dg * dg + db * db <= lim){ bgMask[j] = 1; q[qe++] = j; } } };
  for (let x = 0; x < w; x++){ push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++){ push(y * w); push(y * w + w - 1); }
  while (qs < qe){
    const j = q[qs++], x = j % w, y = (j / w) | 0;
    if (x > 0) push(j - 1);
    if (x < w - 1) push(j + 1);
    if (y > 0) push(j - w);
    if (y < h - 1) push(j + w);
  }

  // เดิมเคยหามุมจากพิกเซลสุดขั้วตามแนวทแยง (x+y / x-y) จุดเดียว — โดนเงา/แสง
  // สะท้อนที่หลุดออกนอกตัวบัตรเบี่ยงมุมง่าย โดยเฉพาะตอนถ่ายเอียง จึงเปลี่ยนมาใช้
  // ฮัลนูน + สี่เหลี่ยมพื้นที่น้อยสุด (rotating calipers) ซึ่งทนพิกเซลรบกวนกว่ามาก
  let cnt = 0;
  const pts = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++){
      if (bgMask[y * w + x]) continue;
      cnt++;
      pts.push([x, y]);
    }
  if (cnt < w * h * 0.02) return null;
  const hull = convexHull(pts);
  const rect = minAreaRect(hull);
  if (!rect) return null;
  return orderQuadTLFirst(rect).map(([x, y]) => [
    Math.max(0, Math.min(1, x / w)),
    Math.max(0, Math.min(1, y / h))
  ]);
}

async function idLoad(side, file){
  busy(true, 'กำลังตัดขอบบัตร…');
  try{
    IdCard[side] = await cardFromFile(file);
    toast(IdCard[side].auto ? 'ตัดขอบบัตรแล้ว — ไม่ตรงกดปรับขอบได้'
                            : 'หาขอบไม่เจอ กด "ปรับขอบ" เพื่อลากเอง', 3000);
    idDraw();
  } catch(e){ console.error(e); toast('เปิดรูปไม่สำเร็จ'); }
  busy(false);
}

/* โหลด PNG ตราคร่อมแบบ cache ไว้ ไม่ต้องสร้างใหม่ทุกเฟรม
   ต้องรอฟอนต์ Sarabun โหลดเสร็จก่อนวาดครั้งแรก — ถ้าวาดตอนฟอนต์ยังไม่มา
   เบราว์เซอร์จะสลับไปใช้ฟอนต์สำรองที่วางสระ/วรรณยุกต์ไทยผิด แล้วอันนั้นจะ
   ค้างอยู่ใน cache ตลอด (key เดิมไม่เปลี่ยนจนกว่าจะแก้ข้อความ) ดูเหมือนตัวอักษรขาดๆ */
let _stampCache = { key: null, img: null, ratio: 1 };
let _fontsReady = false;
if (document.fonts && document.fonts.ready){
  document.fonts.ready.then(() => {
    _fontsReady = true;
    _stampCache = { key: null, img: null, ratio: 1 };   // ล้างของเก่าที่อาจวาดด้วยฟอนต์สำรองไปแล้ว
    if (typeof idDraw === 'function' && App.view === 'idcard') idDraw();
    if (typeof wmDraw === 'function' && App.view === 'wm') wmDraw();
  }).catch(() => {});
}
async function stampImage(){
  const lines = IdCard.lines.filter(Boolean);
  const key = lines.join('|') + '|' + IdCard.color + '|' + IdCard.strike;
  if (_stampCache.key === key) return _stampCache;
  if (document.fonts && document.fonts.load && !_fontsReady){
    try { await document.fonts.load('700 96px Sarabun'); } catch(e){}
  }
  const st = makeStampPng(lines, IdCard.color, IdCard.strike);
  return new Promise(res => {
    const im = new Image();
    im.onload = () => { _stampCache = { key, img: im, ratio: st.ratio }; res(_stampCache); };
    im.onerror = () => res({ key, img: null, ratio: 1 });
    im.src = st.dataUrl;
  });
}

/* กล่องตราคร่อม — ตั้งใจให้ "คร่อม" ทับรอยต่อจริง ไม่ใช่ลอยอยู่ในช่องว่างระหว่างบัตร
   (คร่อมแบบนี้เป็นธรรมเนียมรับรองสำเนา: ตัดแยกหน้า/หลังออกจากกันไม่ได้โดยไม่ให้ตราขาด) */
const STAMP_MAX_W = 0.92;               // สัดส่วนความกว้างกระดาษที่ตราใช้ได้มากสุด
function stampBox(L, p, st){
  let h = L.gap * 1.35;                 // สูงกว่าช่องว่างเสมอ = คาบเข้าไปในบัตรทั้งสองด้านแน่นอน
  let w = h * (st.ratio || 1);
  const maxW = p.w * STAMP_MAX_W;
  if (w > maxW){ w = maxW; h = w / (st.ratio || 1); }
  return { w, h, cx: p.w / 2, cy: (L.y1 + L.ch + L.y2) / 2 };
}

/* ช่องว่างระหว่างบัตรต้องแคบกว่าความสูงของตรา ไม่งั้นตราไปนั่งในช่องว่างเฉยๆ ไม่ทับบัตร
   ข้อความยาว = ตราแบนมาก พอหนีบความกว้างไม่ให้ล้นกระดาษ ความสูงจะหดต่ำกว่าช่องว่าง
   (เจอบน A4/Letter ที่ช่องว่างกว้าง 30+ มม.) จึงต้องบีบช่องว่างตามความแบนของตรา */
function idGapCapFor(p, st){
  if (!st || !st.img) return Infinity;
  const flatH = p.w * STAMP_MAX_W / (st.ratio || 1);   // ความสูงตราเมื่อกางเต็มความกว้าง
  return flatH * 0.72;                                  // ให้ตราสูงกว่าช่องว่างราว 1.35 เท่า
}

/* เรขาคณิตแผ่นเดียวที่ทั้งพรีวิวและตัวเขียน PDF ใช้ร่วมกัน — กันสองฝั่งคำนวณไม่ตรงกัน */
async function idGeom(p){
  const st = IdCard.stamp ? await stampImage() : null;
  const L = idLayout(p, idGapCapFor(p, st));
  return { L, st, sb: (st && st.img) ? stampBox(L, p, st) : null };
}

/* พรีวิวแผ่นกระดาษ */
let _idDrawToken = 0;
async function idDraw(){
  const cv = $('idCv');
  const p = PH_PAPERS.find(x => x.id === IdCard.paper) || PH_PAPERS[0];
  const maxH = Math.min(360, window.innerHeight * 0.4);
  const H = Math.round(maxH), W = Math.round(H * p.w / p.h);
  cv.width = W; cv.height = H;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  const tok = ++_idDrawToken;
  const { L, st, sb } = await idGeom(p);
  if (tok !== _idDrawToken) return;        // มีการวาดรอบใหม่แล้ว ทิ้งอันนี้
  const px = W / p.w;                      // มม. -> พิกเซลพรีวิว
  const drawCard = (side, y) => {
    const src = IdCard[side];
    const x = (p.w - L.cw) / 2;
    if (src) ctx.drawImage(src.canvas, x * px, y * px, L.cw * px, L.ch * px);
    else {
      ctx.strokeStyle = '#c8cdd6'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
      ctx.strokeRect(x * px, y * px, L.cw * px, L.ch * px); ctx.setLineDash([]);
      ctx.fillStyle = '#9aa4b2'; ctx.font = '600 11px Sarabun, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(side === 'front' ? 'ด้านหน้า' : 'ด้านหลัง',
                   (x + L.cw / 2) * px, (y + L.ch / 2) * px);
    }
  };
  drawCard('front', L.y1);
  drawCard('back', L.y2);

  $('idInfo').textContent = 'บัตรขนาดจริง ' + L.cw.toFixed(1) + ' × ' + L.ch.toFixed(1) +
    ' มม. บนกระดาษ ' + p.label;
  $('btnIdCropF').disabled = !IdCard.front;
  $('btnIdCropB').disabled = !IdCard.back;

  if (sb && st.img && (IdCard.front || IdCard.back)){
    ctx.globalAlpha = 0.92;
    ctx.drawImage(st.img, (sb.cx - sb.w / 2) * px, (sb.cy - sb.h / 2) * px, sb.w * px, sb.h * px);
    ctx.globalAlpha = 1;
  }
}

function idLayout(p, gapMax){
  const s = IdCard.scale / 100;
  const cw = CARD.w * s, ch = CARD.h * s;
  let gap = Math.max(10, (p.h - ch * 2) / 6);
  if (gapMax !== undefined) gap = Math.max(3, Math.min(gap, gapMax));
  const y1 = p.h / 2 - ch - gap / 2;
  const y2 = p.h / 2 + gap / 2;
  return { cw, ch, gap, y1, y2 };
}

async function idMakePdf(){
  if (!IdCard.front && !IdCard.back){ toast('ถ่ายรูปบัตรก่อน'); return; }
  busy(true, 'กำลังสร้างไฟล์…');
  try{
    const p = PH_PAPERS.find(x => x.id === IdCard.paper) || PH_PAPERS[0];
    if (document.fonts && document.fonts.load){
      try { await document.fonts.load('700 96px Sarabun'); } catch(e){}
    }
    // ใช้เรขาคณิตชุดเดียวกับพรีวิว ไฟล์ที่ได้จะตรงกับที่เห็นบนจอเสมอ
    const { L, st, sb } = await idGeom(p);
    const doc = await PDFLib.PDFDocument.create();
    const page = doc.addPage([p.w * MM, p.h * MM]);
    const x = (p.w - L.cw) / 2;

    for (const [side, y] of [['front', L.y1], ['back', L.y2]]){
      const src = IdCard[side];
      if (!src) continue;
      const img = await doc.embedJpg(new Uint8Array(await src.blob.arrayBuffer()));
      page.drawImage(img, { x: x * MM, y: (p.h - y - L.ch) * MM,
                            width: L.cw * MM, height: L.ch * MM });
    }
    if (sb && st.img){
      const b = await (await fetch(st.img.src)).arrayBuffer();
      const im = await doc.embedPng(new Uint8Array(b));
      page.drawImage(im, {
        x: (sb.cx - sb.w / 2) * MM, y: (p.h - sb.cy - sb.h / 2) * MM,
        width: sb.w * MM, height: sb.h * MM, opacity: 0.92
      });
    }
    const bytes = await doc.save({ useObjectStreams: true });
    showDone(new Blob([bytes], { type: 'application/pdf' }), 'สำเนาบัตร.pdf', {
      title: 'สำเนาบัตรพร้อมปริ๊น',
      sub: 'บัตรขนาดเท่าของจริงบนกระดาษ ' + p.label + ' — สั่งพิมพ์แบบ “ขนาดจริง 100%”',
      continueTo: 'wm'
    });
  } catch(e){ console.error(e); toast('สร้างไฟล์ไม่สำเร็จ: ' + e.message, 4000); }
  busy(false);
}

/* ============================================================
   ปรับขอบบัตรเอง — auto พลาดเมื่อไหร่ยังกู้ได้ด้วยมือเสมอ
   ============================================================ */
const IdCrop = { side: null, corners: null, scale: 1 };

function openIdCrop(side){
  const c = IdCard[side];
  if (!c){ toast('ยังไม่มีรูปด้านนี้'); return; }
  IdCrop.side = side;
  IdCrop.corners = c.corners.map(p => p.slice());
  $('idCropTitle').textContent = side === 'front' ? 'ปรับขอบด้านหน้า' : 'ปรับขอบด้านหลัง';
  showView('idcrop');
  drawIdCrop();
}

function drawIdCrop(){
  const src = IdCard[IdCrop.side].src;
  const cv = $('idCropCv');
  const maxW = Math.min(window.innerWidth - 40, 640);
  const maxH = window.innerHeight * 0.5;
  const s = Math.min(maxW / src.width, maxH / src.height, 1);
  cv.width = Math.round(src.width * s);
  cv.height = Math.round(src.height * s);
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
  cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';

  const svg = $('idCropSvg');
  svg.setAttribute('viewBox', '0 0 ' + cv.width + ' ' + cv.height);
  svg.setAttribute('width', cv.width); svg.setAttribute('height', cv.height);
  const pts = IdCrop.corners.map(([x, y]) => (x * cv.width) + ',' + (y * cv.height)).join(' ');
  svg.innerHTML = '<polygon points="' + pts + '"></polygon>' +
    IdCrop.corners.map(([x, y], i) =>
      '<circle data-i="' + i + '" cx="' + (x * cv.width) + '" cy="' + (y * cv.height) + '" r="14"></circle>').join('');
}

function wireIdCrop(){
  const svg = $('idCropSvg');
  let drag = null;
  svg.addEventListener('pointerdown', e => {
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    let best = -1, bd = 0.1;
    IdCrop.corners.forEach(([x, y], i) => {
      const d = Math.hypot(x - px, y - py);
      if (d < bd){ bd = d; best = i; }
    });
    if (best >= 0){ drag = best; svg.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  svg.addEventListener('pointermove', e => {
    if (drag === null) return;
    const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    IdCrop.corners[drag] = [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
    drawIdCrop();
    e.preventDefault();
  }, { passive: false });
  const up = () => { drag = null; };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
}

function idCropAuto(){
  const c = cardCorners(IdCard[IdCrop.side].src);
  if (!c){ toast('หาขอบไม่เจอ ลากมุมเอาเองได้เลย'); return; }
  IdCrop.corners = c;
  drawIdCrop();
  toast('หาขอบให้แล้ว ปรับต่อได้');
}
function idCropFull(){
  IdCrop.corners = [[0.02, 0.02], [0.98, 0.02], [0.98, 0.98], [0.02, 0.98]];
  drawIdCrop();
}
async function idCropDone(){
  const side = IdCrop.side, c = IdCard[side];
  busy(true, 'กำลังดัดภาพ…');
  try{
    c.corners = IdCrop.corners.map(p => p.slice());
    Object.assign(c, await renderCard(c.src, c.corners));
    c.auto = false;
  } catch(e){
    console.error(e); busy(false);
    toast('ดัดภาพไม่สำเร็จ: ' + e.message, 3500);
    return;
  }
  busy(false);
  showView('idcard');
  idDraw();
}
