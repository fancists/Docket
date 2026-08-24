'use strict';
/* ============================================================
   DocKit — เซฟ "เอกสาร" (พื้นที่ทำงานที่ยังไม่ส่งออก) ลง IndexedDB
   ต่างจาก history.js (ไฟล์ที่ "เสร็จแล้ว" แก้ไม่ได้) — ที่นี่เก็บสถานะที่
   ยังแก้ไขต่อได้อยู่ (overlay, crop, ตัวตัด PDF ต้นทาง) เปิดแอปใหม่แล้วกลับมาทำต่อได้
   ============================================================ */

const WS_DB = 'dockit-workspace', WS_VER = 1;

function wsOpen(){
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no indexeddb'));
    const req = indexedDB.open(WS_DB, WS_VER);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('workspace');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/* ตัดของที่ persist ไม่ได้ (Image element ที่ hydrateOverlay สร้างไว้) ออกก่อนเซฟ */
function stripOverlay(o){
  const rest = Object.assign({}, o);
  delete rest._img;
  return rest;
}
function stripPage(p){
  return {
    id: p.id, kind: p.kind, name: p.name, rotate: p.rotate,
    overlays: p.overlays.map(stripOverlay),
    img: p.img,
    pdf: p.pdf,
    thumb: p.thumb
  };
}

let _wsSaveTimer = null;
function saveWorkspaceSoon(){
  clearTimeout(_wsSaveTimer);
  _wsSaveTimer = setTimeout(saveWorkspace, 500);
}

async function saveWorkspace(){
  try{
    const pages = App.pages.map(stripPage);
    const srcIds = new Set(App.pages.filter(p => p.kind === 'pdf').map(p => p.pdf.srcId));
    const srcs = {};
    for (const id of srcIds) if (App.srcs[id]) srcs[id] = { bytes: App.srcs[id].bytes };
    const db = await wsOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put({ pages, srcs, seq: App.seq, savedAt: Date.now() }, 'current');
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch(e){ console.error('saveWorkspace', e); }
}

/* คืนค่า true ถ้ามีงานค้างให้กลับมาทำต่อ */
async function loadWorkspace(){
  try{
    const db = await wsOpen();
    const rec = await new Promise((res, rej) => {
      const tx = db.transaction('workspace', 'readonly');
      const req = tx.objectStore('workspace').get('current');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    db.close();
    if (!rec || !rec.pages || !rec.pages.length) return false;

    for (const [id, s] of Object.entries(rec.srcs || {})){
      try{
        const doc = await pdfjsLib.getDocument({ data: s.bytes.slice(0) }).promise;
        App.srcs[id] = { bytes: s.bytes, doc };
      } catch(e){ console.error('restore pdf src', id, e); }
    }
    // หน้าที่อ้างอิงต้นทาง PDF ที่กู้ไม่สำเร็จ ต้องทิ้งไป ไม่งั้นเปิดไม่ได้
    App.pages = rec.pages.filter(p => p.kind !== 'pdf' || App.srcs[p.pdf.srcId]);
    App.seq = Math.max(App.seq, rec.seq || 0);
    for (const p of App.pages) for (const o of p.overlays) await hydrateOverlay(o);
    return App.pages.length > 0;
  } catch(e){ console.error('loadWorkspace', e); return false; }
}
