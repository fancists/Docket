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
/* เก็บรูปเป็น "ไบต์" ไม่ใช่ Blob — Blob ที่ยัดลง IndexedDB บน iOS/Safari เป็นแค่ตัวชี้ไป
   ไฟล์เบื้องหลัง ซึ่งหลุดได้เอง กลับมาอ่านไม่ขึ้น (createImageBitmap พังทั้งที่ object ยังอยู่)
   ส่วน ArrayBuffer ถูกคัดลอกเข้าไปจริง จึงกู้คืนได้เสมอ                                */
async function stripPage(p){
  const out = {
    id: p.id, kind: p.kind, name: p.name, rotate: p.rotate,
    overlays: p.overlays.map(stripOverlay),
    pdf: p.pdf,
    thumb: p.thumb
  };
  if (p.img){
    out.img = Object.assign({}, p.img);
    delete out.img.blob;
    if (p.img.blob){
      out.img.bytes = await p.img.blob.arrayBuffer();
      out.img.mime = p.img.blob.type || 'image/jpeg';
    }
  }
  return out;
}

/* คืน Blob ให้หน้าเอกสารหลังอ่านออกมาจาก IndexedDB */
function reviveImg(p){
  if (p.img && p.img.bytes && !p.img.blob){
    p.img.blob = new Blob([p.img.bytes], { type: p.img.mime || 'image/jpeg' });
    delete p.img.bytes;
  }
  return p;
}

let _wsSaveTimer = null;
function saveWorkspaceSoon(){
  clearTimeout(_wsSaveTimer);
  _wsSaveTimer = setTimeout(saveWorkspace, 500);
}

async function saveWorkspace(){
  try{
    const pages = await Promise.all(App.pages.map(stripPage));
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

/* กันค้าง: งานที่ "ไม่ยอมจบ" (pdf worker โหลดไม่ขึ้น / Image ไม่ยิง onload) จะ pending ตลอดไป
   try/catch ดักไม่ได้เพราะมันไม่ throw — ต้องตัดจบด้วยเวลาเอง ไม่งั้นสปินเนอร์ค้างจนกดอะไรไม่ได้ */
function withTimeout(promise, ms, fallback){
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise(res => setTimeout(() => res(fallback), ms))
  ]);
}

/* คืนค่า { restored, dropped } — restored = true ถ้ามีงานค้างให้กลับมาทำต่อ,
   dropped = จำนวนหน้าที่กู้ไม่สำเร็จเลยต้องทิ้ง (แจ้งผู้ใช้ต่อได้)         */
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
    if (!rec || !rec.pages || !rec.pages.length) return { restored: false, dropped: 0 };

    for (const [id, s] of Object.entries(rec.srcs || {})){
      try{
        const doc = await withTimeout(pdfjsLib.getDocument({ data: s.bytes.slice(0) }).promise, 8000, null);
        if (doc) App.srcs[id] = { bytes: s.bytes, doc };
      } catch(e){ console.error('restore pdf src', id, e); }
    }
    // หน้าที่อ้างอิงต้นทาง PDF ที่กู้ไม่สำเร็จ ต้องทิ้งไป ไม่งั้นเปิดไม่ได้
    // เช่นเดียวกับรูป — Blob ที่ผ่าน IndexedDB มาบางทีอ่านไม่ขึ้นอีกแล้ว (เจอ error
    // "reading the Blob argument to createImageBitmap") ต้องเช็คก่อนรับเข้า App.pages
    // ไม่งั้นเครื่องมือถัดไปที่ render หน้านี้ (ลายน้ำ/ลายเซ็น/ฯลฯ) จะพังหมด
    const kept = [];
    for (const p of rec.pages){
      if (p.kind === 'pdf'){ if (App.srcs[p.pdf.srcId]) kept.push(p); continue; }
      try{
        reviveImg(p);
        const bm = await withTimeout(blobToBitmap(p.img.blob), 4000, null);
        if (!bm) throw new Error('decode timeout');
        if (bm.close) bm.close();
        kept.push(p);
      }
      catch(e){ console.error('restore img blob', p.id, e); }
    }
    const dropped = rec.pages.length - kept.length;
    App.pages = kept;
    App.seq = Math.max(App.seq, rec.seq || 0);
    for (const p of App.pages)
      for (const o of p.overlays) await withTimeout(hydrateOverlay(o), 4000, null);
    return { restored: App.pages.length > 0, dropped };
  } catch(e){ console.error('loadWorkspace', e); return { restored: false, dropped: 0 }; }
}
