'use strict';
/* ============================================================
   DocKit — e-signature: draw / upload, then place on pages
   ============================================================ */

const Sig = { drawing: false, last: null, dirty: false, list: [], idx: 0 };

/* ---------- signature pad ---------- */
function initSigPad(){
  const cv = $('sigPad');
  const fit = () => {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const data = Sig.dirty ? cv.toDataURL() : null;
    cv.width = Math.max(300, r.width * dpr);
    cv.height = Math.max(160, r.height * dpr);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.lineWidth = 3.2 * dpr; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    if (data){ const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, cv.width, cv.height); im.src = data; }
  };
  Sig.fit = fit;          // re-run when the tab becomes visible: the canvas is
  fit();                  // measured at boot while the view is still display:none
  window.addEventListener('resize', () => { if (App.view === 'sign') fit(); });

  const pos = e => {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height];
  };
  cv.addEventListener('pointerdown', e => {
    Sig.drawing = true; Sig.dirty = true; Sig.last = pos(e);
    cv.setPointerCapture(e.pointerId); e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!Sig.drawing) return;
    const ctx = cv.getContext('2d'), p = pos(e);
    ctx.beginPath(); ctx.moveTo(Sig.last[0], Sig.last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    Sig.last = p; e.preventDefault();
  });
  const up = () => { Sig.drawing = false; };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
}

function clearSigPad(){
  const cv = $('sigPad'), ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  Sig.dirty = false;
}

/* white -> transparent + trim margins */
function cleanSignature(cv){
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const im = ctx.getImageData(0, 0, cv.width, cv.height), d = im.data;
  let minX = cv.width, minY = cv.height, maxX = -1, maxY = -1;
  for (let y = 0; y < cv.height; y++){
    for (let x = 0; x < cv.width; x++){
      const i = (y * cv.width + x) * 4;
      const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      if (lum > 205){ d[i + 3] = 0; }
      else {
        d[i + 3] = Math.min(255, Math.round((205 - lum) * 255 / 150));
        d[i] = d[i + 1] = d[i + 2] = 17;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  ctx.putImageData(im, 0, 0);
  const pad = Math.round(Math.max(cv.width, cv.height) * 0.02);
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(cv.width - 1, maxX + pad); maxY = Math.min(cv.height - 1, maxY + pad);
  const out = mkCanvas(maxX - minX + 1, maxY - minY + 1);
  out.getContext('2d').drawImage(cv, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function saveSignature(){
  const src = $('sigPad');
  if (!Sig.dirty){ toast('วาดลายเซ็นก่อน'); return; }
  const cv = cleanSignature(copyCanvas(src));
  if (!cv){ toast('ไม่พบเส้นลายเซ็น'); return; }
  setSignature(cv.toDataURL('image/png'), cv.width / cv.height);
}
function copyCanvas(cv){
  const c = mkCanvas(cv.width, cv.height);
  c.getContext('2d').drawImage(cv, 0, 0);
  return c;
}
function setSignature(dataUrl, ratio){
  App.sig = { dataUrl, ratio };
  try { localStorage.setItem('dockit.sig', JSON.stringify(App.sig)); } catch(e){}
  $('sigSaved').innerHTML = '<img src="' + dataUrl + '"><div class="dim sm">บันทึกลายเซ็นแล้ว</div>';
  toast('บันทึกลายเซ็นแล้ว');
}
function loadSavedSignature(){
  try {
    const s = JSON.parse(localStorage.getItem('dockit.sig') || 'null');
    if (s && s.dataUrl){
      App.sig = s;
      $('sigSaved').innerHTML = '<img src="' + s.dataUrl + '"><div class="dim sm">ลายเซ็นที่บันทึกไว้</div>';
    }
  } catch(e){}
}

async function useSignatureFile(file){
  const bm = await blobToBitmap(file);
  const sc = Math.min(1, 900 / Math.max(bm.width, bm.height));
  const cv = mkCanvas(bm.width * sc, bm.height * sc);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bm, 0, 0, cv.width, cv.height);
  const out = cleanSignature(cv);
  if (!out){ toast('รูปนี้ไม่มีเส้นลายเซ็น'); return; }
  setSignature(out.toDataURL('image/png'), out.width / out.height);
}

/* ---------- placement ---------- */
function thaiDate(d){
  const m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return d.getDate() + ' ' + m[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

/* ============================================================
   ตัวแก้ตำแหน่ง overlay — ใช้ร่วมกันทั้งลายเซ็น / ลายน้ำ / ตราคร่อม
   Place.pick(p) = overlay ที่กล่องกำลังจับอยู่                     */
const Place = { pick: null, back: 'sign', title: 'วางลายเซ็น', kind: 'sig' };

function placePick(p){ return Place.pick ? Place.pick(p) : null; }

async function startPlacement(){
  if (!App.sig){ toast('บันทึกลายเซ็นก่อน'); return; }
  const list = scopePages(segScope('sigScopeSeg'));
  if (!list.length){ toast('เลือกหน้าที่จะเซ็นก่อน'); return; }
  const withDate = $('sigDate').checked;

  for (const p of list){
    if (!p.overlays.some(o => o.kind === 'sig' && o.type === 'img')){
      const w = 0.28, h = w / App.sig.ratio * (pageVisibleSize(p).w / pageVisibleSize(p).h);
      const o = { kind: 'sig', type: 'img', dataUrl: App.sig.dataUrl, ratio: App.sig.ratio,
                  x: 0.60, y: 0.76, w: w, h: h, opacity: 100 };
      await hydrateOverlay(o);
      p.overlays.push(o);
    }
    p.overlays = p.overlays.filter(o => !(o.kind === 'sig' && o.type === 'text'));
    if (withDate){
      const s = p.overlays.find(o => o.kind === 'sig' && o.type === 'img');
      p.overlays.push({ kind: 'sig', type: 'text', text: thaiDate(new Date()),
                        x: s.x, y: s.y + s.h + 0.005, fs: 0.016, color: '#111', opacity: 100 });
    }
  }
  openPlacement(list, {
    kind: 'sig', back: 'sign', title: 'วางลายเซ็น',
    pick: p => p.overlays.find(o => o.kind === 'sig' && o.type === 'img')
  });
}

/* เรียกจากลายน้ำ/ตราคร่อมโหมด "วางเอง" */
function startOverlayPlacement(list, slot, kind, title){
  openPlacement(list, {
    kind: kind, back: 'wm', title: title,
    pick: p => p.overlays.find(o => o.kind === 'wm' && (o.slot || 'wm') === slot && o.layout === 'free')
  });
}

async function openPlacement(list, opt){
  Sig.list = list; Sig.idx = 0;
  Object.assign(Place, opt);
  $('placeTitle').textContent = opt.title;
  $('placeBack').dataset.back = opt.back;
  $('btnPlaceDel').textContent = opt.kind === 'sig' ? 'ลบลายเซ็น' : 'ลบออกจากหน้านี้';
  showView('place');
  await drawPlace();
}

async function drawPlace(){
  const p = Sig.list[Sig.idx];
  if (!p){ showView('pages'); return; }
  $('placeLbl').textContent = 'หน้า ' + (App.pages.indexOf(p) + 1) + ' (' + (Sig.idx + 1) + '/' + Sig.list.length + ')';
  const cv = $('placeCv');
  const maxW = Math.min(window.innerWidth - 20, 640);
  const maxH = window.innerHeight * 0.5;
  let full;
  try{ full = await renderPageCanvas(p, 1000); }
  catch(e){
    console.error(e);
    toast('เปิดหน้านี้ไม่ได้ (ไฟล์เสียหรือกู้คืนไม่สำเร็จ): ' + e.message, 3500);
    $('placeBox').classList.remove('on');
    return;
  }
  const s = Math.min(maxW / full.width, maxH / full.height, 1);
  cv.width = Math.round(full.width * s); cv.height = Math.round(full.height * s);
  const ctx = cv.getContext('2d');
  ctx.drawImage(full, 0, 0, cv.width, cv.height);
  for (const o of p.overlays) await hydrateOverlay(o);

  // วาดทุก overlay ยกเว้นตัวที่กล่องกำลังจับ (ตัวนั้นโชว์ในกล่องแทน)
  const held = placePick(p);
  for (const o of p.overlays){
    if (o === held) continue;
    if (o.kind === 'wm' && !isFree(o)) paintWM(ctx, o, cv.width, cv.height);
    else paintObj(ctx, o, cv.width, cv.height);
  }
  cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';

  const box = $('placeBox');
  if (!held){ box.classList.remove('on'); return; }
  box.classList.add('on');
  box.style.left = (held.x * cv.width) + 'px';
  box.style.top = (held.y * cv.height) + 'px';
  box.style.width = (held.w * cv.width) + 'px';
  box.style.height = (held.h * cv.height) + 'px';
  box.style.opacity = (held.opacity === undefined ? 100 : held.opacity) / 100;
  box.style.transform = held.rot ? 'rotate(' + (-held.rot) + 'deg)' : '';
  let im = box.querySelector('img');
  if (!im){ im = new Image(); box.insertBefore(im, box.firstChild); }
  im.src = held.dataUrl;
}

function wirePlaceBox(){
  const box = $('placeBox');
  let mode = null, st = null;
  box.addEventListener('pointerdown', e => {
    const p = Sig.list[Sig.idx];
    const o = p && placePick(p);
    if (!o) return;
    const cv = $('placeCv');
    const isHandle = e.target.classList.contains('handle');
    mode = isHandle ? (e.target.classList.contains('rot') ? 'rotate' : 'size') : 'move';
    const rect = box.getBoundingClientRect();
    st = {
      x: e.clientX, y: e.clientY, o: Object.assign({}, o), W: cv.width, H: cv.height, ref: o, p,
      cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2,
      ang0: Math.atan2(e.clientY - (rect.top + rect.height / 2), e.clientX - (rect.left + rect.width / 2)) * 180 / Math.PI,
      rot0: o.rot || 0
    };
    box.setPointerCapture(e.pointerId); e.preventDefault();
  });
  box.addEventListener('pointermove', e => {
    if (!mode) return;
    const o = st.ref;
    if (mode === 'rotate'){
      const ang = Math.atan2(e.clientY - st.cy, e.clientX - st.cx) * 180 / Math.PI;
      o.rot = Math.round(st.rot0 - (ang - st.ang0));
      $('placeBox').style.transform = 'rotate(' + (-o.rot) + 'deg)';
      e.preventDefault();
      return;
    }
    const dx = (e.clientX - st.x) / st.W, dy = (e.clientY - st.y) / st.H;
    if (mode === 'move'){
      o.x = Math.max(-0.05, Math.min(1 - o.w * 0.3, st.o.x + dx));
      o.y = Math.max(-0.05, Math.min(1 - o.h * 0.3, st.o.y + dy));
    } else {
      const nw = Math.max(0.05, Math.min(1.4, st.o.w + dx));
      o.h = st.o.h * (nw / st.o.w);
      o.w = nw;
    }
    const t = st.p.overlays.find(x => x.kind === 'sig' && x.type === 'text');
    if (t && Place.kind === 'sig'){ t.x = o.x; t.y = o.y + o.h + 0.005; }
    const b = $('placeBox'), cv = $('placeCv');
    b.style.left = (o.x * cv.width) + 'px'; b.style.top = (o.y * cv.height) + 'px';
    b.style.width = (o.w * cv.width) + 'px'; b.style.height = (o.h * cv.height) + 'px';
    e.preventDefault();
  }, { passive: false });
  const up = async () => {
    if (!mode) return;
    mode = null;
    await drawPlace();
  };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
}

async function placeNav(d){
  Sig.idx = Math.max(0, Math.min(Sig.list.length - 1, Sig.idx + d));
  await drawPlace();
}
async function placeDelete(){
  const p = Sig.list[Sig.idx];
  if (Place.kind === 'sig'){
    p.overlays = p.overlays.filter(o => o.kind !== 'sig');
  } else {
    const held = placePick(p);
    p.overlays = p.overlays.filter(o => o !== held);
  }
  await drawPlace();
  toast('ลบออกจากหน้านี้แล้ว');
}
async function placeDone(){
  busy(true, 'กำลังอัปเดต…');
  try{ for (const p of Sig.list) await refreshThumb(p); }
  catch(e){
    console.error(e); busy(false); renderGrid();
    toast('อัปเดตไม่สำเร็จ: ' + e.message, 3500);
    return;
  }
  busy(false);
  renderGrid();
  showView('pages');
  offerNextStep(
    Place.kind === 'sig' ? 'ใส่ลายเซ็นแล้ว' : 'วางลายน้ำแล้ว',
    Sig.list.length + ' หน้า — ทำอะไรต่อดี?',
    Place.kind === 'sig' ? 'sign' : 'wm'
  );
}
