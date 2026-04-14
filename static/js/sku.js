(function () {
  var boot = window.SKU_BOOTSTRAP || {};
  var skuData = boot.sku || {};
  var skuId = String(skuData.sku || "");
  var isAdmin = Boolean(boot.isAdmin);

  var currentImages = Array.isArray(skuData.images) ? skuData.images.slice() : [];
  var pendingEntries = [];
  var pendingIndex = 0;

  var photosGrid       = document.getElementById("photosGrid");
  var photoCountChip   = document.getElementById("photoCountChip");
  var captionInput     = document.getElementById("captionInput");
  var takePhotoButton  = document.getElementById("takePhotoButton");
  var addMoreButton    = document.getElementById("addMoreButton");
  var finalizeButton   = document.getElementById("finalizeButton");
  var clearStagingButton = document.getElementById("clearStagingButton");
  var cameraInput      = document.getElementById("cameraInput");
  var galleryInput     = document.getElementById("galleryInput");
  var uploadTray       = document.getElementById("uploadTray");
  var photoHelp        = document.getElementById("photoHelp");
  var lightbox         = document.getElementById("imageLightbox");
  var lightboxImage    = document.getElementById("lightboxImage");
  var lightboxTitle    = document.getElementById("lightboxTitle");
  var lightboxText     = document.getElementById("lightboxText");
  var lightboxPrev     = document.getElementById("lightboxPrev");
  var lightboxNext     = document.getElementById("lightboxNext");
  var lightboxClose    = document.getElementById("lightboxClose");

  var lightboxImages = [];
  var lightboxIndex  = 0;

  // Notes refs
  var notesTextarea   = document.getElementById("notesTextarea");
  var notesSaveChip   = document.getElementById("notesSaveChip");
  var notesLastEdited = document.getElementById("notesLastEdited");
  var notesSaveTimer  = null;

  var PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='100%25' height='100%25' fill='%23eef3f9'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2361728a' font-size='13' font-family='Arial'%3ENo Photo%3C/text%3E%3C/svg%3E";
  var IMAGE_MAX_DIMENSION = 1600;
  var IMAGE_TARGET_BYTES  = 450000;
  var IMAGE_QUALITY_STEPS = [0.8, 0.72, 0.64, 0.56, 0.48, 0.4];

  // ── Helpers ──────────────────────────────────────────────────────────────

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatBytes(bytes) {
    var value = Number(bytes || 0);
    if (!value) return "0 B";
    var units = ["B", "KB", "MB", "GB"];
    var amount = value, i = 0;
    while (amount >= 1024 && i < units.length - 1) { amount /= 1024; i++; }
    return (amount >= 10 || i === 0 ? Math.round(amount) : amount.toFixed(1)) + " " + units[i];
  }

  // ── Image compression (mirrors catalogue.js) ─────────────────────────────

  function loadImageSource(file) {
    return new Promise(function (resolve, reject) {
      var img = new window.Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        resolve({
          width: img.naturalWidth,
          height: img.naturalHeight,
          draw: function (ctx) { ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight); },
          close: function () { URL.revokeObjectURL(url); }
        });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) { resolve(blob); }, type, quality);
    });
  }

  async function compressImageFile(file) {
    if (!file || !String(file.type || "").startsWith("image/")) return file;
    var source = null;
    try {
      source = await loadImageSource(file);
      var sw = Number(source.width || 0), sh = Number(source.height || 0);
      if (!sw || !sh) return file;
      var scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(sw, sh));
      var tw = Math.max(1, Math.round(sw * scale)), th = Math.max(1, Math.round(sh * scale));
      var canvas = document.createElement("canvas");
      canvas.width = tw; canvas.height = th;
      var ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) return file;
      source.draw(ctx);
      var baseName = file.name.replace(/\.[^.]+$/, "");
      var smallest = null;
      for (var _i = 0; _i < [["image/webp", ".webp"], ["image/jpeg", ".jpg"]].length; _i++) {
        var pair = [["image/webp", ".webp"], ["image/jpeg", ".jpg"]][_i];
        var mimeType = pair[0], ext = pair[1];
        for (var _j = 0; _j < IMAGE_QUALITY_STEPS.length; _j++) {
          var q = IMAGE_QUALITY_STEPS[_j];
          var blob = await canvasToBlob(canvas, mimeType, q);
          if (!blob || !blob.size || (mimeType === "image/webp" && blob.type !== "image/webp")) continue;
          if (!smallest || blob.size < smallest.blob.size) smallest = { blob: blob, ext: ext, type: blob.type || mimeType };
          if (blob.size <= IMAGE_TARGET_BYTES) break;
        }
      }
      if (!smallest || smallest.blob.size >= file.size) return file;
      return new File([smallest.blob], baseName + smallest.ext, { type: smallest.type, lastModified: file.lastModified });
    } catch (_) {
      return file;
    } finally {
      if (source && source.close) source.close();
    }
  }

  // ── Staging ───────────────────────────────────────────────────────────────

  async function stageImages(files) {
    var originalBytes = 0, compressedBytes = 0;
    var newEntries = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!(file instanceof File) || !file.size) continue;
      originalBytes += file.size;
      var prepared = await compressImageFile(file);
      compressedBytes += prepared.size;
      newEntries.push({
        id: Date.now() + "-" + (++pendingIndex),
        file: prepared,
        previewUrl: URL.createObjectURL(prepared)
      });
    }
    pendingEntries = pendingEntries.concat(newEntries);
    var savedBytes = Math.max(0, originalBytes - compressedBytes);
    var savedText = savedBytes > 0 ? " after saving " + formatBytes(savedBytes) : "";
    window.ItemTracker?.toast(pendingEntries.length + " staged photo" + (pendingEntries.length === 1 ? "" : "s") + " ready for " + skuId + savedText, "info");
    renderPage();
  }

  function removeStaged(fileId) {
    var removed = pendingEntries.filter(function (e) { return e.id === fileId; });
    removed.forEach(function (e) { if (e.previewUrl) URL.revokeObjectURL(e.previewUrl); });
    pendingEntries = pendingEntries.filter(function (e) { return e.id !== fileId; });
    renderPage();
  }

  function clearStaging() {
    pendingEntries.forEach(function (e) { if (e.previewUrl) URL.revokeObjectURL(e.previewUrl); });
    pendingEntries = [];
    renderPage();
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  async function uploadChunk(caption, entries) {
    var form = new FormData();
    form.append("sku", skuId);
    form.append("caption", caption || "");
    entries.forEach(function (e) { form.append("images", e.file, e.file.name); });
    var response = await fetch("/api/catalog/images", { method: "POST", body: form });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || "Could not upload image");
    return data;
  }

  // ── IndexedDB offline queue ───────────────────────────────────────────────

  var IDB_NAME = "itemtracker-queue";
  var IDB_STORE = "uploads";
  var _idbPromise = null;

  function openIDB() {
    if (!_idbPromise) {
      _idbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: "id", autoIncrement: true });
          }
        };
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    }
    return _idbPromise;
  }

  async function idbQueue(caption, entries) {
    var db = await openIDB();
    var files = entries.map(function (e) { return { file: e.file, name: e.file.name, type: e.file.type }; });
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, "readwrite");
      var req = tx.objectStore(IDB_STORE).add({ sku: skuId, caption: caption, files: files, timestamp: Date.now() });
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function idbGetAll() {
    var db = await openIDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, "readonly");
      var req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function idbRemove(id) {
    var db = await openIDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, "readwrite");
      var req = tx.objectStore(IDB_STORE).delete(id);
      req.onsuccess = function () { resolve(); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function flushQueue() {
    var queued;
    try { queued = await idbGetAll(); } catch (_) { return; }
    var mine = queued.filter(function (item) { return item.sku === skuId; });
    if (!mine.length) return;
    for (var i = 0; i < mine.length; i++) {
      var item = mine[i];
      try {
        var entries = item.files.map(function (f) {
          return { file: new File([f.file], f.name, { type: f.type }) };
        });
        for (var j = 0; j < entries.length; j += 6) {
          await uploadChunk(item.caption, entries.slice(j, j + 6));
        }
        await idbRemove(item.id);
        await refreshImages();
        window.ItemTracker?.toast(item.files.length + " photo" + (item.files.length === 1 ? "" : "s") + " added to " + skuId, "success");
      } catch (_) {
        // Leave in queue; retry next online event
      }
    }
  }

  async function finalizeUpload() {
    if (!pendingEntries.length) {
      window.ItemTracker?.toast("Take or add some photos first");
      return;
    }
    var caption = captionInput?.value || "";

    if (!navigator.onLine) {
      try {
        await idbQueue(caption, pendingEntries);
        clearStaging();
        window.ItemTracker?.toast(
          pendingEntries.length + " photo" + (pendingEntries.length === 1 ? "" : "s") + " queued for " + skuId + " — uploading when back online",
          "info"
        );
      } catch (_) {
        window.ItemTracker?.toast("Could not save photos for offline upload", "error");
      }
      return;
    }

    setUploading(true);
    var count = 0;
    try {
      var toUpload = pendingEntries.slice();
      for (var i = 0; i < toUpload.length; i += 6) {
        await uploadChunk(caption, toUpload.slice(i, i + 6));
        count += Math.min(6, toUpload.length - i);
      }
      clearStaging();
      await refreshImages();
      window.ItemTracker?.toast(count + " photo" + (count === 1 ? "" : "s") + " added to " + skuId, "success");
    } catch (err) {
      var isNetwork = err instanceof TypeError;
      var remaining = pendingEntries.slice(count);
      if (isNetwork && remaining.length) {
        try {
          await idbQueue(caption, remaining);
          clearStaging();
          var msg = count > 0
            ? count + " uploaded, " + remaining.length + " queued for " + skuId + " — connection lost"
            : remaining.length + " photo" + (remaining.length === 1 ? "" : "s") + " queued for " + skuId + " — uploading when back online";
          window.ItemTracker?.toast(msg, "info");
        } catch (_) {
          window.ItemTracker?.toast(err.message || "Could not upload — check your connection", "error");
        }
      } else {
        window.ItemTracker?.toast(err.message || "Could not upload image", "error");
      }
    } finally {
      setUploading(false);
    }
  }

  // ── Refresh images from server after upload ───────────────────────────────

  async function refreshImages() {
    try {
      var response = await fetch("/api/catalog/sku/" + encodeURIComponent(skuId), { cache: "no-store" });
      var data = await response.json().catch(function () { return {}; });
      if (data.ok && data.sku) {
        currentImages = Array.isArray(data.sku.images) ? data.sku.images : [];
        renderPhotos();
      }
    } catch (_) {}
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderPhotos() {
    if (!photosGrid) return;
    if (photoCountChip) {
      photoCountChip.textContent = currentImages.length + " photo" + (currentImages.length === 1 ? "" : "s");
    }
    if (!currentImages.length) {
      photosGrid.innerHTML =
        '<div class="photo-card">' +
          '<img alt="No photo" src="' + PLACEHOLDER + '">' +
          '<span>Add the first photo</span>' +
        '</div>';
      return;
    }
    photosGrid.innerHTML = currentImages.map(function (image, index) {
      var isPending = Boolean(image.pending_deletion);
      return (
        '<div class="sku-photo-wrap' + (isPending ? ' sku-photo-wrap--pending" title="Deletion pending admin review' : '"') + '">' +
          '<button type="button" class="photo-card photo-card--button sku-photo-btn" data-index="' + index + '"' + (isPending ? ' disabled' : '') + '>' +
            '<img src="' + escapeHtml(image.url || "") + '" alt="' + escapeHtml(skuId + " photo " + (index + 1)) + '">' +
            '<span>' + escapeHtml(image.caption || ("Photo " + (index + 1))) + '</span>' +
          '</button>' +
          (isPending
            ? '<div class="sku-photo-pending-badge">Pending deletion</div>'
            : '<button type="button" class="sku-photo-delete-btn" data-image-id="' + escapeHtml(image.id) + '" data-image-url="' + escapeHtml(image.url || "") + '" data-image-caption="' + escapeHtml(image.caption || "") + '" aria-label="Request deletion">&#128465;</button>'
          ) +
        '</div>'
      );
    }).join("");

    photosGrid.querySelectorAll(".sku-photo-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        openLightbox(Number(btn.dataset.index || 0));
      });
    });

    photosGrid.querySelectorAll(".sku-photo-delete-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        handleRequestDeletion(btn.dataset.imageId, btn.dataset.imageUrl, btn.dataset.imageCaption);
      });
    });
  }

  async function handleRequestDeletion(imageId, imageUrl, imageCaption) {
    if (!imageId) return;
    if (!confirm("Request deletion of this photo?\n\nAn admin will review the request before it is removed.")) return;
    try {
      var response = await fetch("/api/catalog/images/" + encodeURIComponent(imageId) + "/request-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: skuId, imageUrl: imageUrl, imageCaption: imageCaption })
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || "Could not request deletion");
      // Mark image as pending locally so the UI updates immediately
      currentImages = currentImages.map(function (img) {
        return img.id === imageId ? Object.assign({}, img, { pending_deletion: true }) : img;
      });
      renderPhotos();
      window.ItemTracker?.toast("Deletion request submitted — awaiting admin review", "info");
    } catch (err) {
      window.ItemTracker?.toast(err.message || "Could not request deletion", "error");
    }
  }

  function renderTray() {
    if (!uploadTray) return;
    if (!pendingEntries.length) {
      uploadTray.hidden = true;
      uploadTray.innerHTML = "";
      return;
    }
    uploadTray.hidden = false;
    uploadTray.innerHTML =
      '<div class="upload-tray">' +
        '<div class="upload-tray__head">' +
          '<strong>' + pendingEntries.length + ' photo' + (pendingEntries.length === 1 ? "" : "s") + ' staged for upload</strong>' +
          '<span>Take another photo or finalise when ready.</span>' +
        '</div>' +
        '<div class="queued-grid">' +
          pendingEntries.map(function (entry) {
            return (
              '<div class="queued-photo">' +
                '<button type="button" class="queued-photo__remove staged-remove-btn" data-id="' + escapeHtml(entry.id) + '" aria-label="Remove staged photo">x</button>' +
                '<img src="' + escapeHtml(entry.previewUrl) + '" alt="Staged upload">' +
              '</div>'
            );
          }).join("") +
        '</div>' +
      '</div>';
    uploadTray.querySelectorAll(".staged-remove-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { removeStaged(btn.dataset.id || ""); });
    });
  }

  function renderPage() {
    renderPhotos();
    renderTray();
    var hasPending = pendingEntries.length > 0;
    if (finalizeButton)    finalizeButton.disabled    = !hasPending;
    if (clearStagingButton) clearStagingButton.disabled = !hasPending;
    if (photoHelp) {
      photoHelp.textContent = hasPending
        ? "Your staged photos are shown above. Use Take Photo or Add More to keep building the batch, then press Finalize Upload."
        : "Take a photo to start a staging tray for this SKU. Nothing uploads until you press Finalize Upload.";
    }
  }

  function setUploading(active) {
    var btns = [finalizeButton, clearStagingButton, takePhotoButton, addMoreButton];
    btns.forEach(function (btn) {
      if (btn) {
        btn.disabled = active;
        btn.style.opacity = active ? "0.65" : "";
      }
    });
  }

  // ── Lightbox ──────────────────────────────────────────────────────────────

  function syncLightbox() {
    var image = lightboxImages[lightboxIndex];
    if (!image) { closeLightbox(); return; }
    if (lightboxImage) {
      lightboxImage.src = image.url || "";
      lightboxImage.alt = skuId + " photo " + (lightboxIndex + 1);
    }
    if (lightboxTitle) lightboxTitle.textContent = skuId + " | " + (lightboxIndex + 1) + " of " + lightboxImages.length;
    if (lightboxText)  lightboxText.textContent  = image.caption || "Shared catalogue reference photo";
    if (lightboxPrev)  lightboxPrev.disabled  = lightboxImages.length <= 1 || lightboxIndex <= 0;
    if (lightboxNext)  lightboxNext.disabled  = lightboxImages.length <= 1 || lightboxIndex >= lightboxImages.length - 1;
  }

  function openLightbox(index) {
    if (!currentImages.length || !lightbox) return;
    lightboxImages = currentImages.filter(function (img) { return img?.url; });
    lightboxIndex  = Math.max(0, Math.min(lightboxImages.length - 1, Number(index || 0)));
    syncLightbox();
    lightbox.hidden = false;
    document.body.classList.add("lightbox-open");
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    document.body.classList.remove("lightbox-open");
    lightboxImages = [];
    lightboxIndex  = 0;
    if (lightboxImage) { lightboxImage.src = ""; lightboxImage.alt = ""; }
  }

  function moveLightbox(step) {
    var next = lightboxIndex + step;
    if (next < 0 || next >= lightboxImages.length) return;
    lightboxIndex = next;
    syncLightbox();
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  function showNotesLastEdited(noteRecord) {
    if (!notesLastEdited) return;
    if (!noteRecord || !noteRecord.updated) { notesLastEdited.hidden = true; return; }
    var who = noteRecord.updated_by_name || noteRecord.updated_by || "";
    var when = new Date(noteRecord.updated);
    var whenStr = isNaN(when.getTime()) ? String(noteRecord.updated) :
      when.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + " " +
      when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    notesLastEdited.textContent = "Last edited" + (who ? " by " + who : "") + " · " + whenStr;
    notesLastEdited.hidden = false;
  }

  async function loadNotes() {
    if (!notesTextarea) return;
    try {
      var response = await fetch("/api/catalog/sku/" + encodeURIComponent(skuId) + "/notes", { cache: "no-store" });
      var data = await response.json().catch(function () { return {}; });
      if (data.ok && data.notes) {
        notesTextarea.value = data.notes.notes || "";
        showNotesLastEdited(data.notes);
      }
    } catch (_) {}
  }

  async function saveNotes() {
    if (!notesTextarea) return;
    var text = notesTextarea.value;
    try {
      var response = await fetch("/api/catalog/sku/" + encodeURIComponent(skuId) + "/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: text })
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || "Could not save notes");
      if (notesSaveChip) {
        notesSaveChip.hidden = false;
        setTimeout(function () { if (notesSaveChip) notesSaveChip.hidden = true; }, 2500);
      }
      if (data.notes) showNotesLastEdited(data.notes);
    } catch (_) {}
  }

  function scheduleNotesSave() {
    if (notesSaveTimer) clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(saveNotes, 2000);
  }

  if (notesTextarea) {
    notesTextarea.addEventListener("input", scheduleNotesSave);
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  if (takePhotoButton)   takePhotoButton.addEventListener("click",  function () { cameraInput?.click(); });
  if (addMoreButton)     addMoreButton.addEventListener("click",    function () { galleryInput?.click(); });
  if (finalizeButton)    finalizeButton.addEventListener("click",   finalizeUpload);
  if (clearStagingButton) clearStagingButton.addEventListener("click", clearStaging);

  if (cameraInput) {
    cameraInput.addEventListener("change", async function () {
      if (!cameraInput.files?.length) return;
      await stageImages(Array.from(cameraInput.files));
      cameraInput.value = "";
    });
  }

  if (galleryInput) {
    galleryInput.addEventListener("change", async function () {
      if (!galleryInput.files?.length) return;
      await stageImages(Array.from(galleryInput.files));
      galleryInput.value = "";
    });
  }

  if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
  if (lightboxPrev)  lightboxPrev.addEventListener("click",  function () { moveLightbox(-1); });
  if (lightboxNext)  lightboxNext.addEventListener("click",  function () { moveLightbox(1); });
  if (lightbox) {
    lightbox.addEventListener("click", function (e) { if (e.target === lightbox) closeLightbox(); });
  }

  document.addEventListener("keydown", function (e) {
    if (lightbox?.hidden === false) {
      if (e.key === "Escape")     closeLightbox();
      if (e.key === "ArrowLeft")  moveLightbox(-1);
      if (e.key === "ArrowRight") moveLightbox(1);
    }
  });

  // ── Offline banner sync ───────────────────────────────────────────────────

  var offlineBanner = document.getElementById("offlineBanner");
  function syncOfflineBanner() {
    if (offlineBanner) offlineBanner.hidden = navigator.onLine;
  }
  window.addEventListener("online", function () {
    syncOfflineBanner();
    flushQueue();
  });
  window.addEventListener("offline", syncOfflineBanner);
  syncOfflineBanner();

  // ── Init ──────────────────────────────────────────────────────────────────

  renderPage();
  loadNotes();

  if (navigator.onLine) {
    setTimeout(flushQueue, 1200);
  }

})();
