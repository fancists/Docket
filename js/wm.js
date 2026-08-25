'use strict';
/* ============================================================
   DocKit — watermark + shared overlay painting (canvas preview)
   Overlay coords are normalized to the page's VISIBLE box, y down.
   The PDF writer in export.js mirrors these formulas as vectors.
   ============================================================ */

const WM = { kind: 'text', layout: 'center', color: '#c0392b', imgUrl: null, imgRatio: 1 };

/* ---------- geometry shared with the exporter ---------- */
function wmFontPx(o, W, H){ return (o.size / 100) * Math.min(W, H) * 0.14; }

/* returns [{x,y,rot}] anchor points (centres) in visible px */
function wmSpots(o, W, H){
  if (o.layout === 'corner') return [{ x: W * 0.78, y: H * 0.94, rot: 0 }];
  if (o.layout === 'tile'){
    const out = [], cols = 3, rows = 4;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        out.push({ x: W * (c + 0.5) / cols, y: H * (r + 0.5) / rows, rot: o.rot });
    return out;
  }
  return [{ x: W / 2, y: H / 2, rot: o.rot }];
}

/* ความกว้างสูงสุดที่ลายน้ำข้อความวางได้ตามการจัดวาง — ใช้ร่วมกันทั้งพรีวิวและตอนเขียน PDF */
function wmTextMaxW(o, W){
  if (o.layout === 'tile') return W / 3 * 0.9;
  if (o.layout === 'corner') return W * 0.42;
  return W * 0.94;
}

function wmImgSize(o, W, H, ratio){
  const scale = o.layout === 'tile' ? 0.22 : o.layout === 'corner' ? 0.16 : 0.5;
  const r = ratio || 1;
  let w = W * scale * (o.size / 100) * 1.4;
  let h = w / r;

  // หนีบไม่ให้ล้นกรอบที่มันวางอยู่ ไม่งั้นข้อความถูกตัดหายไปเลย (ตราคร่อมยาว + ดันขนาดสูงเจอบ่อย)
  // tile วางเป็นตาราง 3x4 จึงหนีบตามขนาดช่อง · corner ยึดที่ 0.78W/0.94H จึงเหลือขอบให้แคบกว่า
  let maxW, maxH;
  if (o.layout === 'tile'){ maxW = W / 3 * 0.96; maxH = H / 4 * 0.96; }
  else if (o.layout === 'corner'){ maxW = W * 0.42; maxH = H * 0.11; }
  else { maxW = W * 0.96; maxH = H * 0.96; }

  if (w > maxW){ w = maxW; h = w / r; }
  if (h > maxH){ h = maxH; w = h * r; }
  return { w, h };
}

/* ---------- canvas preview painter ----------
   layout 'free' = ผู้ใช้ลากวางเอง เก็บเป็น x/y/w/h เหมือน overlay ลายเซ็น
   จึงเดินสายเดียวกับ paintObj / drawObjPdf                              */
function isFree(o){ return o.layout === 'free'; }

function paintOverlays(ctx, p, W, H){
  for (const o of p.overlays){
    if (o.kind === 'wm' && !isFree(o)) paintWM(ctx, o, W, H);
    else paintObj(ctx, o, W, H);
  }
}

function paintWM(ctx, o, W, H){
  ctx.save();
  ctx.globalAlpha = o.opacity / 100;
  const spots = wmSpots(o, W, H);
  if (o.type === 'text'){
    let fs = wmFontPx(o, W, H) * (o.layout === 'tile' ? 0.5 : o.layout === 'corner' ? 0.34 : 1);
    // ย่อฟอนต์ให้ข้อความพอในกรอบ ไม่งั้นข้อความยาวๆ ทะลุขอบหน้าแล้วถูกตัดหาย
    // (เจอตั้งแต่ขนาดเริ่มต้นถ้าข้อความยาว) — drawWmPdf ใน export.js ใช้สูตรเดียวกัน
    ctx.font = '700 ' + fs + 'px Sarabun, sans-serif';
    const tw = ctx.measureText(o.text || '').width;
    const maxW = wmTextMaxW(o, W);
    if (tw > maxW && tw > 0) fs *= maxW / tw;
    ctx.font = '700 ' + fs + 'px Sarabun, sans-serif';
    ctx.fillStyle = o.color;
    // เหตุผลเดียวกับ makeStampPng: ไม่พึ่ง textAlign='center' เพราะ Safari/iOS บางรุ่นไม่ทำตาม
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const half = ctx.measureText(o.text || '').width / 2;
    for (const s of spots){
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(-s.rot * Math.PI / 180);
      ctx.fillText(o.text || '', -half, 0); ctx.restore();
    }
  } else if (o._img){
    const sz = wmImgSize(o, W, H, o.ratio);
    for (const s of spots){
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(-s.rot * Math.PI / 180);
      ctx.drawImage(o._img, -sz.w / 2, -sz.h / 2, sz.w, sz.h); ctx.restore();
    }
  }
  ctx.restore();
}

function paintObj(ctx, o, W, H){
  ctx.save();
  ctx.globalAlpha = (o.opacity === undefined ? 100 : o.opacity) / 100;
  if (o.type === 'img' && o._img){
    const w = o.w * W, h = o.h * H;
    const cx = o.x * W + w / 2, cy = o.y * H + h / 2;
    ctx.translate(cx, cy);
    if (o.rot) ctx.rotate(-o.rot * Math.PI / 180);   // หมุนรอบจุดกึ่งกลางกล่อง
    ctx.drawImage(o._img, -w / 2, -h / 2, w, h);
  } else if (o.type === 'rect'){
    ctx.fillStyle = o.color || '#000';
    ctx.fillRect(o.x * W, o.y * H, o.w * W, o.h * H);
  } else if (o.type === 'text'){
    const fs = o.fs * H;
    ctx.font = fs + 'px Sarabun, sans-serif';
    ctx.fillStyle = o.color || '#111';
    ctx.textBaseline = 'top';
    ctx.fillText(o.text || '', o.x * W, o.y * H);
  }
  ctx.restore();
}

/* keep an <img> handle on overlays that carry a dataUrl (for canvas preview) */
function hydrateOverlay(o){
  return new Promise(res => {
    if (o.type !== 'img' || !o.dataUrl || o._img) return res();
    const im = new Image();
    im.onload = () => { o._img = im; o.ratio = o.ratio || im.width / im.height; res(); };
    im.onerror = () => res();
    im.src = o.dataUrl;
  });
}

/* ---------- thumbnails (page + overlays) ---------- */
async function refreshThumb(p){
  for (const o of p.overlays) await hydrateOverlay(o);
  const cv = await renderPageCanvas(p, 540);
  paintOverlays(cv.getContext('2d'), p, cv.width, cv.height);
  p.thumb = thumbOf(cv);
}

/* ---------- ตราคร่อมสำเนา ("ใช้สำหรับ … เท่านั้น") ----------
   วาดเป็นรูปทีเดียวทั้งบล็อก (หลายบรรทัด + เส้นขีดคร่อม) แล้วส่งเข้า
   ทางเดียวกับลายน้ำรูป — ได้การจัดวาง/หมุน/ส่งออกเดิมทั้งชุดฟรี
   และได้ text shaping ของเบราว์เซอร์ ซึ่งวางสระ/วรรณยุกต์ไทยถูก      */
const STAMP_REF = 96;          // ขนาดฟอนต์อ้างอิงสำหรับวัดสัดส่วน
const STAMP_MAX_PX = 4000;     // เพดานขนาดแคนวาส (iOS Safari จำกัดพื้นที่แคนวาส)

/* วัดขนาดกล่องตราคร่อมที่ฟอนต์ขนาดหนึ่ง — สัดส่วนไม่ขึ้นกับขนาด จึงใช้หา ratio
   ล่วงหน้าได้โดยไม่ต้องเรนเดอร์ภาพจริง (ใช้ตอนคำนวณเลย์เอาต์ก่อนรู้ขนาดที่จะวาง) */
function stampMetrics(lines, ref){
  const REF = ref || STAMP_REF, pad = REF * 0.5, lh = REF * 1.42;
  const m = mkCanvas(10, 10).getContext('2d');
  m.font = '700 ' + REF + 'px Sarabun, sans-serif';
  const tw = Math.max(...lines.map(t => m.measureText(t).width));
  const w = Math.ceil(tw + pad * 2), h = Math.ceil(lines.length * lh + pad * 2);
  return { REF, pad, lh, w, h, ratio: w / h };
}

/* targetW = ความกว้างที่ภาพนี้จะไปวางจริง (พิกเซล) — สร้างภาพให้ใหญ่พอกับที่จะวาง
   ไม่งั้นภาพ 96px ถูกขยายไปกว้างเป็นสิบเซนติเมตร เหลือแค่ ~200 DPI แล้วสระ/วรรณยุกต์
   ไทยที่เป็นเส้นบางๆ (เช่น "ี") จะเลือนหายตอนพิมพ์หรือเปิดในโปรแกรมอื่น */
function makeStampPng(lines, color, strike, targetW){
  const base = stampMetrics(lines);
  let s = Math.max(1, (targetW || 2400) / base.w);
  s = Math.min(s, STAMP_MAX_PX / base.w, STAMP_MAX_PX / base.h);
  const REF = base.REF * s, pad = REF * 0.5, lh = REF * 1.42;
  const font = '700 ' + REF + 'px Sarabun, sans-serif';
  const w = Math.ceil(base.w * s), h = Math.ceil(base.h * s);
  const cv = mkCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.font = font; ctx.fillStyle = color; ctx.strokeStyle = color;
  // ห้ามพึ่ง textAlign='center' — Safari/iOS บางรุ่นไม่ทำตาม แล้ววาดจากกลางภาพไปทางขวา
  // จนข้อความตกขอบหาย (เจอจากไฟล์จริงของผู้ใช้: ตัวอักษรอยู่ x 534..1081 ของภาพกว้าง 1082)
  // คำนวณจุดเริ่มเองจาก measureText ของคอนเท็กซ์ตัวที่วาดจริง = ตรงกันทุกเบราว์เซอร์
  // และได้ความกว้างจากฟอนต์ตัวเดียวกับที่ใช้วาดด้วย (กันวัดคนละฟอนต์กับที่เรนเดอร์)
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const inner = w - pad;                       // พื้นที่ที่ยอมให้ข้อความกิน
  lines.forEach((t, i) => {
    let tw = ctx.measureText(t).width;
    if (tw > inner){                           // กันเหนียว: ถ้ากว้างเกินคาด ย่อฟอนต์ลงให้พอ
      ctx.font = '700 ' + (REF * inner / tw) + 'px Sarabun, sans-serif';
      tw = ctx.measureText(t).width;
    }
    ctx.fillText(t, (w - tw) / 2, pad + lh * (i + 0.5));
    ctx.font = font;                           // คืนขนาดเดิมให้บรรทัดถัดไป
  });
  if (strike){
    ctx.lineWidth = Math.max(4, REF * 0.11);   // หนาพอให้เหลือรอดตอนย่อลงเป็นขนาดบัตร
    ctx.lineCap = 'round';
    [pad * 0.45, h - pad * 0.45].forEach(y => {
      ctx.beginPath(); ctx.moveTo(pad * 0.3, y); ctx.lineTo(w - pad * 0.3, y); ctx.stroke();
    });
  }
  return { dataUrl: cv.toDataURL('image/png'), ratio: w / h };
}

/* ---------- อ่านค่าที่ตั้งไว้ในฟอร์ม ยังไม่ผูกกับหน้าไหน ----------
   ใช้ร่วมกันทั้งตอนพรีวิวสด (wmDraw) และตอนกดใส่จริง (applyWatermark) */
function buildWmBase(){
  let stamp = null;
  if (WM.kind === 'stamp'){
    const lines = ($('wmStampText').value || '').split('\n').map(t => t.trim()).filter(Boolean);
    if (!lines.length) return { err: 'พิมพ์ข้อความที่จะคร่อมก่อน' };
    stamp = makeStampPng(lines, WM.color, $('wmStrike').checked);
  }

  const base = {
    kind: 'wm',
    // slot แยกช่อง: ลายน้ำจางกับตราคร่อมอยู่บนหน้าเดียวกันได้ ไม่ทับกันเอง
    slot: WM.kind === 'stamp' ? 'stamp' : 'wm',
    type: WM.kind === 'stamp' ? 'img' : WM.kind,
    stamp: WM.kind === 'stamp',
    text: $('wmText').value || '',
    dataUrl: stamp ? stamp.dataUrl : WM.imgUrl,
    ratio: stamp ? stamp.ratio : WM.imgRatio,
    size: +$('wmSize').value,
    opacity: +$('wmOpa').value,
    rot: +$('wmRot').value,
    layout: WM.layout,
    color: WM.color
  };
  if (WM.kind === 'text' && !base.text.trim()) return { err: 'ใส่ข้อความลายน้ำก่อน' };
  if (WM.kind === 'img' && !base.dataUrl) return { err: 'เลือกรูปลายน้ำก่อน' };

  // โหมด "วางเอง": แปลงทุกชนิดเป็นรูปก่อน จะได้ลาก/ย่อขยายด้วยกล่องเดียวกันหมด
  if (base.layout === 'free'){
    if (base.type === 'text'){
      const t = makeStampPng([base.text], base.color, false);
      base.dataUrl = t.dataUrl; base.ratio = t.ratio;
    }
    base.type = 'img';
  }
  return { base };
}

/* คำนวณกล่อง w/h/x/y ของโหมด "วางเอง" — ขึ้นกับสัดส่วนหน้านั้นๆ จึงทำต่อหน้า */
function sizeFreeOverlay(o, p){
  const v = pageVisibleSize(p);
  o.w = Math.min(0.9, 0.5 * (o.size / 100) * 1.4);
  o.h = o.w * v.w / (o.ratio * v.h);
  o.x = 0.5 - o.w / 2;
  o.y = 0.5 - o.h / 2;
}

/* ---------- พรีวิวสดก่อนกดใส่จริง ---------- */
let _wmDrawToken = 0;
async function wmDraw(){
  const cv = $('wmCv');
  if (!cv) return;
  const maxH = Math.min(360, window.innerHeight * 0.4);
  const targets = scopePages(segScope('wmScopeSeg'));
  const p = targets[0] || App.pages[0];

  if (!p){
    const H = Math.round(maxH), W = Math.round(H * 0.75);
    const ctx = fitCanvas(cv, W, H);
    ctx.fillStyle = '#f1f3f5'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#9aa4b2'; ctx.font = '600 13px Sarabun, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('ยังไม่มีหน้าเอกสาร', W / 2, H / 2);
    return;
  }

  const tok = ++_wmDrawToken;
  const src = await renderPageCanvas(p, 640);
  if (tok !== _wmDrawToken) return;
  const vsz = pageVisibleSize(p);
  const H = Math.round(maxH), W = Math.round(H * vsz.w / vsz.h);
  const ctx = fitCanvas(cv, W, H);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(src, 0, 0, W, H);

  // วาดของเดิมบนหน้านั้นก่อน ยกเว้นช่องเดียวกับที่กำลังพรีวิว (เดี๋ยวถูกแทนที่ตอนกดใส่จริง)
  const slot = WM.kind === 'stamp' ? 'stamp' : 'wm';
  for (const o of p.overlays){
    if (o.kind === 'wm' && (o.slot || 'wm') === slot) continue;
    await hydrateOverlay(o);
    if (tok !== _wmDrawToken) return;
    if (o.kind === 'wm' && !isFree(o)) paintWM(ctx, o, W, H); else paintObj(ctx, o, W, H);
  }

  const r = buildWmBase();
  if (!r.err){
    const o = Object.assign({}, r.base);
    if (o.layout === 'free') sizeFreeOverlay(o, p);
    await hydrateOverlay(o);
    if (tok !== _wmDrawToken) return;
    if (isFree(o)) paintObj(ctx, o, W, H); else paintWM(ctx, o, W, H);
  }
}

/* ---------- apply / clear ---------- */
async function applyWatermark(){
  if (!App.pages.length){ toast('ยังไม่มีหน้า'); return; }
  const targets = scopePages(segScope('wmScopeSeg'));
  if (!targets.length){ toast('เลือกหน้าที่จะใส่ก่อน'); return; }

  const r = buildWmBase();
  if (r.err){ toast(r.err); return; }
  const base = r.base;

  busy(true, WM.kind === 'stamp' ? 'กำลังคร่อมข้อความ…' : 'กำลังใส่ลายน้ำ…');
  try{
    for (const p of targets){
      p.overlays = p.overlays.filter(o => !(o.kind === 'wm' && (o.slot || 'wm') === base.slot));
      const o = Object.assign({}, base);
      if (base.layout === 'free') sizeFreeOverlay(o, p);
      await hydrateOverlay(o);
      p.overlays.push(o);
      await refreshThumb(p);
      await nextFrame();
    }
  } catch(e){
    console.error(e); busy(false); renderGrid();
    toast('ใส่ลายน้ำไม่สำเร็จ: ' + e.message, 3500);
    return;
  }
  busy(false);
  renderGrid();

  if (base.layout === 'free'){
    startOverlayPlacement(targets, base.slot, 'wm',
      base.slot === 'stamp' ? 'วางตราคร่อม' : 'วางลายน้ำ');
    return;
  }
  wmDraw();
  offerNextStep(
    WM.kind === 'stamp' ? 'คร่อมข้อความแล้ว' : 'ใส่ลายน้ำแล้ว',
    targets.length + ' หน้า — ทำอะไรต่อดี?',
    'wm'
  );
}

async function clearWatermark(){
  const targets = scopePages(segScope('wmScopeSeg'));
  if (!targets.length){ toast('เลือกหน้าก่อน'); return; }
  // ลบเฉพาะช่องที่กำลังเปิดอยู่ (ลายน้ำจาง / ตราคร่อม) ไม่ล้างของอีกช่องทิ้ง
  const slot = WM.kind === 'stamp' ? 'stamp' : 'wm';
  const hit = o => o.kind === 'wm' && (o.slot || 'wm') === slot;
  busy(true, 'กำลังลบ…');
  let n = 0;
  try{
    for (const p of targets){
      if (!p.overlays.some(hit)) continue;
      p.overlays = p.overlays.filter(o => !hit(o));
      await refreshThumb(p);
      n++;
    }
  } catch(e){
    console.error(e); busy(false); renderGrid();
    toast('ลบไม่สำเร็จ: ' + e.message, 3500);
    return;
  }
  busy(false);
  renderGrid();
  toast(n ? 'ลบแล้ว ' + n + ' หน้า' : 'ไม่มีอะไรให้ลบ');
}
