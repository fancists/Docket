'use strict';
/* ============================================================
   DocKit — ประวัติไฟล์ที่เคยสร้าง
   เก็บไฟล์จริง (ไม่ใช่แค่ชื่อ) ไว้ใน IndexedDB โหลดซ้ำได้แม้ปิดแท็บไปแล้ว
   แยก 2 store: meta (ชื่อ/เวลา/ขนาด — อ่านเร็วตอนแสดงลิสต์) กับ blobs (ไฟล์จริง)
   เก็บอัตโนมัติแค่ล่าสุด HIST_CAP รายการ กันพื้นที่เครื่องบวม
   ============================================================ */

const HIST_DB = 'dockit-history', HIST_VER = 1, HIST_CAP = 30;

function histOpen(){
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no indexeddb'));
    const req = indexedDB.open(HIST_DB, HIST_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')){
        const s = db.createObjectStore('meta', { keyPath: 'id', autoIncrement: true });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/* บันทึกไฟล์ที่เพิ่งสร้างเสร็จ — เรียกจาก showDone() อัตโนมัติทุกเครื่องมือ
   เก็บเป็นไบต์ ไม่ใช่ Blob (เหตุผลเดียวกับ persist.js — Blob ใน IndexedDB บน Safari
   เป็นตัวชี้ไปไฟล์เบื้องหลังที่หลุดได้ ทำให้ไฟล์ในประวัติเปิดไม่ขึ้นภายหลัง)          */
async function historyAdd(rec){
  try{
    const mime = rec.mime || rec.blob.type;
    const size = rec.blob.size;
    const bytes = await rec.blob.arrayBuffer();
    const db = await histOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction(['meta', 'blobs'], 'readwrite');
      const req = tx.objectStore('meta').add({
        name: rec.name, mime, size,
        title: rec.title || '', sub: rec.sub || '', createdAt: Date.now()
      });
      req.onsuccess = () => tx.objectStore('blobs').put({ bytes, mime }, req.result);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    await historyPrune(db);
    db.close();
  } catch(e){ console.error('historyAdd', e); }
}

function historyPrune(db){
  return new Promise(res => {
    const tx = db.transaction(['meta', 'blobs'], 'readwrite');
    const ids = [];
    tx.objectStore('meta').index('createdAt').openCursor(null, 'prev').onsuccess = e => {
      const cur = e.target.result;
      if (cur){ ids.push(cur.primaryKey); cur.continue(); }
      else ids.slice(HIST_CAP).forEach(id => {
        tx.objectStore('meta').delete(id);
        tx.objectStore('blobs').delete(id);
      });
    };
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

/* รายการล่าสุด -> เก่าสุด (เมทาดาทาล้วน ไม่ลากไฟล์จริงมาด้วยตอนแสดงลิสต์) */
async function historyList(){
  try{
    const db = await histOpen();
    const out = await new Promise((res, rej) => {
      const tx = db.transaction('meta', 'readonly');
      const list = [];
      tx.objectStore('meta').index('createdAt').openCursor(null, 'prev').onsuccess = e => {
        const cur = e.target.result;
        if (cur){ list.push(cur.value); cur.continue(); } else res(list);
      };
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return out;
  } catch(e){ console.error('historyList', e); return []; }
}

async function historyBlob(id){
  try{
    const db = await histOpen();
    const rec = await new Promise((res, rej) => {
      const tx = db.transaction('blobs', 'readonly');
      const req = tx.objectStore('blobs').get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
    db.close();
    if (!rec) return null;
    // รายการเก่าที่เคยเก็บเป็น Blob ตรงๆ ยังต้องอ่านได้ ไม่ให้ประวัติเดิมพังตอนอัปเดต
    if (rec instanceof Blob) return rec;
    return new Blob([rec.bytes], { type: rec.mime || 'application/pdf' });
  } catch(e){ console.error('historyBlob', e); return null; }
}

async function historyDelete(id){
  const db = await histOpen();
  await new Promise((res, rej) => {
    const tx = db.transaction(['meta', 'blobs'], 'readwrite');
    tx.objectStore('meta').delete(id);
    tx.objectStore('blobs').delete(id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  db.close();
}

async function historyClear(){
  const db = await histOpen();
  await new Promise((res, rej) => {
    const tx = db.transaction(['meta', 'blobs'], 'readwrite');
    tx.objectStore('meta').clear();
    tx.objectStore('blobs').clear();
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  db.close();
}

/* ---------- UI ---------- */
function histSizeText(bytes){
  const kb = bytes / 1024;
  return kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.round(kb) + ' KB';
}
function histDateText(ts){
  return new Date(ts).toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

async function renderHistory(){
  const box = $('histList');
  const list = await historyList();
  $('histEmpty').style.display = list.length ? 'none' : 'block';
  $('btnHistClearAll').style.display = list.length ? '' : 'none';
  $('histSummary').textContent = list.length
    ? list.length + ' ไฟล์ · รวม ' + histSizeText(list.reduce((s, r) => s + r.size, 0))
      + (list.length >= HIST_CAP ? ' · เก็บล่าสุด ' + HIST_CAP + ' ไฟล์ ไฟล์เก่ากว่านี้ถูกลบให้อัตโนมัติ' : '')
    : '';

  box.innerHTML = list.map(r => {
    const isPdf = /pdf/i.test(r.mime || r.name);
    return '<div class="row" data-id="' + r.id + '">' +
      '<div class="badge" style="background:var(--' + (isPdf ? 't-green' : 't-blue') + ')">' +
        (isPdf ? 'PDF' : 'IMG') + '</div>' +
      '<div class="meta"><div class="nm">' + escHtml(r.name) + '</div>' +
      '<div class="sz">' + histDateText(r.createdAt) + ' · ' + histSizeText(r.size) + '</div></div>' +
      '<button class="chip-btn round" data-act="dl" title="โหลดอีกครั้ง"><svg class="ic" viewBox="0 0 24 24"><use href="#i-down"/></svg></button>' +
      '<button class="chip-btn round danger" data-act="del" title="ลบ"><svg class="ic" viewBox="0 0 24 24"><use href="#i-trash"/></svg></button>' +
      '</div>';
  }).join('');
}

async function historyDownload(id, name){
  const blob = await historyBlob(id);
  if (!blob){ toast('ไม่พบไฟล์ — อาจถูกลบไปแล้ว'); renderHistory(); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- เลือกไฟล์จากประวัติมาเพิ่มเป็นหน้าเอกสาร ---------- */
async function openHistPicker(){
  const list = await historyList();
  const box = $('histPickList');
  box.innerHTML = list.length ? list.map(r => {
    const isPdf = /pdf/i.test(r.mime || r.name);
    return '<label class="row"><input type="checkbox" class="hp-chk" data-id="' + r.id + '">' +
      '<div class="badge" style="background:var(--' + (isPdf ? 't-green' : 't-blue') + ')">' +
        (isPdf ? 'PDF' : 'IMG') + '</div>' +
      '<div class="meta"><div class="nm">' + escHtml(r.name) + '</div>' +
      '<div class="sz">' + histDateText(r.createdAt) + ' · ' + histSizeText(r.size) + '</div></div></label>';
  }).join('') : '<div class="pk-empty">ยังไม่มีไฟล์ในประวัติ</div>';
  $('btnHistPickAdd').disabled = true;
  $('btnHistPickAdd').textContent = 'เพิ่มไฟล์ที่เลือก';
  $('histPicker').classList.add('on');
}

function wireHistPicker(){
  $('histPickList').addEventListener('change', () => {
    const n = $('histPickList').querySelectorAll('.hp-chk:checked').length;
    $('btnHistPickAdd').disabled = n === 0;
    $('btnHistPickAdd').textContent = n ? 'เพิ่ม ' + n + ' ไฟล์ที่เลือก' : 'เพิ่มไฟล์ที่เลือก';
  });
  $('histPicker').addEventListener('click', e => {
    if (e.target.id === 'histPicker' || e.target.closest('[data-hp="close"]')){
      $('histPicker').classList.remove('on');
    }
  });
  $('btnHistPickAdd').addEventListener('click', async () => {
    const ids = [...$('histPickList').querySelectorAll('.hp-chk:checked')].map(c => +c.dataset.id);
    $('histPicker').classList.remove('on');
    if (!ids.length) return;
    busy(true, 'กำลังเปิดไฟล์…');
    const list = await historyList();
    const files = [];
    for (const id of ids){
      const blob = await historyBlob(id);
      if (!blob) continue;
      const meta = list.find(r => r.id === id);
      files.push(new File([blob], (meta && meta.name) || ('ไฟล์-' + id + '.pdf'), { type: blob.type }));
    }
    await addPdfFiles(files);
    busy(false);
    if (App.view === 'home') renderHome();
    needFiles(App.view);
  });
}

function wireHistory(){
  $('histList').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const row = e.target.closest('.row');
    const id = +row.dataset.id;
    if (b.dataset.act === 'dl'){
      historyDownload(id, row.querySelector('.nm').textContent);
    } else if (b.dataset.act === 'del'){
      await historyDelete(id);
      toast('ลบแล้ว');
      renderHistory();
    }
  });
  $('btnHistClearAll').addEventListener('click', async () => {
    if (!confirm('ลบไฟล์ในประวัติทั้งหมด?')) return;
    await historyClear();
    renderHistory();
  });
}
