'use strict';
/* ============================================================
   DocKit — wiring
   ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

function segWire(id, fn){
  const box = $(id);
  if (!box) return;
  box.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    box.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    fn(b);
  });
}
function selectSeg(id, val){
  const box = $(id);
  if (!box) return;
  box.querySelectorAll('button').forEach(b => b.classList.toggle('on',
    b.dataset.l === val || b.dataset.k === val || b.dataset.mode === val ||
    b.dataset.s === val || b.dataset.p === val));
}
function swatchWire(id, fn){
  const box = $(id);
  if (!box) return;
  box.addEventListener('click', e => {
    const b = e.target.closest('.sw');
    if (!b || b.dataset.c === undefined) return;   // สวอตช์สีกำหนดเอง (custom color) จัดการแยกต่างหาก
    box.querySelectorAll('.sw').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    fn(b.dataset.c);
  });
}

let _openScanAfterImport = false;

async function boot(){
  /* ---------- navigation ---------- */
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) showView(b.dataset.v);
  });
  document.querySelectorAll('.back').forEach(b =>
    b.addEventListener('click', () => showView(b.dataset.back)));
  $('lnkAllPages').onclick = () => showView('pages');
  $('lnkHistory').onclick = () => showView('history');
  wireHistory();

  /* ---------- home tiles ---------- */
  // ผูกกับทั้งหน้าแรก ไม่ใช่แค่ .tools อันแรก เพราะตอนนี้มีสองกลุ่ม (เครื่องมือทั่วไป / เอกสารประจำตัว)
  $('view-home').addEventListener('click', e => {
    const t = e.target.closest('.tool-tile');
    if (!t) return;
    const k = t.dataset.tool;
    if (k === 'scan'){
      _openScanAfterImport = true;
      $('nfTitle').textContent = 'สแกนเอกสาร';
      $('nfWhat').textContent = 'ถ่ายรูปใหม่ หรือเลือกรูปที่มีอยู่แล้วมาแต่งก็ได้';
      $('needFiles').querySelector('[data-nf="pdf"]').style.display = 'none';
      $('needFiles').querySelector('[data-nf="hist"]').style.display = 'none';
      $('needFiles').classList.add('on');
    }
    else if (k === 'combine'){
      _openScanAfterImport = false;
      $('nfTitle').textContent = 'รวมไฟล์ PDF';
      $('nfWhat').textContent = 'เลือกไฟล์ที่จะรวม — จากเครื่องหรือจากไฟล์ที่เคยสร้างก็ได้';
      $('needFiles').querySelector('[data-nf="pdf"]').style.display = '';
      $('needFiles').querySelector('[data-nf="hist"]').style.display = '';
      $('needFiles').classList.add('on');
    }
    else if (k === 'redact'){ showView('redactPick'); }
    else showView(k);
  });
  $('needFiles').addEventListener('click', e => {
    // ถ้ามีหน้าเอกสารอยู่แล้ว (เปิดจากปุ่ม "เพิ่มหน้า" ในตัวเลือกหน้า ไม่ใช่บล็อกเพราะยังไม่มีอะไรเลย)
    // ปิดกล่องนี้แล้วอยู่หน้าเดิมต่อ ไม่ต้องเด้งกลับหน้าแรก
    const stay = App.pages.length > 0;
    const b = e.target.closest('[data-nf]');
    if (!b){ if (e.target.id === 'needFiles'){ $('needFiles').classList.remove('on'); if (!stay) showView('home'); } return; }
    const k = b.dataset.nf;
    $('needFiles').classList.remove('on');
    if (k === 'close'){ if (!stay) showView('home'); return; }
    if (k === 'hist'){ openHistPicker(); return; }
    $(k === 'cam' ? 'inCam' : k === 'img' ? 'inImg' : 'inPdf').click();
  });
  $('btnPickHist').onclick = openHistPicker;
  wireHistPicker();

  $('nextStep').addEventListener('click', e => {
    const act = e.target.closest('[data-ns-action]');
    if (act){
      $('nextStep').classList.remove('on');
      if (act.dataset.nsAction === 'scanMore'){ _openScanAfterImport = true; $('inCam').click(); }
      return;
    }
    const b = e.target.closest('[data-ns]');
    if (!b){ if (e.target.id === 'nextStep') $('nextStep').classList.remove('on'); return; }
    $('nextStep').classList.remove('on');
    if (b.dataset.ns !== 'stay') showView(b.dataset.ns);
  });

  $('recentList').addEventListener('click', e => {
    const r = e.target.closest('.row');
    if (!r) return;
    const p = App.pages.find(x => x.id === r.dataset.id);
    if (p && p.kind === 'img') openScan(p.id); else showView('pages');
  });

  /* ---------- import ---------- */
  // snapshot the FileList first: clearing the input mutates it live, and the
  // import handlers are async -> they would iterate an already-emptied list
  const imp = (el, fn) => $(el).addEventListener('change', e => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    const before = App.pages.length;
    fn(files).then(() => {
      const auto = _openScanAfterImport;
      _openScanAfterImport = false;
      if (auto && App.pages.length > before) openScan(App.pages[before].id);
      else if (App.view === 'home') renderHome();
      needFiles(App.view);      // ยกเลิกกล่องเลือกไฟล์ = กลับมาโชว์ใหม่ ไม่ปล่อยให้ค้างในเครื่องมือเปล่า
      if (App.view === 'wm') wmDraw();   // เพิ่งมีหน้าแรกระหว่างอยู่ในเครื่องมือลายน้ำ — รีเฟรชพรีวิว
    });
  });
  imp('inCam', addImageFiles);
  imp('inImg', addImageFiles);
  imp('inPdf', addPdfFiles);

  /* ---------- page ops ---------- */
  $('btnSelAll').onclick = () => { App.pages.forEach(p => App.sel.add(p.id)); renderGrid(); };
  $('btnSelNone').onclick = () => { App.sel.clear(); renderGrid(); };
  $('btnRot').onclick = rotateSelected;
  $('btnDel').onclick = deleteSelected;

  /* ---------- scan ---------- */
  segWire('modeSeg', b => { Scan.p.img.enh.mode = b.dataset.mode; commitCrop(); drawScan(); });
  const slDeb = (id, key) => {
    let t = null;
    $(id).addEventListener('input', e => {
      Scan.p.img.enh[key] = +e.target.value;
      clearTimeout(t); t = setTimeout(() => { commitCrop(); drawScan(); }, 180);
    });
  };
  slDeb('slBright', 'bright');
  slDeb('slContrast', 'contrast');

  $('btnCrop').onclick = () => { if (Scan.cropOn) commitCrop(); else Scan.cropOn = true; drawScan(); };
  $('btnCropReset').onclick = async () => {
    Scan.corners = null; Scan.p.img.crop = null; Scan.cropOn = false;
    await drawScan(); toast('ใช้ภาพเต็ม');
  };
  $('btnCropAuto').onclick = async () => {
    busy(true, 'กำลังหาขอบเอกสาร…');
    const cv = mkCanvas(Scan.bm.width, Scan.bm.height);
    cv.getContext('2d').drawImage(Scan.bm, 0, 0);
    const c = autoCorners(cv);
    busy(false);
    if (!c){ toast('หาขอบไม่เจอ ลองลากมุมเอง'); Scan.cropOn = true; await drawScan(); return; }
    Scan.corners = c; Scan.cropOn = true;
    await drawScan(); toast('เจอขอบแล้ว ปรับมุมได้');
  };
  $('btnScanRot').onclick = async () => {
    commitCrop();
    Scan.p.rotate = (Scan.p.rotate + 90) % 360;
    await drawScan();
  };
  $('btnScanDone').onclick = async () => {
    busy(true, 'กำลังบันทึก…');
    commitCrop();
    await refreshThumb(Scan.p);
    if (Scan.bm && Scan.bm.close) Scan.bm.close();
    Scan.bm = null;
    busy(false);
    renderGrid(); showView('pages');
    offerNextStep('บันทึกหน้านี้แล้ว', 'ทำอะไรต่อดี?', null,
      '<button class="btn primary" data-ns-action="scanMore">ถ่าย/เลือกเอกสารเพิ่ม</button>');
  };
  wireCropDrag();

  /* ---------- watermark ---------- */
  segWire('wmKind', b => {
    WM.kind = b.dataset.k;
    $('wmTextBox').style.display  = WM.kind === 'text'  ? '' : 'none';
    $('wmStampBox').style.display = WM.kind === 'stamp' ? '' : 'none';
    $('wmImgBox').style.display   = WM.kind === 'img'   ? '' : 'none';
    $('wmColorRow').style.display = WM.kind === 'img'   ? 'none' : '';
    // ตราคร่อมต้องอ่านออก ลายน้ำต้องจาง — สลับค่าตั้งต้นให้ตามโหมด
    if (WM.kind === 'stamp'){
      $('wmOpa').value = 92; $('wmRot').value = 0; $('wmSize').value = 90;
      selectSeg('wmLayout', 'center'); WM.layout = 'center';
    } else if (WM.kind === 'text'){
      $('wmOpa').value = 18; $('wmRot').value = 35; $('wmSize').value = 70;
    }
    wmDraw();
  });
  // wmDraw re-renders the full page (pdf.js pg.render() ต่อ 1 ครั้ง) ทุกครั้งที่เรียก —
  // ผูกตรงกับ 'input' ของช่องพิมพ์/สไลเดอร์จะยิงรัวหลายสิบครั้งต่อวินาทีจนคิว render
  // ของ pdf.js worker ล้น แอปเลยดูค้าง/หมุนตอนพิมพ์ลายน้ำหรือลากสไลเดอร์ —
  // ดีเบาท์เหมือนสไลเดอร์อื่นในแอป (slDeb ใน scan.js, phSl ใน photo.js)
  let _wmDrawT = null;
  const wmDrawDeb = () => { clearTimeout(_wmDrawT); _wmDrawT = setTimeout(wmDraw, 150); };
  $('wmText').addEventListener('input', wmDrawDeb);
  $('wmStampBox').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    $('wmStampText').value = b.dataset.preset.split('|').join('\n');
    wmDraw();
  });
  $('wmStampText').addEventListener('input', wmDrawDeb);
  $('wmStrike').addEventListener('change', wmDraw);
  segWire('wmLayout', b => { WM.layout = b.dataset.l; wmDraw(); });
  swatchWire('wmColorRow', c => { WM.color = c; wmDraw(); });
  ['wmSize', 'wmOpa', 'wmRot'].forEach(id => $(id).addEventListener('input', wmDrawDeb));
  $('wmFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const bm = await blobToBitmap(f);
    const sc = Math.min(1, 800 / Math.max(bm.width, bm.height));
    const cv = mkCanvas(bm.width * sc, bm.height * sc);
    cv.getContext('2d').drawImage(bm, 0, 0, cv.width, cv.height);
    WM.imgUrl = cv.toDataURL('image/png');
    WM.imgRatio = cv.width / cv.height;
    $('wmImgPrev').innerHTML = '<img src="' + WM.imgUrl + '">';
    wmDraw();
  });
  $('btnWmApply').onclick = applyWatermark;
  $('btnWmClear').onclick = () => { clearWatermark(); wmDraw(); };
  wmDraw();

  /* ---------- signature ---------- */
  initSigPad();
  loadSavedSignature();
  $('btnSigClear').onclick = clearSigPad;
  $('btnSigSave').onclick = saveSignature;
  $('sigFile').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) useSignatureFile(f);
  });
  $('btnSigPlace').onclick = startPlacement;
  wirePlaceBox();
  $('btnPlacePrev').onclick = () => placeNav(-1);
  $('btnPlaceNext').onclick = () => placeNav(1);
  $('btnPlaceDel').onclick = placeDelete;
  $('btnPlaceDone').onclick = placeDone;

  /* ---------- photo ID ---------- */
  buildPhotoSizeList();
  wirePhotoPan();
  photoDraw();
  const phImp = id => $(id).addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) photoLoad(f);
  });
  phImp('phCam'); phImp('phFile');
  swatchWire('phBgRow', c => { Photo.bg = c; photoDraw(); });
  $('phBgCustom').addEventListener('input', e => {
    Photo.bg = e.target.value;
    $('phBgRow').querySelectorAll('.sw').forEach(x => x.classList.remove('on'));
    $('phBgCustomLbl').classList.add('on');
    photoDraw();
  });
  $('phCut').addEventListener('change', e => { Photo.cut = e.target.checked; photoDraw(); });
  const phSl = (id, key, f) => {
    let t = null;
    $(id).addEventListener('input', e => {
      Photo[key] = f(+e.target.value);
      clearTimeout(t); t = setTimeout(photoDraw, 140);
    });
  };
  phSl('phTol', 'tol', v => v);
  phSl('phZoom', 'zoom', v => v / 100);
  $('phSize').addEventListener('change', e => {
    const s = PH_SIZES.find(x => x.id === e.target.value);
    if (s){ Photo.size = s; photoDraw(); }
  });
  $('phPaper').addEventListener('change', e => {
    if (e.target.name !== 'phpaper') return;
    Photo.paper = e.target.value;
    photoLayoutInfo();
  });
  const phCustom = () => {
    Photo.cw = +$('phCw').value; Photo.ch = +$('phCh').value;
    photoLayoutInfo();
  };
  $('phCw').addEventListener('input', phCustom);
  $('phCh').addEventListener('input', phCustom);
  $('phGuide').addEventListener('change', e => { Photo.guide = e.target.checked; });
  $('btnPhMake').onclick = photoMakePdf;

  /* ---------- ตัวเลือกหน้าในตัวเครื่องมือ ---------- */
  ['wmScopeSeg', 'exScopeSeg', 'sigScopeSeg', 'rdScopeSeg'].forEach(id => segWire(id, () => {
    renderPickers();
    if (id === 'wmScopeSeg') wmDraw();
  }));
  wirePickers();
  renderPickers();

  /* ---------- สำเนาบัตร ---------- */
  const idImp = (id, side) => $(id).addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) idLoad(side, f);
  });
  idImp('idFrontCam', 'front'); idImp('idFrontFile', 'front');
  idImp('idBackCam', 'back');   idImp('idBackFile', 'back');
  const idLines = () => { IdCard.lines = $('idLines').value.split(/\r?\n/).map(t => t.trim()); idDraw(); };
  $('idLines').addEventListener('input', idLines);
  $('view-idcard').addEventListener('click', e => {
    const b = e.target.closest('[data-idp]');
    if (!b) return;
    $('idLines').value = b.dataset.idp.split('|').join(String.fromCharCode(10));
    idLines();
  });
  $('idStamp').addEventListener('change', e => { IdCard.stamp = e.target.checked; idDraw(); });
  $('idStrike').addEventListener('change', e => { IdCard.strike = e.target.checked; idDraw(); });
  segWire('idPaper', b => { IdCard.paper = b.dataset.p; idDraw(); });
  $('idScale').addEventListener('input', e => { IdCard.scale = +e.target.value; idDraw(); });
  $('btnIdCropF').onclick = () => openIdCrop('front');
  $('btnIdCropB').onclick = () => openIdCrop('back');
  wireIdCrop();
  $('btnIdAuto').onclick = idCropAuto;
  $('btnIdFull').onclick = idCropFull;
  $('btnIdCropDone').onclick = idCropDone;
  $('btnIdMake').onclick = idMakePdf;
  idDraw();

  /* ---------- ปกปิดข้อมูล ---------- */
  $('btnRdStart').onclick = startRedact;
  wireRedactCanvas();
  $('btnRdPrev').onclick = () => redactNav(-1);
  $('btnRdNext').onclick = () => redactNav(1);
  $('btnRdDel').onclick = redactDeleteSel;
  $('rdFlat').onclick = redactFlatten;
  $('btnRdDone').onclick = redactDone;

  /* ---------- export ---------- */
  segWire('exSize', b => { Ex.size = b.dataset.s; });
  segWire('exQual', b => { Ex.qual = +b.dataset.q; });
  segWire('exRes', b => { Ex.maxPx = +b.dataset.r; });
  segWire('exNoPos', b => { Ex.noPos = b.dataset.pos; });
  segWire('exNoFmt', b => { Ex.noFmt = b.dataset.fmt; });
  $('exPageNo').addEventListener('change', e => { Ex.pageNo = e.target.checked; });
  $('exHeader').addEventListener('input', e => { Ex.header = e.target.value; });
  $('btnExport').onclick = doExport;

  busy(true, 'กำลังโหลดงานที่ค้างไว้…');
  const restored = await loadWorkspace();
  busy(false);
  renderGrid();
  renderHome();
  if (restored) toast('กู้คืนงานที่ค้างไว้แล้ว');

  // ไม่ลง service worker ตอนรันบน localhost — ระหว่างพัฒนามันเสิร์ฟไฟล์เก่า
  // จาก cache ทำให้แก้โค้ดแล้วไม่เห็นผล (เปิดผ่าน IP/โดเมนจริงยังลงปกติ)
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !isLocal){
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
