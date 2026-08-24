'use strict';
/* ============================================================
   DocKit — core state, import, page grid
   Page model
     {id, kind:'img'|'pdf', name, rotate:0|90|180|270, overlays:[],
      img:{blob,w,h,enh:{mode,bright,contrast},crop:null|[[x,y]x4]},
      pdf:{srcId,idx,w,h},
      thumb:dataURL}
   Overlay model (normalized to the page's VISIBLE box, y down, 0..1)
     {kind:'sig'|'wm', type:'img'|'text', x,y,w,h, rot, opacity,
      color, text, dataUrl, layout}
   ============================================================ */

const App = {
  pages: [],
  srcs: {},          // srcId -> {bytes:Uint8Array, doc:pdfjsDoc}
  sel: new Set(),
  sig: null,         // {dataUrl, ratio}
  seq: 0,
  scanId: null,      // page id being edited in scan view
  placeIdx: 0,       // index of page shown in placement view
  view: 'pages'
};

const MAXDIM = 2400;   // downscale imported photos (memory guard on phones)
const THUMB = 260;

/* ---------- tiny helpers ---------- */
function $(id){ return document.getElementById(id); }
function uid(){ return 'p' + (++App.seq); }

let _toastT = null;
function toast(msg, ms){
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => t.classList.remove('on'), ms || 2200);
}
function busy(on, txt){
  $('busyTxt').textContent = txt || 'กำลังทำงาน…';
  $('busy').classList.toggle('on', !!on);
}
// yield to the UI thread. setTimeout only: requestAnimationFrame never fires in a
// hidden/backgrounded tab, which would freeze import/export mid-run.
const nextFrame = () => new Promise(r => setTimeout(r, 0));

/* หน้าที่เป็น "flow" ซ่อนแท็บล่างและมีปุ่มย้อนกลับของตัวเอง (ตาม design draft) */
const FLOW_VIEWS = new Set(['scan', 'wm', 'sign', 'place', 'photo', 'idcard',
                            'redactPick', 'redact', 'export', 'done']);

/* เครื่องมือที่ทำงานกับหน้าเอกสาร — เปิดตอนยังไม่มีไฟล์ = ตายอยู่ตรงนั้น
   จึงคั่นด้วยขั้น "เลือกไฟล์" ให้นำเข้าได้จากในเครื่องมือเลย */
const NEEDS_PAGES = {
  wm:         'เลือกไฟล์ที่จะใส่ลายน้ำก่อน',
  sign:       'เลือกไฟล์ที่จะเซ็นก่อน',
  redactPick: 'เลือกไฟล์ที่จะปกปิดข้อมูลก่อน',
  export:     'เลือกไฟล์ที่จะส่งออกก่อน'
};
function needFiles(v){
  const why = NEEDS_PAGES[v];
  const show = !!why && App.pages.length === 0;
  if (show) $('nfWhat').textContent = why;
  $('needFiles').classList.toggle('on', show);
  return show;
}

function showView(v){
  App.view = v;
  document.querySelectorAll('.view').forEach(s => s.classList.remove('active'));
  const el = $('view-' + v);
  if (el) el.classList.add('active');
  document.body.classList.toggle('flow', FLOW_VIEWS.has(v));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'sign' && typeof Sig !== 'undefined' && Sig.fit) Sig.fit();
  if (v === 'home') renderHome();
  renderPickers();
  needFiles(v);
}

function updateHeader(){
  const n = App.pages.length, s = App.sel.size;
  $('tbSub').textContent = n === 0 ? 'ยังไม่มีหน้า'
    : (s ? n + ' หน้า · เลือก ' + s : n + ' หน้า');
  const files = new Set(App.pages.map(p => p.kind === 'pdf' ? p.pdf.srcId : p.id)).size;
  $('homeSub').textContent = n === 0 ? 'ยังไม่มีเอกสาร'
    : n + ' หน้า · ' + files + ' ไฟล์';
}

/* หน้าแรก: รายการหน้าล่าสุด (แถวแบบ design draft) */
function renderHome(){
  const box = $('recentList');
  const recent = App.pages.slice(-4).reverse();
  $('recentHint').style.display = recent.length ? 'none' : 'block';
  box.innerHTML = recent.map(p => {
    const i = App.pages.indexOf(p) + 1;
    return '<div class="row" data-id="' + p.id + '">' +
      '<div class="badge" style="background:var(--' +
        (p.kind === 'pdf' ? 't-blue' : 't-cyan') + ')">' +
        (p.thumb ? '<img src="' + p.thumb + '" alt="">' : (p.kind === 'pdf' ? 'PDF' : 'IMG')) + '</div>' +
      '<div class="meta"><div class="nm">' + escHtml(p.name) + '</div>' +
      '<div class="sz">หน้า ' + i + ' · ' + (p.kind === 'pdf' ? 'PDF' : 'รูป') + '</div></div></div>';
  }).join('');
  updateHeader();
}
function escHtml(s){
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

/* ---------- canvas utils ---------- */
function mkCanvas(w, h){
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
function canvasToBlob(cv, type, q){
  return new Promise(res => cv.toBlob(res, type || 'image/jpeg', q === undefined ? 0.9 : q));
}
function blobToBitmap(blob){
  if (window.createImageBitmap) return createImageBitmap(blob);
  return new Promise((res, rej) => {
    const im = new Image(), u = URL.createObjectURL(blob);
    im.onload = () => { URL.revokeObjectURL(u); res(im); };
    im.onerror = rej; im.src = u;
  });
}
function thumbOf(cv){
  const s = THUMB / Math.max(cv.width, cv.height);
  const t = mkCanvas(cv.width * Math.min(1, s), cv.height * Math.min(1, s));
  t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.75);
}

/* ---------- import: images ---------- */
async function addImageFiles(files){
  if (!files || !files.length) return;
  busy(true, 'กำลังนำเข้ารูป…');
  try{
    for (const f of files){
      if (!/^image\//.test(f.type)) continue;
      const bm = await blobToBitmap(f);
      const sc = Math.min(1, MAXDIM / Math.max(bm.width, bm.height));
      const cv = mkCanvas(bm.width * sc, bm.height * sc);
      cv.getContext('2d').drawImage(bm, 0, 0, cv.width, cv.height);
      if (bm.close) bm.close();
      const blob = await canvasToBlob(cv, 'image/jpeg', 0.92);
      const p = {
        id: uid(), kind: 'img', name: f.name || 'รูป', rotate: 0, overlays: [],
        img: { blob, w: cv.width, h: cv.height,
               enh: { mode: 'mag', bright: 0, contrast: 0 }, crop: null },
        thumb: null
      };
      App.pages.push(p);
      await refreshPageRaster(p);          // apply default enhance + thumb
      await nextFrame();
    }
    renderGrid();
    toast('เพิ่มแล้ว ' + files.length + ' รูป');
  } catch(e){ console.error(e); toast('นำเข้ารูปไม่สำเร็จ: ' + e.message, 3500); }
  busy(false);
}

/* ---------- import: pdf ---------- */
async function addPdfFiles(files){
  if (!files || !files.length) return;
  busy(true, 'กำลังอ่าน PDF…');
  try{
    for (const f of files){
      const bytes = new Uint8Array(await f.arrayBuffer());
      const srcId = 's' + (++App.seq);
      // pdf.js consumes (detaches) the buffer it is given -> hand it a copy
      const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      App.srcs[srcId] = { bytes, doc };
      for (let i = 1; i <= doc.numPages; i++){
        const pg = await doc.getPage(i);
        const vp = pg.getViewport({ scale: 1 });
        const p = {
          id: uid(), kind: 'pdf', name: (f.name || 'PDF') + ' น.' + i,
          rotate: 0, overlays: [],
          pdf: { srcId, idx: i - 1, w: vp.width, h: vp.height },
          thumb: null
        };
        p.thumb = await renderPdfThumb(pg);
        App.pages.push(p);
        await nextFrame();
      }
    }
    renderGrid();
    toast('เพิ่ม PDF แล้ว');
  } catch(e){ console.error(e); toast('อ่าน PDF ไม่สำเร็จ: ' + e.message, 3500); }
  busy(false);
}

async function renderPdfThumb(pg, px){
  const vp0 = pg.getViewport({ scale: 1 });
  const sc = (px || THUMB) / Math.max(vp0.width, vp0.height);
  const vp = pg.getViewport({ scale: sc });
  const cv = mkCanvas(vp.width, vp.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  return cv.toDataURL('image/jpeg', 0.8);
}

/* render a page (any kind) to a canvas at a target long-edge size, rotation applied */
async function renderPageCanvas(p, px){
  let cv;
  if (p.kind === 'img'){
    cv = await buildImageCanvas(p, px);
  } else {
    const src = App.srcs[p.pdf.srcId];
    const pg = await src.doc.getPage(p.pdf.idx + 1);
    const vp0 = pg.getViewport({ scale: 1 });
    const sc = px ? px / Math.max(vp0.width, vp0.height) : 1.6;
    const vp = pg.getViewport({ scale: sc });
    cv = mkCanvas(vp.width, vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    if (p.rotate) cv = rotateCanvas(cv, p.rotate);
  }
  return cv;
}

function rotateCanvas(cv, deg){
  deg = ((deg % 360) + 360) % 360;
  if (!deg) return cv;
  const sw = (deg === 90 || deg === 270);
  const out = mkCanvas(sw ? cv.height : cv.width, sw ? cv.width : cv.height);
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(deg * Math.PI / 180);
  ctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
  return out;
}

/* visible size of a page in PDF points (after rotation) */
function pageVisibleSize(p){
  if (p.kind === 'pdf'){
    const sw = (p.rotate === 90 || p.rotate === 270);
    return { w: sw ? p.pdf.h : p.pdf.w, h: sw ? p.pdf.w : p.pdf.h };
  }
  const sw = (p.rotate === 90 || p.rotate === 270);
  const w = p.img.outW || p.img.w, h = p.img.outH || p.img.h;
  return { w: sw ? h : w, h: sw ? w : h };
}

/* ---------- rebuild raster + thumb for an image page ---------- */
async function refreshPageRaster(p){
  await refreshThumb(p);          // defined in wm.js (page raster + overlays)
}

/* ---------- grid ---------- */
function renderGrid(){
  const g = $('grid');
  g.innerHTML = '';
  $('emptyHint').style.display = App.pages.length ? 'none' : 'block';
  App.pages.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'card' + (App.sel.has(p.id) ? ' sel' : '');
    d.dataset.id = p.id;
    const mk = n => '<b><svg class="ic"><use href="#i-' + n + '"/></svg></b>';
    const marks = [];
    if (p.overlays.some(o => o.kind === 'wm')) marks.push(mk('drop'));
    if (p.overlays.some(o => o.kind === 'sig')) marks.push(mk('pen'));
    d.innerHTML =
      '<img src="' + (p.thumb || '') + '" alt="">' +
      '<div class="no">' + (i + 1) + '</div>' +
      '<div class="tag">' + (p.kind === 'img' ? 'รูป' : 'PDF') + '</div>' +
      (marks.length ? '<div class="marks">' + marks.join('') + '</div>' : '');
    g.appendChild(d);
  });
  updateHeader();
  if (App.view === 'home') renderHome();
  renderPickers();
  attachGridGestures();
}

function toggleSel(id){
  if (App.sel.has(id)) App.sel.delete(id); else App.sel.add(id);
  const card = document.querySelector('.card[data-id="' + id + '"]');
  if (card) card.classList.toggle('sel', App.sel.has(id));
  updateHeader();
}
function selectedPages(){
  return App.pages.filter(p => App.sel.has(p.id));
}
function scopePages(scope){
  return scope === 'sel' ? selectedPages() : App.pages;
}

/* ค่า "ทุกหน้า / เลือกหน้า" ของเครื่องมือแต่ละตัว (อ่านจากปุ่ม seg ที่ active) */
function segScope(id){
  const b = $(id) && $(id).querySelector('button.on');
  return b ? b.dataset.sc : 'all';
}

/* ---------- ตัวเลือกหน้าในตัวเครื่องมือ (ใช้ App.sel ร่วมกับแท็บเอกสาร) ---------- */
function renderPickers(except){
  document.querySelectorAll('[data-picker]').forEach(box => {
    if (box === except) return;      // อันที่เพิ่งแตะ อัปเดต class เอง ไม่ต้องสร้าง DOM ใหม่
    const seg = box.parentElement.querySelector('.seg[id$="ScopeSeg"]');
    const on = seg && seg.querySelector('button.on');
    if (on && on.dataset.sc === 'all'){ box.innerHTML = ''; return; }
    if (!App.pages.length){ box.innerHTML = '<div class="pk-empty">ยังไม่มีหน้าเอกสาร</div>'; return; }
    box.innerHTML = App.pages.map((p, i) =>
      '<div class="pk' + (App.sel.has(p.id) ? ' on' : '') + '" data-pid="' + p.id + '">' +
      '<img src="' + (p.thumb || '') + '" alt=""><div class="n">' + (i + 1) + '</div></div>').join('');
  });
}

function wirePickers(){
  document.querySelectorAll('[data-picker]').forEach(box => {
    if (box._wired) return;
    box._wired = true;
    box.addEventListener('click', e => {
      const el = e.target.closest('.pk');
      if (!el) return;
      const id = el.dataset.pid;
      if (App.sel.has(id)) App.sel.delete(id); else App.sel.add(id);
      el.classList.toggle('on', App.sel.has(id));
      updateHeader();
      renderPickers(box);
    });
  });
}

/* ---------- gestures: tap = select, long-press = drag reorder, ✎ = edit ---------- */
let _g = null;
function attachGridGestures(){
  const g = $('grid');
  if (g._wired) return;
  g._wired = true;

  g.addEventListener('pointerdown', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    _g = { id: card.dataset.id, card, x0: e.clientX, y0: e.clientY, moved: false, drag: false, t: null };
    _g.t = setTimeout(() => {
      if (!_g || _g.moved) return;
      _g.drag = true;
      _g.card.classList.add('drag');
      if (navigator.vibrate) navigator.vibrate(15);
    }, 380);
  });

  g.addEventListener('pointermove', e => {
    if (!_g) return;
    if (Math.abs(e.clientX - _g.x0) > 8 || Math.abs(e.clientY - _g.y0) > 8) _g.moved = true;
    if (!_g.drag) return;
    e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const over = el && el.closest ? el.closest('.card') : null;
    g.querySelectorAll('.card.over').forEach(c => c.classList.remove('over'));
    if (over && over !== _g.card) over.classList.add('over');
  }, { passive: false });

  const end = e => {
    if (!_g) return;
    clearTimeout(_g.t);
    if (_g.drag){
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const over = el && el.closest ? el.closest('.card') : null;
      if (over && over !== _g.card) movePage(_g.id, over.dataset.id);
      _g.card.classList.remove('drag');
      g.querySelectorAll('.card.over').forEach(c => c.classList.remove('over'));
      renderGrid();
    } else if (!_g.moved){
      const p = App.pages.find(x => x.id === _g.id);
      if (p && p.kind === 'img' && e.detail === 2) openScan(p.id);
      else toggleSel(_g.id);
    }
    _g = null;
  };
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', () => { if (_g){ clearTimeout(_g.t); _g.card.classList.remove('drag'); _g = null; } });

  g.addEventListener('dblclick', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    const p = App.pages.find(x => x.id === card.dataset.id);
    if (p && p.kind === 'img') openScan(p.id);
  });
}

function movePage(fromId, toId){
  const a = App.pages.findIndex(p => p.id === fromId);
  const b = App.pages.findIndex(p => p.id === toId);
  if (a < 0 || b < 0 || a === b) return;
  const [p] = App.pages.splice(a, 1);
  App.pages.splice(b, 0, p);
}

/* ---------- page ops ---------- */
async function rotateSelected(){
  const list = selectedPages();
  if (!list.length){ toast('เลือกหน้าก่อน'); return; }
  busy(true, 'กำลังหมุน…');
  for (const p of list){
    p.rotate = (p.rotate + 90) % 360;
    if (p.kind === 'img') await refreshPageRaster(p);
    else await refreshThumb(p);
  }
  busy(false);
  renderGrid();
}
function rotateThumb(dataUrl, deg){
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const cv = mkCanvas(im.width, im.height);
      cv.getContext('2d').drawImage(im, 0, 0);
      res(rotateCanvas(cv, deg).toDataURL('image/jpeg', 0.8));
    };
    im.src = dataUrl;
  });
}
function deleteSelected(){
  const n = App.sel.size;
  if (!n){ toast('เลือกหน้าก่อน'); return; }
  if (!confirm('ลบ ' + n + ' หน้าที่เลือก?')) return;
  App.pages = App.pages.filter(p => !App.sel.has(p.id));
  App.sel.clear();
  renderGrid();
  toast('ลบแล้ว ' + n + ' หน้า');
}
