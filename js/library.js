'use strict';
/* ============================================================
   DocKit — คลังของฉัน: เก็บไฟล์ที่ใช้บ่อยไว้ในเครื่อง จัดเป็นโฟลเดอร์
   ต่างจาก history.js (ไฟล์ที่เพิ่งสร้างเสร็จ เก็บอัตโนมัติ 30 ไฟล์ล่าสุด)
   และ persist.js (งานที่ยังทำค้าง) — ที่นี่คือของที่ผู้ใช้ "ตั้งใจเก็บถาวร"
   เก็บเป็น ArrayBuffer ไม่ใช่ Blob (เหตุผลเดียวกับที่อื่น ดู CLAUDE.md)
   ============================================================ */

const LIB_DB = 'dockit-library', LIB_VER = 1;

function libOpen(){
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no indexeddb'));
    const req = indexedDB.open(LIB_DB, LIB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('folders'))
        db.createObjectStore('folders', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('items')){
        const s = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
        s.createIndex('folderId', 'folderId');
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

const libTx = async (stores, mode, fn) => {
  const db = await libOpen();
  const out = await new Promise((res, rej) => {
    const tx = db.transaction(stores, mode);
    let r;
    try { r = fn(tx); } catch(e){ rej(e); return; }
    tx.oncomplete = () => res(r && r.value !== undefined ? r.value : r);
    tx.onerror = () => rej(tx.error);
  });
  db.close();
  return out;
};
const reqVal = req => { const box = {}; req.onsuccess = () => { box.value = req.result; }; return box; };

/* ---------- โฟลเดอร์ ---------- */
async function libFolders(){
  try {
    const list = await libTx('folders', 'readonly', tx => reqVal(tx.objectStore('folders').getAll()));
    return (list || []).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  } catch(e){ console.error('libFolders', e); return []; }
}
function libAddFolder(name){
  return libTx('folders', 'readwrite', tx =>
    reqVal(tx.objectStore('folders').add({ name: name.trim(), createdAt: Date.now() })));
}
async function libRenameFolder(id, name){
  const f = await libTx('folders', 'readonly', tx => reqVal(tx.objectStore('folders').get(id)));
  if (!f) return;
  f.name = name.trim();
  return libTx('folders', 'readwrite', tx => tx.objectStore('folders').put(f));
}
/* ลบโฟลเดอร์ = ลบไฟล์ข้างในทั้งหมดด้วย (ถามยืนยันที่ชั้น UI แล้ว) */
async function libDeleteFolder(id){
  const items = await libItems(id);
  return libTx(['folders', 'items'], 'readwrite', tx => {
    items.forEach(it => tx.objectStore('items').delete(it.id));
    tx.objectStore('folders').delete(id);
  });
}

/* ---------- ไฟล์ในคลัง ---------- */
async function libItems(folderId){
  try {
    const list = await libTx('items', 'readonly', tx =>
      reqVal(tx.objectStore('items').index('folderId').getAll(folderId)));
    return (list || []).sort((a, b) => b.createdAt - a.createdAt);
  } catch(e){ console.error('libItems', e); return []; }
}
async function libCounts(){
  try {
    const all = await libTx('items', 'readonly', tx => reqVal(tx.objectStore('items').getAll()));
    const by = {}; let bytes = 0;
    for (const it of (all || [])){ by[it.folderId] = (by[it.folderId] || 0) + 1; bytes += it.size || 0; }
    return { by, total: (all || []).length, bytes };
  } catch(e){ return { by: {}, total: 0, bytes: 0 }; }
}

/* ย่อรูปเป็นภาพตัวอย่าง — PDF ใช้หน้าแรก */
async function libThumb(file){
  try {
    if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)){
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      const pg = await doc.getPage(1);
      const vp0 = pg.getViewport({ scale: 1 });
      const s = 220 / Math.max(vp0.width, vp0.height);
      const vp = pg.getViewport({ scale: s });
      const cv = mkCanvas(vp.width, vp.height);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      return cv.toDataURL('image/jpeg', 0.7);
    }
    const bm = await blobToBitmap(file);
    const s = Math.min(1, 220 / Math.max(bm.width, bm.height));
    const cv = mkCanvas(bm.width * s, bm.height * s);
    cv.getContext('2d').drawImage(bm, 0, 0, cv.width, cv.height);
    if (bm.close) bm.close();
    return cv.toDataURL('image/jpeg', 0.7);
  } catch(e){ console.error('libThumb', e); return ''; }
}

async function libAddItem(folderId, file){
  const bytes = await file.arrayBuffer();
  const thumb = await libThumb(file);
  return libTx('items', 'readwrite', tx => reqVal(tx.objectStore('items').add({
    folderId, name: file.name || 'ไฟล์', mime: file.type || 'application/octet-stream',
    size: file.size, bytes, thumb, createdAt: Date.now()
  })));
}
function libDeleteItem(id){
  return libTx('items', 'readwrite', tx => tx.objectStore('items').delete(id));
}
/* คืนเป็น File เพื่อส่งต่อเข้าทางเดิมของแอปได้ทันที (addImageFiles / addPdfFiles / idLoad) */
async function libItemFile(id){
  const it = await libTx('items', 'readonly', tx => reqVal(tx.objectStore('items').get(id)));
  if (!it) return null;
  return new File([it.bytes], it.name, { type: it.mime });
}
async function libRenameItem(id, name){
  const it = await libTx('items', 'readonly', tx => reqVal(tx.objectStore('items').get(id)));
  if (!it) return;
  it.name = name.trim();
  return libTx('items', 'readwrite', tx => tx.objectStore('items').put(it));
}

/* ============================================================
   UI
   Lib.pick = ฟังก์ชันที่จะถูกเรียกเมื่อผู้ใช้แตะไฟล์ (โหมดเลือกไฟล์)
   ถ้าเป็น null = โหมดจัดการคลังปกติ
   ============================================================ */
const Lib = { folderId: null, folderName: '', pick: null, pickLabel: '' };

async function renderLib(){
  const folders = await libFolders();
  const c = await libCounts();
  $('libSummary').textContent = folders.length
    ? folders.length + ' โฟลเดอร์ · ' + c.total + ' ไฟล์ · ' + histSizeText(c.bytes)
    : '';
  $('libHint').style.display = folders.length ? 'none' : 'block';
  $('libFolders').innerHTML = folders.map(f =>
    '<div class="row" data-fid="' + f.id + '">' +
      '<div class="badge" style="background:var(--t-amber)"><svg class="ic" viewBox="0 0 24 24"><use href="#i-files"/></svg></div>' +
      '<div class="meta"><div class="nm">' + escHtml(f.name) + '</div>' +
      '<div class="sz">' + (c.by[f.id] || 0) + ' ไฟล์</div></div>' +
      '<button class="chip-btn round" data-lact="ren" title="เปลี่ยนชื่อ"><svg class="ic" viewBox="0 0 24 24"><use href="#i-pen"/></svg></button>' +
      '<button class="chip-btn round danger" data-lact="del" title="ลบโฟลเดอร์"><svg class="ic" viewBox="0 0 24 24"><use href="#i-trash"/></svg></button>' +
    '</div>').join('');
  $('libTitle').textContent = Lib.pick ? (Lib.pickLabel || 'เลือกจากคลัง') : 'คลังของฉัน';
}

async function openLibFolder(id, name){
  Lib.folderId = id; Lib.folderName = name;
  $('libFolderTitle').textContent = name;
  showView('libFolder');
  await renderLibItems();
}

async function renderLibItems(){
  const items = await libItems(Lib.folderId);
  $('libItemsHint').style.display = items.length ? 'none' : 'block';
  $('libItems').innerHTML = items.map(it => {
    const isPdf = /pdf/i.test(it.mime || it.name);
    return '<div class="libcard" data-iid="' + it.id + '">' +
      (it.thumb ? '<img src="' + it.thumb + '" alt="">' : '<div class="libph">' + (isPdf ? 'PDF' : 'IMG') + '</div>') +
      '<div class="libnm">' + escHtml(it.name) + '</div>' +
      '<div class="tag">' + (isPdf ? 'PDF' : 'รูป') + '</div>' +
      '</div>';
  }).join('');
  $('libUseHint').style.display = (items.length && Lib.pick) ? 'block' : 'none';
}

/* เพิ่มไฟล์เข้าคลัง (หลายไฟล์ได้) */
async function libImport(files){
  if (!files || !files.length || Lib.folderId == null) return;
  busy(true, 'กำลังเก็บเข้าคลัง…');
  let n = 0;
  try {
    for (const f of files){ await libAddItem(Lib.folderId, f); n++; await nextFrame(); }
  } catch(e){ console.error(e); toast('เก็บไม่สำเร็จ: ' + e.message, 3500); }
  busy(false);
  await renderLibItems();
  if (n) toast('เก็บเข้าคลังแล้ว ' + n + ' ไฟล์');
}

/* เปิดคลังในโหมด "เลือกไฟล์" — onPick(File) จะถูกเรียกเมื่อผู้ใช้แตะไฟล์ */
function openLibPicker(label, onPick){
  Lib.pick = onPick; Lib.pickLabel = label;
  showView('library');
}
function exitLibPick(){ Lib.pick = null; Lib.pickLabel = ''; }

function wireLibrary(){
  $('btnLibNewFolder').onclick = async () => {
    const name = prompt('ชื่อโฟลเดอร์ใหม่');
    if (!name || !name.trim()) return;
    await libAddFolder(name);
    await renderLib();
  };

  $('libFolders').addEventListener('click', async e => {
    const row = e.target.closest('[data-fid]');
    if (!row) return;
    const id = +row.dataset.fid;
    const name = row.querySelector('.nm').textContent;
    const act = e.target.closest('[data-lact]');
    if (act && act.dataset.lact === 'ren'){
      const n = prompt('เปลี่ยนชื่อโฟลเดอร์', name);
      if (n && n.trim()){ await libRenameFolder(id, n); await renderLib(); }
      return;
    }
    if (act && act.dataset.lact === 'del'){
      const cnt = (await libItems(id)).length;
      if (!confirm('ลบโฟลเดอร์ "' + name + '"' + (cnt ? ' และไฟล์ข้างใน ' + cnt + ' ไฟล์' : '') + '?')) return;
      await libDeleteFolder(id); await renderLib();
      return;
    }
    openLibFolder(id, name);
  });

  const imp = id => $(id).addEventListener('change', e => {
    const files = Array.from(e.target.files); e.target.value = '';
    libImport(files);
  });
  imp('libCam'); imp('libImg'); imp('libPdf');

  $('libItems').addEventListener('click', async e => {
    const card = e.target.closest('[data-iid]');
    if (!card) return;
    const id = +card.dataset.iid;
    const name = card.querySelector('.libnm').textContent;

    if (Lib.pick){                       // โหมดเลือกไฟล์ไปใช้งาน
      busy(true, 'กำลังเปิดไฟล์…');
      const file = await libItemFile(id);
      busy(false);
      if (!file){ toast('ไม่พบไฟล์'); await renderLibItems(); return; }
      const cb = Lib.pick; exitLibPick();
      cb(file);
      return;
    }
    // โหมดจัดการ: ถามว่าจะทำอะไรกับไฟล์นี้
    Lib.actId = id; Lib.actName = name;
    $('libActName').textContent = name;
    $('libAct').classList.add('on');
  });

  $('libAct').addEventListener('click', async e => {
    const b = e.target.closest('[data-la]');
    if (!b){ if (e.target.id === 'libAct') $('libAct').classList.remove('on'); return; }
    const k = b.dataset.la;
    $('libAct').classList.remove('on');
    const id = Lib.actId;
    if (k === 'use'){
      busy(true, 'กำลังเปิดไฟล์…');
      const file = await libItemFile(id);
      if (file){
        if (/pdf/i.test(file.type)) await addPdfFiles([file]);
        else await addImageFiles([file]);
      }
      busy(false);
      renderGrid();
      showView('pages');
      toast('เพิ่มเข้าหน้าเอกสารแล้ว');
    } else if (k === 'ren'){
      const n = prompt('เปลี่ยนชื่อไฟล์', Lib.actName);
      if (n && n.trim()){ await libRenameItem(id, n); await renderLibItems(); }
    } else if (k === 'del'){
      if (!confirm('ลบ "' + Lib.actName + '" ออกจากคลัง?')) return;
      await libDeleteItem(id); await renderLibItems(); toast('ลบแล้ว');
    }
  });
}
