'use strict';
/* ============================================================
   DocKit — สำเนาบัตร หน้า-หลัง บนแผ่นเดียว
   ตัดขอบบัตรอัตโนมัติ ดัดให้ตรง แล้ววางบนกระดาษขนาดเท่าของจริง
   ============================================================ */

const CARD = { w: 85.6, h: 53.98 };        // ID-1 (บัตรประชาชน/ใบขับขี่/บัตรพนักงาน)
const CARD_DPI = 300;

const IdCard = {
  front: null, back: null,                  // {blob, canvas}
  paper: 'a4', scale: 100, stamp: true, strike: true,
  lines: ['สำเนาถูกต้อง', 'ใช้สำหรับสมัครงานเท่านั้น'],
  color: '#1a3a8f'
};

/* ตัดบัตรออกจากรูปถ่าย: หาขอบ -> ดัด perspective -> ปรับให้อ่านง่าย */
async function cardFromFile(file){
  const bm = await blobToBitmap(file);
  const sc = Math.min(1, 2200 / Math.max(bm.width, bm.height));
  let cv = mkCanvas(bm.width * sc, bm.height * sc);
  cv.getContext('2d').drawImage(bm, 0, 0, cv.width, cv.height);
  if (bm.close) bm.close();

  const W = Math.round(CARD.w / 25.4 * CARD_DPI);
  const H = Math.round(CARD.h / 25.4 * CARD_DPI);
  const c = autoCorners(cv);
  if (c){
    const pts = c.map(([x, y]) => [x * cv.width, y * cv.height]);
    cv = warpQuad(cv, pts, W, H);
  } else {
    // หาขอบไม่เจอ: ครอบกลางภาพตามสัดส่วนบัตรแทน
    const ar = CARD.w / CARD.h;
    let sw = cv.width, sh = sw / ar;
    if (sh > cv.height){ sh = cv.height; sw = sh * ar; }
    const t = mkCanvas(W, H);
    t.getContext('2d').drawImage(cv, (cv.width - sw) / 2, (cv.height - sh) / 2, sw, sh, 0, 0, W, H);
    cv = t;
  }
  applyFilter(cv, { mode: 'mag', bright: 0, contrast: 0 });
  return { blob: await canvasToBlob(cv, 'image/jpeg', 0.92), canvas: cv, auto: !!c };
}

async function idLoad(side, file){
  busy(true, 'กำลังตัดขอบบัตร…');
  try{
    IdCard[side] = await cardFromFile(file);
    toast(IdCard[side].auto ? 'ตัดขอบบัตรอัตโนมัติแล้ว' : 'หาขอบบัตรไม่เจอ ใช้กลางภาพแทน', 2600);
    idDraw();
  } catch(e){ console.error(e); toast('เปิดรูปไม่สำเร็จ'); }
  busy(false);
}

/* พรีวิวแผ่นกระดาษ */
function idDraw(){
  const cv = $('idCv');
  const p = PH_PAPERS.find(x => x.id === IdCard.paper) || PH_PAPERS[0];
  const maxH = Math.min(360, window.innerHeight * 0.4);
  const H = Math.round(maxH), W = Math.round(H * p.w / p.h);
  cv.width = W; cv.height = H;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  const L = idLayout(p);
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

  if (IdCard.stamp && (IdCard.front || IdCard.back)){
    const st = makeStampPng(IdCard.lines.filter(Boolean), IdCard.color, IdCard.strike);
    const im = new Image();
    im.onload = () => {
      const w = L.cw * 0.95 * px, h = w / st.ratio;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(im, (W - w) / 2, (L.y2 + L.ch) * px * 0.5 + (L.y1 + L.ch) * px * 0.5 - h / 2, w, h);
      ctx.globalAlpha = 1;
    };
    im.src = st.dataUrl;
  }
  $('idInfo').textContent = 'บัตรขนาดจริง ' + L.cw.toFixed(1) + ' × ' + L.ch.toFixed(1) +
    ' มม. บนกระดาษ ' + p.label;
}

function idLayout(p){
  const s = IdCard.scale / 100;
  const cw = CARD.w * s, ch = CARD.h * s;
  const gap = Math.max(10, (p.h - ch * 2) / 6);
  const y1 = p.h / 2 - ch - gap / 2;
  const y2 = p.h / 2 + gap / 2;
  return { cw, ch, gap, y1, y2 };
}

async function idMakePdf(){
  if (!IdCard.front && !IdCard.back){ toast('ถ่ายรูปบัตรก่อน'); return; }
  busy(true, 'กำลังสร้างไฟล์…');
  try{
    const p = PH_PAPERS.find(x => x.id === IdCard.paper) || PH_PAPERS[0];
    const L = idLayout(p);
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
    if (IdCard.stamp){
      const st = makeStampPng(IdCard.lines.filter(Boolean), IdCard.color, IdCard.strike);
      const b = await (await fetch(st.dataUrl)).arrayBuffer();
      const im = await doc.embedPng(new Uint8Array(b));
      const w = L.cw * 0.95 * MM, h = w / st.ratio;
      const cy = (p.h - (L.y1 + L.ch + L.y2) / 2) * MM;
      page.drawImage(im, { x: (p.w * MM - w) / 2, y: cy - h / 2, width: w, height: h, opacity: 0.92 });
    }
    const bytes = await doc.save({ useObjectStreams: true });
    showDone(new Blob([bytes], { type: 'application/pdf' }), 'สำเนาบัตร.pdf', {
      title: 'สำเนาบัตรพร้อมปริ๊น',
      sub: 'บัตรขนาดเท่าของจริงบนกระดาษ ' + p.label + ' — สั่งพิมพ์แบบ “ขนาดจริง 100%”'
    });
  } catch(e){ console.error(e); toast('สร้างไฟล์ไม่สำเร็จ: ' + e.message, 4000); }
  busy(false);
}
