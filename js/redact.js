'use strict';
/* ============================================================
   DocKit — ปกปิดข้อมูล (ขีดดำ)
   หน้าที่มาจาก PDF จะถูก "แปลงเป็นรูป" ก่อนเสมอ ไม่ใช่แค่วางกล่องดำทับ
   เพราะกล่องทับใน PDF ไม่ได้ลบตัวอักษรข้างใต้ — คนรับยัง copy ออกไปได้
   ============================================================ */

const Redact = { list: [], idx: 0, sel: null };

async function startRedact(){
  const list = scopePages(segScope('rdScopeSeg'));
  if (!list.length){ toast('เลือกหน้าที่จะปกปิดก่อน'); return; }
  Redact.list = list; Redact.idx = 0; Redact.sel = null;
  showView('redact');
  await drawRedact();
}

/* PDF -> รูป (200dpi) เพื่อให้การขีดดำลบข้อมูลจริง */
async function flattenPage(p){
  if (p.kind !== 'pdf') return p;
  const cv = await renderPageCanvas(p, 1700);
  const blob = await canvasToBlob(cv, 'image/jpeg', 0.92);
  const keep = p.overlays;
  p.kind = 'img';
  p.rotate = 0;
  p.img = { blob, w: cv.width, h: cv.height,
            enh: { mode: 'orig', bright: 0, contrast: 0 }, crop: null };
  delete p.pdf;
  p.overlays = keep;
  p.name = (p.name || 'หน้า') + ' (แปลงเป็นรูป)';
  return p;
}

async function drawRedact(){
  const p = Redact.list[Redact.idx];
  if (!p){ showView('pages'); return; }
  $('rdLbl').textContent = 'หน้า ' + (App.pages.indexOf(p) + 1) +
                           ' (' + (Redact.idx + 1) + '/' + Redact.list.length + ')';
  $('rdFlat').style.display = p.kind === 'pdf' ? '' : 'none';

  const cv = $('rdCv');
  const maxW = Math.min(window.innerWidth - 40, 640);
  const maxH = window.innerHeight * 0.52;
  const full = await renderPageCanvas(p, 1100);
  const s = Math.min(maxW / full.width, maxH / full.height, 1);
  cv.width = Math.round(full.width * s); cv.height = Math.round(full.height * s);
  const ctx = cv.getContext('2d');
  ctx.drawImage(full, 0, 0, cv.width, cv.height);
  for (const o of p.overlays) await hydrateOverlay(o);
  paintOverlays(ctx, p, cv.width, cv.height);
  cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';

  // กรอบไฮไลต์กล่องที่เลือกอยู่
  if (Redact.sel && p.overlays.includes(Redact.sel)){
    const o = Redact.sel;
    ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.strokeRect(o.x * cv.width, o.y * cv.height, o.w * cv.width, o.h * cv.height);
    ctx.setLineDash([]);
  }
  $('btnRdDel').disabled = !Redact.sel;
  const n = p.overlays.filter(o => o.kind === 'redact').length;
  $('rdCount').textContent = n ? n + ' จุดบนหน้านี้' : 'ลากบนหน้าเพื่อขีดทับ';
}

function wireRedactCanvas(){
  const cv = $('rdCv');
  let st = null;
  const norm = e => {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  cv.addEventListener('pointerdown', e => {
    const p = Redact.list[Redact.idx];
    if (!p) return;
    const [x, y] = norm(e);
    const hit = [...p.overlays].reverse().find(o => o.kind === 'redact' &&
      x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h);
    if (hit){ Redact.sel = hit; st = { mode: 'move', x, y, o: Object.assign({}, hit), ref: hit }; }
    else {
      const o = { kind: 'redact', type: 'rect', x, y, w: 0, h: 0, color: '#000000', opacity: 100 };
      p.overlays.push(o); Redact.sel = o;
      st = { mode: 'draw', x, y, ref: o };
    }
    cv.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!st) return;
    const [x, y] = norm(e), o = st.ref;
    if (st.mode === 'draw'){
      o.x = Math.min(st.x, x); o.y = Math.min(st.y, y);
      o.w = Math.abs(x - st.x); o.h = Math.abs(y - st.y);
    } else {
      o.x = st.o.x + (x - st.x); o.y = st.o.y + (y - st.y);
    }
    drawRedact();
    e.preventDefault();
  }, { passive: false });
  const up = async () => {
    if (!st) return;
    const o = st.ref;
    if (st.mode === 'draw' && (o.w < 0.012 || o.h < 0.008)){
      const p = Redact.list[Redact.idx];
      p.overlays = p.overlays.filter(x => x !== o);
      Redact.sel = null;
    }
    st = null;
    await drawRedact();
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
}

async function redactDeleteSel(){
  const p = Redact.list[Redact.idx];
  p.overlays = p.overlays.filter(o => o !== Redact.sel);
  Redact.sel = null;
  await drawRedact();
}
async function redactNav(d){
  Redact.idx = Math.max(0, Math.min(Redact.list.length - 1, Redact.idx + d));
  Redact.sel = null;
  await drawRedact();
}
async function redactFlatten(){
  const p = Redact.list[Redact.idx];
  busy(true, 'กำลังแปลงหน้าเป็นรูป…');
  await flattenPage(p);
  await refreshThumb(p);
  busy(false);
  renderGrid();
  await drawRedact();
  toast('แปลงเป็นรูปแล้ว ข้อมูลใต้กล่องดำจะถูกลบจริงตอนส่งออก');
}
async function redactDone(){
  busy(true, 'กำลังอัปเดต…');
  // หน้าที่ยังเป็น PDF และมีกล่องดำ = ข้อความข้างใต้ยังอยู่ ต้องแปลงก่อน
  for (const p of Redact.list){
    if (p.kind === 'pdf' && p.overlays.some(o => o.kind === 'redact')) await flattenPage(p);
    await refreshThumb(p);
  }
  busy(false);
  renderGrid();
  showView('pages');
  offerNextStep('ปกปิดข้อมูลแล้ว', Redact.list.length + ' หน้า — ทำอะไรต่อดี?', 'redactPick');
}
