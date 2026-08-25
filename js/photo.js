'use strict';
/* ============================================================
   DocKit — รูปติดบัตร: ครอบตามขนาดมาตรฐาน + เปลี่ยนสีพื้นหลัง
   + จัดเลย์เอาต์ลงกระดาษให้ปริ๊นได้ตรงขนาดจริง
   ============================================================ */

const MM = 72 / 25.4;              // มิลลิเมตร -> point (PDF)
const PH_DPI = 300;                // ความละเอียดรูปที่ฝังลงไฟล์

const PH_SIZES = [
  { id: 'th1',  label: '1 นิ้ว (2.5 × 3.2 ซม.)',              w: 25,   h: 32 },
  { id: 'pp',   label: '1.5 นิ้ว / พาสปอร์ต (3.5 × 4.5 ซม.)', w: 35,   h: 45 },
  { id: 'th2',  label: '2 นิ้ว (4 × 5 ซม.)',                  w: 40,   h: 50 },
  { id: 'us2',  label: 'วีซ่าสหรัฐฯ (2 × 2 นิ้ว)',             w: 50.8, h: 50.8 }
];
/* กระดาษที่จัดเลย์เอาต์ให้ได้ — เพิ่มขนาดใหม่ = เติมแถวเดียวในลิสต์นี้ */
const PH_PAPERS = [
  { id: 'a4',    label: 'A4 (21 × 29.7 ซม.)',        w: 210,   h: 297,   margin: 8 },
  { id: 'a5',    label: 'A5 (14.8 × 21 ซม.)',        w: 148,   h: 210,   margin: 6 },
  { id: 'a3',    label: 'A3 (29.7 × 42 ซม.)',        w: 297,   h: 420,   margin: 10 },
  { id: 'letter',label: 'Letter (8.5 × 11 นิ้ว)',     w: 215.9, h: 279.4, margin: 8 },
  { id: '4x6',   label: 'อัดรูป 4 × 6 นิ้ว',           w: 102,   h: 152,   margin: 5 },
  { id: '5x7',   label: 'อัดรูป 5 × 7 นิ้ว',           w: 127,   h: 178,   margin: 5 },
  { id: '6x8',   label: 'อัดรูป 6 × 8 นิ้ว',           w: 152,   h: 203,   margin: 5 },
  { id: '8x10',  label: 'อัดรูป 8 × 10 นิ้ว',          w: 203,   h: 254,   margin: 6 }
];

const Photo = {
  blob: null, bm: null,
  bg: '#ffffff', cut: true, tol: 30,
  zoom: 1, ox: 0, oy: 0,          // pan เป็นสัดส่วนของพื้นที่ที่ล้นกรอบ (-1..1)
  size: PH_SIZES[1], paper: 'a4', guide: true,
  cw: 100, ch: 150,               // ขนาดกระดาษกำหนดเอง (มม.)
  sw: 30, sh: 40,                 // ขนาดรูปกำหนดเอง (มม.)
  fmt: 'pdf'                      // ไฟล์ที่ได้: pdf | jpg | png
};

/* ขนาดรูปกำหนดเอง — คืนเป็นรูปแบบเดียวกับ PH_SIZES เพื่อให้โค้ดที่เหลือใช้ต่อได้เลย */
function phCustomSize(){
  const w = Math.max(10, Math.min(200, +Photo.sw || 0));
  const h = Math.max(10, Math.min(200, +Photo.sh || 0));
  return { id: 'custom', label: 'กำหนดเอง (' + w + ' × ' + h + ' มม.)', w, h };
}

function photoPaperDef(){
  if (Photo.paper === 'single') return null;
  if (Photo.paper === 'custom')
    return { id: 'custom', label: 'กำหนดเอง', w: +Photo.cw || 0, h: +Photo.ch || 0, margin: 5 };
  return PH_PAPERS.find(p => p.id === Photo.paper) || PH_PAPERS[0];
}

/* ---------- นำเข้ารูป ---------- */
async function photoLoad(file){
  busy(true, 'กำลังเปิดรูป…');
  try{
    const bm = await blobToBitmap(file);
    const sc = Math.min(1, 2600 / Math.max(bm.width, bm.height));
    const cv = mkCanvas(bm.width * sc, bm.height * sc);
    cv.getContext('2d').drawImage(bm, 0, 0, cv.width, cv.height);
    if (bm.close) bm.close();
    Photo.blob = await canvasToBlob(cv, 'image/jpeg', 0.97);
    Photo.bm = await blobToBitmap(Photo.blob);
    Photo.zoom = 1; Photo.ox = 0; Photo.oy = 0;
    photoDraw();
  } catch(e){ console.error(e); toast('เปิดรูปไม่สำเร็จ'); }
  busy(false);
}

/* ---------- ตัดพื้นหลัง (flood fill จากขอบภาพ) ----------
   ใช้ได้ดีกับฉากพื้นเรียบสีเดียว ไม่ใช่โมเดล AI — ถ้าฉากรก
   ผู้ใช้ปิดสวิตช์ได้ ผลลัพธ์จะเป็นรูปเดิมไม่ถูกแตะ            */
function photoCutout(cv, tol){
  const w = cv.width, h = cv.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, w, h), d = im.data;

  // สีพื้นหลังอ้างอิง = ค่าเฉลี่ยของกรอบนอก 4 ด้าน
  let r = 0, g = 0, b = 0, n = 0;
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  for (let y = 0; y < h; y++){
    for (let x = 0; x < w; x++){
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const i = (y * w + x) * 4;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
  }
  r /= n; g /= n; b /= n;

  const lim = tol * tol * 3;
  const mask = new Uint8Array(w * h);       // 1 = พื้นหลัง
  const q = new Int32Array(w * h);
  let qs = 0, qe = 0;
  const push = j => { if (!mask[j]){ const i = j * 4;
    const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
    if (dr * dr + dg * dg + db * db <= lim){ mask[j] = 1; q[qe++] = j; } } };

  for (let x = 0; x < w; x++){ push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++){ push(y * w); push(y * w + w - 1); }
  while (qs < qe){
    const j = q[qs++], x = j % w, y = (j / w) | 0;
    if (x > 0) push(j - 1);
    if (x < w - 1) push(j + 1);
    if (y > 0) push(j - w);
    if (y < h - 1) push(j + w);
  }

  // ฟุ้งขอบ 2px ไม่ให้เห็นรอยตัดเป็นฟันปลา
  const a = new Float32Array(w * h);
  for (let j = 0; j < w * h; j++) a[j] = mask[j];
  const rad = Math.max(1, Math.round(Math.min(w, h) / 320));
  const tmp = new Float32Array(w * h);
  const blur = (src, dst, horiz) => {
    for (let y = 0; y < h; y++){
      for (let x = 0; x < w; x++){
        let sum = 0, c = 0;
        for (let k = -rad; k <= rad; k++){
          const xx = horiz ? x + k : x, yy = horiz ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          sum += src[yy * w + xx]; c++;
        }
        dst[y * w + x] = sum / c;
      }
    }
  };
  blur(a, tmp, true); blur(tmp, a, false);
  return { alpha: a, im, ctx };
}

function photoApplyBg(cv, tol, bg){
  const { alpha, im, ctx } = photoCutout(cv, tol);
  const d = im.data;
  let br = 255, bg2 = 255, bb = 255, transparent = !bg;
  if (!transparent){
    const v = parseInt(bg.slice(1), 16);
    br = (v >> 16) & 255; bg2 = (v >> 8) & 255; bb = v & 255;
  }
  for (let j = 0; j < alpha.length; j++){
    const t = Math.min(1, Math.max(0, alpha[j]));      // 1 = พื้นหลังเต็ม
    const i = j * 4;
    if (transparent){ d[i + 3] = Math.round(255 * (1 - t)); continue; }
    d[i]     = d[i]     * (1 - t) + br  * t;
    d[i + 1] = d[i + 1] * (1 - t) + bg2 * t;
    d[i + 2] = d[i + 2] * (1 - t) + bb  * t;
  }
  ctx.putImageData(im, 0, 0);
  return cv;
}

/* ---------- ประกอบรูปตามขนาดที่เลือก ---------- */
let _phGesture = false;        // ระหว่างลาก/หุบนิ้ว ข้ามการตัดพื้นหลัง (flood fill) ให้ลื่น

function photoCompose(px){
  const s = Photo.size, ar = s.w / s.h;
  const H = px || Math.round(s.h / 25.4 * PH_DPI);
  const W = Math.round(H * ar);
  const cv = mkCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = Photo.bg || '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (!Photo.bm) return cv;

  const bm = Photo.bm;
  const cover = Math.max(W / bm.width, H / bm.height) * Photo.zoom;
  const dw = bm.width * cover, dh = bm.height * cover;
  const dx = (W - dw) / 2 + Photo.ox * (dw - W) / 2;
  const dy = (H - dh) / 2 + Photo.oy * (dh - H) / 2;
  ctx.drawImage(bm, dx, dy, dw, dh);

  if (Photo.cut && !_phGesture) photoApplyBg(cv, Photo.tol, Photo.bg);
  return cv;
}

/* ---------- คณิตศาสตร์ของการซูม/เลื่อน (แบบ Photos บน iPhone) ----------
   Photo.ox/oy เก็บเป็นสัดส่วนของส่วนที่ล้นกรอบ (-1..1) ซึ่งคิดต่อตรงๆ ยาก
   จึงแปลงไปกลับผ่าน "ตำแหน่งรูปในกรอบ" (dx/dy) แล้วยึดจุดที่นิ้วจับไว้ให้ติดนิ้ว */
const PH_ZMIN = 1, PH_ZMAX = 2.6;
const phClamp = (v, a, b) => Math.max(a, Math.min(b, v));

function phGeom(zoom){
  const s = Photo.size, ar = s.w / s.h, bm = Photo.bm;
  // ใช้กรอบเดียวกับไฟล์ที่ส่งออกจริง (ปัดเศษเหมือน photoCompose) เพื่อไม่ให้ตำแหน่งเคลื่อน
  const H = Math.round(s.h / 25.4 * PH_DPI), W = Math.round(H * ar);
  const cover = Math.max(W / bm.width, H / bm.height) * (zoom === undefined ? Photo.zoom : zoom);
  const dw = bm.width * cover, dh = bm.height * cover;
  return { W, H, cover, dw, dh,
           dx: (W - dw) / 2 + Photo.ox * (dw - W) / 2,
           dy: (H - dh) / 2 + Photo.oy * (dh - H) / 2 };
}

/* กำหนดตำแหน่งรูปในกรอบ แล้วแปลงกลับเป็น ox/oy (แกนที่ไม่มีส่วนล้น = เลื่อนไม่ได้ ตั้งเป็น 0) */
function phSetOffset(dx, dy, g){
  Photo.ox = (g.dw - g.W) > 0.5 ? phClamp((dx - (g.W - g.dw) / 2) * 2 / (g.dw - g.W), -1, 1) : 0;
  Photo.oy = (g.dh - g.H) > 0.5 ? phClamp((dy - (g.H - g.dh) / 2) * 2 / (g.dh - g.H), -1, 1) : 0;
}

/* ---------- พรีวิว ---------- */
function photoDraw(){
  const cv = $('phCv');
  const s = Photo.size, ar = s.w / s.h;
  const maxH = Math.min(300, window.innerHeight * 0.34);
  const H = Math.round(maxH), W = Math.round(H * ar);
  const ctx = fitCanvas(cv, W, H);

  if (!Photo.bm){
    ctx.fillStyle = '#f1f3f5'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#9aa4b2'; ctx.font = '600 13px Sarabun, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ยังไม่มีรูป', W / 2, H / 2 - 8);
    ctx.fillText('กดถ่ายรูป หรือเลือกรูป', W / 2, H / 2 + 12);
  } else {
    ctx.drawImage(photoCompose(Math.min(700, H * 2)), 0, 0, W, H);
    // เส้นไกด์ตำแหน่งศีรษะ (พรีวิวเท่านั้น ไม่ติดไปในไฟล์)
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.ellipse(W / 2, H * 0.46, W * 0.28, H * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H * 0.12); ctx.lineTo(W, H * 0.12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H * 0.82); ctx.lineTo(W, H * 0.82); ctx.stroke();
    ctx.setLineDash([]);
  }
  photoLayoutInfo();
}

/* ---------- จำนวนรูปต่อแผ่น ---------- */
function photoLayout(){
  const s = Photo.size;
  if (Photo.paper === 'single') return { cols: 1, rows: 1, total: 1, paper: { w: s.w, h: s.h, margin: 0 } };
  const p = photoPaperDef();
  const gap = 3;
  const fit = (pw, ph) => {
    const c = Math.floor((pw - 2 * p.margin + gap) / (s.w + gap));
    const r = Math.floor((ph - 2 * p.margin + gap) / (s.h + gap));
    return { c: Math.max(0, c), r: Math.max(0, r) };
  };
  const a = fit(p.w, p.h), b = fit(p.h, p.w);          // ลองทั้งแนวตั้ง/แนวนอน
  const land = b.c * b.r > a.c * a.r;
  const g = land ? b : a;
  return { cols: g.c, rows: g.r, total: g.c * g.r, gap,
           paper: { w: land ? p.h : p.w, h: land ? p.w : p.h, margin: p.margin } };
}

function photoLayoutInfo(){
  const L = photoLayout(), s = Photo.size;
  const el = $('phLayoutInfo');
  const pxOf = (wmm, hmm) => Math.round(wmm / 25.4 * PH_DPI) + ' × ' + Math.round(hmm / 25.4 * PH_DPI) + ' พิกเซล';
  if (Photo.paper === 'single'){
    el.textContent = 'ไฟล์ขนาด ' + s.w + ' × ' + s.h + ' มม. (1 รูป) · ' + pxOf(s.w, s.h);
  } else if (!L.total){
    el.textContent = 'กระดาษเล็กกว่ารูป ' + s.w + ' × ' + s.h + ' มม. — เลือกกระดาษใหญ่ขึ้น';
  } else {
    const land = L.paper.w > L.paper.h;
    el.textContent = 'ได้ ' + L.total + ' รูปต่อแผ่น (' + L.cols + ' × ' + L.rows + ')'
      + (land ? ' วางกระดาษแนวนอน' : '') + ' · ขนาดจริง ' + s.w + ' × ' + s.h + ' มม.';
  }
  buildPaperList();
  // ป้ายปุ่มต้องตรงกับไฟล์ที่จะได้ ไม่ใช่บอก "พร้อมปริ๊น" ตอนผู้ใช้เลือก JPG ไปอัปโหลด
  const btn = $('btnPhMake');
  if (btn) btn.querySelector('span').textContent =
    Photo.fmt === 'pdf' ? 'สร้างไฟล์พร้อมปริ๊น'
      : 'สร้างไฟล์ ' + Photo.fmt.toUpperCase() + (Photo.paper === 'single' ? '' : ' (แผ่นเรียงรูป)');
}

/* ลิสต์กระดาษ — โชว์จำนวนรูปที่ได้ต่อแผ่นของขนาดรูปที่เลือกอยู่ */
function buildPaperList(){
  const box = $('phPaper');
  if (!box) return;
  const keep = Photo.paper;
  const count = id => {
    const save = Photo.paper;
    Photo.paper = id;
    const L = photoLayout();
    Photo.paper = save;
    return L.total;
  };
  const row = (id, label, extra) =>
    '<label><input type="radio" name="phpaper" value="' + id + '"' +
    (keep === id ? ' checked' : '') + '><span>' + label +
    (extra ? ' <b style="color:var(--muted);font-weight:400">· ' + extra + '</b>' : '') + '</span></label>';

  box.innerHTML =
    PH_PAPERS.map(p => { const n = count(p.id);
      return row(p.id, p.label, n ? n + ' รูป' : 'เล็กเกินไป'); }).join('') +
    row('custom', 'กำหนดเอง', (() => { const n = count('custom'); return n ? n + ' รูป' : 'เล็กเกินไป'; })()) +
    row('single', 'รูปเดี่ยว (ไฟล์เท่าขนาดรูป)', '');

  $('phCustomRow').style.display = keep === 'custom' ? '' : 'none';
}

/* ---------- สร้าง PDF พร้อมปริ๊น ---------- */
async function photoMakeFile(){
  if (!Photo.bm){ toast('เลือกรูปก่อน'); return; }
  const L0 = photoLayout();
  if (!L0.total){ toast('กระดาษที่เลือกเล็กกว่าขนาดรูป', 3000); return; }
  busy(true, 'กำลังสร้างไฟล์…');
  try {
    if (Photo.fmt === 'pdf') await photoMakePdfInner();
    else await photoMakeImage();
  } catch(e){ console.error(e); toast('สร้างไฟล์ไม่สำเร็จ: ' + e.message, 4000); }
  busy(false);
}

async function photoMakePdfInner(){
  const L0 = photoLayout();
  {
    const L = L0, s = Photo.size;
    const cv = photoCompose();
    const transparent = !Photo.bg;
    const blob = await canvasToBlob(cv, transparent ? 'image/png' : 'image/jpeg', 0.97);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const doc = await PDFLib.PDFDocument.create();
    const img = transparent ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

    const pw = L.paper.w * MM, ph = L.paper.h * MM;
    const page = doc.addPage([pw, ph]);
    const w = s.w * MM, h = s.h * MM, gap = (L.gap || 0) * MM;
    const totalW = L.cols * w + (L.cols - 1) * gap;
    const totalH = L.rows * h + (L.rows - 1) * gap;
    const x0 = (pw - totalW) / 2, y0 = (ph - totalH) / 2;

    for (let r = 0; r < L.rows; r++){
      for (let c = 0; c < L.cols; c++){
        const x = x0 + c * (w + gap);
        const y = ph - y0 - h - r * (h + gap);
        page.drawImage(img, { x, y, width: w, height: h });
        if (Photo.guide && Photo.paper !== 'single'){
          // เส้นบางๆ รอบรูปไว้เป็นแนวตัด (ไม่ใส่ fill เพื่อไม่ให้ทับรูป)
          page.drawRectangle({ x, y, width: w, height: h,
            borderColor: PDFLib.rgb(0.72, 0.75, 0.8), borderWidth: 0.4, borderOpacity: 1 });
        }
      }
    }

    const out = await doc.save({ useObjectStreams: true });
    const pdf = new Blob([out], { type: 'application/pdf' });
    showDone(pdf, 'รูปติดบัตร.pdf', {
      title: 'รูปติดบัตรพร้อมปริ๊น',
      sub: Photo.paper === 'single'
        ? 'ไฟล์ขนาด ' + s.w + ' × ' + s.h + ' มม.'
        : L.total + ' รูปบนกระดาษ ' + (photoPaperDef() || {}).label +
          ' — สั่งพิมพ์แบบ “ขนาดจริง 100%” อย่าให้ย่อพอดีหน้า',
      continueTo: 'wm'
    });
  }
}

/* ---------- ลาก/หุบนิ้วซูม แบบ Photos บน iPhone ----------
   หลักการ: จำ "จุดบนรูป" ที่อยู่ใต้นิ้ว (หรือใต้กลางสองนิ้ว) ตอนเริ่มจับ แล้วทุกเฟรม
   บังคับให้จุดนั้นอยู่ใต้นิ้วตำแหน่งใหม่เสมอ — ได้ทั้งลาก 1:1 (นิ้วไปทางไหนรูปไปทางนั้น)
   และซูมเข้าหาจุดที่หุบนิ้ว ไม่ใช่ซูมเข้ากลางรูป                                      */
function wirePhotoPan(){
  const cv = $('phCv');
  const pts = new Map();
  let g0 = null;                 // สถานะตอนเริ่มจับ

  const midOf = () => {
    const v = [...pts.values()];
    if (!v.length) return null;
    if (v.length === 1) return { x: v[0].x, y: v[0].y, d: 0 };
    return { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2,
             d: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) };
  };
  // แปลงพิกัดหน้าจอ -> พิกัดในกรอบอ้างอิง (หน่วยเดียวกับ phGeom)
  const toFrame = (m, g) => {
    const r = cv.getBoundingClientRect();
    return { u: (m.x - r.left) / r.width * g.W, v: (m.y - r.top) / r.height * g.H };
  };
  const grab = () => {
    const m = midOf(); if (!m) { g0 = null; return; }
    const g = phGeom();
    const f = toFrame(m, g);
    g0 = { d: m.d, zoom: Photo.zoom,          // จุดบนรูป (source px) ที่อยู่ใต้นิ้วตอนนี้
           xs: (f.u - g.dx) / g.cover, ys: (f.v - g.dy) / g.cover };
  };

  cv.addEventListener('pointerdown', e => {
    if (!Photo.bm) return;
    // ลงทะเบียนนิ้วก่อน แล้วค่อย capture — ถ้า capture พลาด (บางเบราว์เซอร์/บางกรณีโยน
    // NotFoundError) ต้องไม่ทำให้ทั้ง gesture ตายไปทั้งอัน
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    _phGesture = true;
    grab();
    try { cv.setPointerCapture(e.pointerId); } catch(err){}
    e.preventDefault();
  });

  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !g0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const m = midOf();

    if (pts.size >= 2 && g0.d > 0){
      Photo.zoom = phClamp(g0.zoom * (m.d / g0.d), PH_ZMIN, PH_ZMAX);
      $('phZoom').value = Math.round(Photo.zoom * 100);
    }
    const g = phGeom();                        // cover ใหม่หลังซูม
    const f = toFrame(m, g);
    phSetOffset(f.u - g0.xs * g.cover, f.v - g0.ys * g.cover, g);
    photoDraw();
    e.preventDefault();
  }, { passive: false });

  const up = e => {
    pts.delete(e.pointerId);
    if (pts.size === 0){
      g0 = null; _phGesture = false;
      photoDraw();                             // วาดจริงรอบสุดท้าย (ตัดพื้นหลังด้วย)
    } else grab();                              // ยกนิ้วเดียว ยึดจุดใหม่ให้ลากต่อเนียน
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);

  // เดสก์ท็อป: ล้อเมาส์ซูมเข้าหาตำแหน่งเมาส์
  cv.addEventListener('wheel', e => {
    if (!Photo.bm) return;
    e.preventDefault();
    const g = phGeom();
    const f = toFrame({ x: e.clientX, y: e.clientY }, g);
    const xs = (f.u - g.dx) / g.cover, ys = (f.v - g.dy) / g.cover;
    Photo.zoom = phClamp(Photo.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), PH_ZMIN, PH_ZMAX);
    $('phZoom').value = Math.round(Photo.zoom * 100);
    const g2 = phGeom();
    phSetOffset(f.u - xs * g2.cover, f.v - ys * g2.cover, g2);
    photoDraw();
  }, { passive: false });
}

function buildPhotoSizeList(){
  const row = (id, label) =>
    '<label><input type="radio" name="phsz" value="' + id + '"' +
    (id === Photo.size.id ? ' checked' : '') + '><span>' + label + '</span></label>';
  $('phSize').innerHTML = PH_SIZES.map(s => row(s.id, s.label)).join('')
    + row('custom', 'กำหนดขนาดเอง');
  $('phSizeCustomRow').style.display = Photo.size.id === 'custom' ? '' : 'none';
}

/* ---------- ส่งออกเป็นไฟล์รูป (JPG/PNG) ----------
   ไว้เอาไปอัปโหลดต่อในเว็บที่รับแต่ไฟล์รูป ไม่รับ PDF
   paper 'single' = ได้รูปเดี่ยวขนาดเท่าที่ตั้ง · เลือกกระดาษ = ได้เป็นแผ่นเรียงรูปแบบรูปภาพ */
async function photoSheetCanvas(){
  const s = Photo.size;
  if (Photo.paper === 'single') return photoCompose();
  const L = photoLayout();
  const px = PH_DPI / 25.4;                       // มม. -> พิกเซล
  const cv = mkCanvas(Math.round(L.paper.w * px), Math.round(L.paper.h * px));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  const one = photoCompose();
  const w = s.w * px, h = s.h * px, gap = (L.gap || 0) * px;
  const totalW = L.cols * w + (L.cols - 1) * gap;
  const totalH = L.rows * h + (L.rows - 1) * gap;
  const x0 = (cv.width - totalW) / 2, y0 = (cv.height - totalH) / 2;
  for (let r = 0; r < L.rows; r++){
    for (let c = 0; c < L.cols; c++){
      const x = x0 + c * (w + gap), y = y0 + r * (h + gap);
      ctx.drawImage(one, x, y, w, h);
      if (Photo.guide){
        ctx.strokeStyle = 'rgba(184,192,204,1)'; ctx.lineWidth = Math.max(1, px * 0.12);
        ctx.strokeRect(x, y, w, h);
      }
    }
    await nextFrame();
  }
  return cv;
}

async function photoMakeImage(){
  const s = Photo.size;
  const png = Photo.fmt === 'png';
  const transparent = png && !Photo.bg;
  const cv = await photoSheetCanvas();
  const blob = await canvasToBlob(cv, png ? 'image/png' : 'image/jpeg', 0.95);
  const name = 'รูปติดบัตร.' + (png ? 'png' : 'jpg');
  showDone(blob, name, {
    title: 'ไฟล์รูปพร้อมอัปโหลด',
    sub: (Photo.paper === 'single'
      ? 'รูปเดี่ยว ' + s.w + ' × ' + s.h + ' มม.'
      : 'แผ่นเรียงรูปบนกระดาษ ' + (photoPaperDef() || {}).label) +
      ' — ไฟล์ขนาด ' + cv.width + ' × ' + cv.height + ' พิกเซล' +
      (transparent ? ' (พื้นหลังโปร่งใส)' : ''),
    continueTo: 'wm'
  });
}
