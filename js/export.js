'use strict';
/* ============================================================
   DocKit — PDF writer (pdf-lib). Overlays are drawn as vectors,
   mirroring the normalized geometry used by the canvas preview.
   ============================================================ */

const Ex = { size: 'a4', qual: 0.85, maxPx: 1700, font: null,
             pageNo: false, noPos: 'bc', noFmt: 'full', header: '' };
const A4 = { w: 595.28, h: 841.89 };

/* display(y-up, visible box) -> unrotated page coords */
function toPage(dx, dy, geo){
  const { R, w, h } = geo;
  if (R === 90)  return { x: w - dy, y: dx };
  if (R === 180) return { x: w - dx, y: h - dy };
  if (R === 270) return { x: dy,     y: h - dx };
  return { x: dx, y: dy };
}
function rot2(ox, oy, deg){
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [ox * c - oy * s, ox * s + oy * c];
}

async function buildPdf(){
  const pages = scopePages(segScope('exScopeSeg'));
  if (!pages.length) throw new Error('ยังไม่ได้เลือกหน้าที่จะส่งออก');

  const out = await PDFLib.PDFDocument.create();

  // Text overlays are rasterised through the browser's own text shaper instead
  // of drawn with pdf-lib's drawText: pdf-lib places glyphs by advance width and
  // does not apply GPOS, so stacked Thai marks (เช่น ที่ / ป้ / ปิ) land wrong.
  await embedTextOverlays(out, pages);
  await embedOverlayImages(out, pages);
  const font = null;

  // ป้ายเลขหน้า/หัวกระดาษ วาดเป็นรูปเหมือน overlay ข้อความ (เหตุผลเดียวกัน: ไทย)
  const labels = {};
  const labelOf = async txt => {
    if (!labels[txt]) labels[txt] = await textPng(out, txt, '#555555', false);
    return labels[txt];
  };
  const headText = (Ex.header || '').trim();

  const srcCache = {};
  let done = 0;

  for (const p of pages){
    busy(true, 'กำลังสร้าง PDF… ' + (++done) + '/' + pages.length);
    await nextFrame();
    let page, geo;

    if (p.kind === 'pdf'){
      const s = p.pdf.srcId;
      if (!srcCache[s]) srcCache[s] = await PDFLib.PDFDocument.load(App.srcs[s].bytes, { ignoreEncryption: true });
      const [cp] = await out.copyPages(srcCache[s], [p.pdf.idx]);
      page = out.addPage(cp);
      const base = page.getRotation().angle || 0;
      const R = (((base + p.rotate) % 360) + 360) % 360;
      page.setRotation(PDFLib.degrees(R));
      const ms = page.getSize();
      const sw = (R === 90 || R === 270);
      geo = { R, w: ms.width, h: ms.height, W: sw ? ms.height : ms.width, H: sw ? ms.width : ms.height };
    } else {
      const cv = await buildImageCanvas(p, Ex.maxPx);   // crop + enhance + rotate already applied
      const isBW = p.img.enh.mode === 'bw';
      const blob = await canvasToBlob(cv, isBW ? 'image/png' : 'image/jpeg', Ex.qual);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const img = isBW ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      const ar = cv.width / cv.height;

      let pw, ph;
      if (Ex.size === 'a4'){ pw = ar >= 1 ? A4.h : A4.w; ph = ar >= 1 ? A4.w : A4.h; }
      else { if (ar >= 1){ pw = A4.h; ph = A4.h / ar; } else { ph = A4.h; pw = A4.h * ar; } }
      page = out.addPage([pw, ph]);
      const s = Math.min(pw / cv.width, ph / cv.height);
      const dw = cv.width * s, dh = cv.height * s;
      page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
      geo = { R: 0, w: pw, h: ph, W: pw, H: ph };
    }

    for (const o of p.overlays){
      if (o.kind === 'wm' && !isFree(o)) drawWmPdf(page, o, geo, font);
      else drawObjPdf(page, o, geo, font, out);
    }

    if (Ex.pageNo){
      const txt = Ex.noFmt === 'slash'
        ? (done) + ' / ' + pages.length
        : 'หน้า ' + (done) + ' จาก ' + pages.length;
      drawLabel(page, geo, await labelOf(txt), Ex.noPos);
    }
    if (headText) drawLabel(page, geo, await labelOf(headText), 'tc');
  }

  const bytes = await out.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}

/* ---- overlay writers (mirror of paintWM / paintObj) ---- */
function hexRgb(hex){
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#000000');
  const v = m ? parseInt(m[1], 16) : 0;
  return PDFLib.rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

function drawWmPdf(page, o, geo, font){
  const { W, H } = geo;
  const spots = wmSpots(o, W, H);
  const opa = o.opacity / 100;

  if (o.type === 'text'){
    const t = o._txt;
    if (!t) return;
    const fs = wmFontPx(o, W, H) * (o.layout === 'tile' ? 0.5 : o.layout === 'corner' ? 0.34 : 1);
    let th = fs * (t.h / t.fs), tw = th * (t.w / t.h);
    // ย่อให้พอในกรอบเหมือน paintWM ไม่งั้นไฟล์ที่ได้ข้อความล้นขอบไม่ตรงกับพรีวิว
    const maxW = wmTextMaxW(o, W);
    if (tw > maxW && tw > 0){ const k = maxW / tw; tw *= k; th *= k; }
    for (const s of spots){
      const [ox, oy] = rot2(-tw / 2, -th / 2, s.rot);
      const dx = s.x + ox, dy = (H - s.y) + oy;
      const a = toPage(dx, dy, geo);
      page.drawImage(t.img, {
        x: a.x, y: a.y, width: tw, height: th,
        opacity: opa, rotate: PDFLib.degrees(geo.R + s.rot)
      });
    }
  } else if (o._pdfImg){
    const sz = wmImgSize(o, W, H, o.ratio);
    for (const s of spots){
      const [ox, oy] = rot2(-sz.w / 2, -sz.h / 2, s.rot);
      const dx = s.x + ox, dy = (H - s.y) + oy;
      const a = toPage(dx, dy, geo);
      page.drawImage(o._pdfImg, {
        x: a.x, y: a.y, width: sz.w, height: sz.h,
        opacity: opa, rotate: PDFLib.degrees(geo.R + s.rot)
      });
    }
  }
}

function drawObjPdf(page, o, geo, font){
  const { W, H } = geo;
  if (o.type === 'img' && o._pdfImg){
    const w = o.w * W, h = o.h * H;
    // จุดยึดของ pdf-lib คือมุมซ้ายล่างแล้วหมุนรอบจุดนั้น
    // เลยหาจุดนั้นจาก "กึ่งกลางกล่อง + เวกเตอร์ครึ่งกล่องที่หมุนแล้ว"
    const cx = o.x * W + w / 2, cy = H - (o.y * H + h / 2);
    const rot = o.rot || 0;
    const [ox, oy] = rot2(-w / 2, -h / 2, rot);
    const a = toPage(cx + ox, cy + oy, geo);
    page.drawImage(o._pdfImg, {
      x: a.x, y: a.y, width: w, height: h,
      opacity: (o.opacity === undefined ? 100 : o.opacity) / 100,
      rotate: PDFLib.degrees(geo.R + rot)
    });
  } else if (o.type === 'rect'){
    const w = o.w * W, h = o.h * H;
    const a = toPage(o.x * W, H - o.y * H - h, geo);
    page.drawRectangle({ x: a.x, y: a.y, width: w, height: h,
      color: hexRgb(o.color || '#000000'), rotate: PDFLib.degrees(geo.R) });
  } else if (o.type === 'text' && o._txt){
    const t = o._txt, fs = o.fs * H;
    const th = fs * (t.h / t.fs), tw = th * (t.w / t.h);
    const dx = o.x * W, dy = H - o.y * H - th;
    const a = toPage(dx, dy, geo);
    page.drawImage(t.img, {
      x: a.x, y: a.y, width: tw, height: th, rotate: PDFLib.degrees(geo.R)
    });
  }
}

/* ป้ายมุมกระดาษ: bc=ล่างกลาง br=ล่างขวา tc=บนกลาง (พิกัดคิดในสเปซที่ตามองเห็น) */
function drawLabel(page, geo, t, pos){
  const { W, H } = geo;
  const fs = Math.max(7.5, Math.min(W, H) * 0.014);
  const th = fs * (t.h / t.fs), tw = th * (t.w / t.h);
  const pad = Math.min(W, H) * 0.035;
  let dx, dy;
  if (pos === 'br'){ dx = W - pad - tw; dy = pad; }
  else if (pos === 'tc'){ dx = (W - tw) / 2; dy = H - pad - th; }
  else { dx = (W - tw) / 2; dy = pad; }
  const a = toPage(dx, dy, geo);
  page.drawImage(t.img, { x: a.x, y: a.y, width: tw, height: th,
                          opacity: 0.85, rotate: PDFLib.degrees(geo.R) });
}

/* Render a text run with the browser's shaper (correct Thai mark stacking),
   then embed it as a PNG. Returns {img, w, h, fs} in the reference font size. */
const TXT_REF = 96;          // render size; scaled down at draw time
async function textPng(out, text, color, bold){
  const ref = TXT_REF;
  const m = mkCanvas(10, 10).getContext('2d');
  const fnt = (bold ? '700 ' : '400 ') + ref + 'px Sarabun, sans-serif';
  m.font = fnt;
  const w = Math.ceil(m.measureText(text).width) + ref * 0.3;
  const h = Math.ceil(ref * 1.5);
  const cv = mkCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.font = fnt; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, ref * 0.15, h / 2);
  const blob = await canvasToBlob(cv, 'image/png');
  const img = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
  return { img, w: cv.width, h: cv.height, fs: ref };
}

async function embedTextOverlays(out, pages){
  if (document.fonts && document.fonts.load){
    try { await document.fonts.load('700 96px Sarabun'); await document.fonts.load('400 96px Sarabun'); } catch(e){}
  }
  const cache = {};
  for (const p of pages){
    for (const o of p.overlays){
      if (o.type !== 'text' || !o.text) continue;
      const bold = o.kind === 'wm';
      const key = o.text + '|' + (o.color || '#111111') + '|' + bold;
      if (!cache[key]) cache[key] = await textPng(out, o.text, o.color || '#111111', bold);
      o._txt = cache[key];
    }
  }
}

/* images must be embedded in the *output* doc before drawing */
async function embedOverlayImages(out, pages){
  const cache = {};
  for (const p of pages){
    for (const o of p.overlays){
      if (o.type !== 'img' || !o.dataUrl) continue;
      if (!cache[o.dataUrl]){
        const b = await (await fetch(o.dataUrl)).arrayBuffer();
        const bytes = new Uint8Array(b);
        cache[o.dataUrl] = /^data:image\/png/i.test(o.dataUrl)
          ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      }
      o._pdfImg = cache[o.dataUrl];
    }
  }
}

/* ---------- หน้าจอ "เสร็จแล้ว" (ใช้ร่วมกับรูปติดบัตร) ---------- */
function showDone(blob, name, opts){
  opts = opts || {};
  const url = URL.createObjectURL(blob);
  const kb = blob.size / 1024;
  $('doneT').textContent = opts.title || 'สร้าง PDF สำเร็จ';
  $('doneS').textContent = opts.sub || 'ไฟล์พร้อมบันทึกลงเครื่องหรือส่งต่อแล้ว';
  $('doneNm').textContent = name;
  $('doneSz').textContent = kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.round(kb) + ' KB';
  historyAdd({ name, mime: blob.type, blob, title: opts.title, sub: opts.sub });

  const acts = $('doneActions');
  acts.innerHTML = '';
  const a = document.createElement('a');
  a.className = 'btn primary'; a.href = url; a.download = name;
  a.textContent = 'บันทึกลงเครื่อง';
  acts.appendChild(a);

  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })){
    const b = document.createElement('button');
    b.className = 'btn ghost'; b.textContent = 'แชร์ / เปิดในแอปอื่น';
    b.onclick = () => navigator.share({ files: [file], title: name }).catch(() => {});
    acts.appendChild(b);
  }

  // เครื่องมือเดี่ยว (รูปติดบัตร/สำเนาบัตร) ไม่ได้ผูกกับ "หน้าเอกสาร" — ปุ่มนี้ดึงไฟล์ที่เพิ่งสร้าง
  // กลับเข้าไปในหน้าเอกสาร แล้วพาไปเครื่องมือลายน้ำต่อทันที ไม่ต้องออกไปกด "เปิดไฟล์ PDF" เอง
  if (opts.continueTo){
    const c = document.createElement('button');
    c.className = 'btn ghost'; c.textContent = 'ใส่ลายน้ำต่อ';
    c.onclick = async () => {
      busy(true, 'กำลังเปิดไฟล์…');
      await addPdfFiles([file]);
      busy(false);
      showView(opts.continueTo);
    };
    acts.appendChild(c);
  }

  const h = document.createElement('button');
  h.className = 'btn ghost'; h.textContent = 'ดูไฟล์ย้อนหลัง';
  h.onclick = () => showView('history');
  acts.appendChild(h);

  const d = document.createElement('button');
  d.className = 'btn ghost'; d.textContent = 'เสร็จสิ้น';
  d.onclick = () => showView('home');
  acts.appendChild(d);

  showView('done');
}

async function doExport(){
  if (!App.pages.length){ toast('ยังไม่มีหน้า'); return; }
  busy(true, 'กำลังสร้าง PDF…');
  try{
    const blob = await buildPdf();
    const name = ($('exName').value || 'เอกสาร').replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
    const n = scopePages(segScope('exScopeSeg')).length;
    showDone(blob, name, { sub: 'รวม ' + n + ' หน้า พร้อมบันทึกหรือส่งต่อ' });
  } catch(e){
    console.error(e);
    toast('สร้าง PDF ไม่สำเร็จ: ' + e.message, 4000);
  }
  busy(false);
}
