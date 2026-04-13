(function () {
  const boot = window.ITEMTRACKER_BOOTSTRAP || {};
  const currentUser = boot.currentUser || null;
  const maxResults = Number(boot.maxResults || 60);
  let catalogMeta = boot.catalogMeta || {};
  let latestRows = [];
  const pendingUploads = new Map();
  const captionDrafts = new Map();
  let pendingUploadIndex = 0;
  let lightboxImages = [];
  let lightboxIndex = 0;
  let lightboxSku = "";

  const resultsGrid = document.getElementById("resultsGrid");
  const emptyState = document.getElementById("emptyState");
  const skuInput = document.getElementById("catalogSkuQuery");
  const descOneInput = document.getElementById("catalogDescOne");
  const descTwoInput = document.getElementById("catalogDescTwo");
  const descThreeInput = document.getElementById("catalogDescThree");
  const searchButton = document.getElementById("searchButton");
  const clearButton = document.getElementById("clearButton");
  const hasImagesOnlyInput = document.getElementById("hasImagesOnly");
  const warehouseActiveOnlyInput = document.getElementById("warehouseActiveOnly");
  const scanBarcodeButton = document.getElementById("scanBarcodeButton");
  const resultCountChip = document.getElementById("resultCountChip");
  const metaSourceChip = document.getElementById("metaSourceChip");
  const metaCountChip = document.getElementById("metaCountChip");
  const metaImportedChip = document.getElementById("metaImportedChip");
  const importForm = document.getElementById("importForm");
  const importStatusChip = document.getElementById("importStatusChip");
  const summaryGrid = document.getElementById("summaryGrid");
  const capturedSkuMetric = document.getElementById("capturedSkuMetric");
  const capturedSkuMetricNote = document.getElementById("capturedSkuMetricNote");
  const itemfileCoverageMetric = document.getElementById("itemfileCoverageMetric");
  const itemfileCoverageMetricNote = document.getElementById("itemfileCoverageMetricNote");
  const warehouseCoverageMetric = document.getElementById("warehouseCoverageMetric");
  const warehouseCoverageMetricNote = document.getElementById("warehouseCoverageMetricNote");
  const warehouseSnapshotMetric = document.getElementById("warehouseSnapshotMetric");
  const warehouseSnapshotMetricNote = document.getElementById("warehouseSnapshotMetricNote");
  const lightbox = document.getElementById("imageLightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxTitle = document.getElementById("lightboxTitle");
  const lightboxText = document.getElementById("lightboxText");
  const lightboxPrev = document.getElementById("lightboxPrev");
  const lightboxNext = document.getElementById("lightboxNext");
  const lightboxClose = document.getElementById("lightboxClose");
  const scannerModal = document.getElementById("barcodeScanner");
  const scannerCloseButton = document.getElementById("scannerCloseButton");
  const scannerVideo = document.getElementById("scannerVideo");
  const scannerFallbackRegion = document.getElementById("scannerFallbackRegion");
  const scannerStatus = document.getElementById("scannerStatus");

  const PLACEHOLDER_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='100%25' height='100%25' fill='%23eef3f9'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2361728a' font-size='13' font-family='Arial'%3ENo Photo%3C/text%3E%3C/svg%3E";
  const IMAGE_MAX_DIMENSION = 1600;
  const IMAGE_TARGET_BYTES = 450000;
  const IMAGE_QUALITY_STEPS = [0.8, 0.72, 0.64, 0.56, 0.48, 0.4];
  const FALLBACK_SCANNER_SCRIPT = "/static/vendor/html5-qrcode.min.js";
  let scannerStream = null;
  let scannerDetector = null;
  let scannerFrameHandle = 0;
  let scannerActive = false;
  let scannerBusy = false;
  let scannerFallbackInstance = null;
  let scannerScriptPromise = null;
  let scannerMode = "";

  function setMeta(meta) {
    catalogMeta = meta || {};
    if (metaSourceChip) metaSourceChip.textContent = `Source: ${catalogMeta.source || "none"}`;
    if (metaCountChip) metaCountChip.textContent = `${Number(catalogMeta.row_count || 0).toLocaleString()} items`;
    if (metaImportedChip) metaImportedChip.textContent = catalogMeta.imported_at ? `Imported ${catalogMeta.imported_at}` : "No import yet";
  }

  function catalogReady() {
    return Boolean(
      catalogMeta?.available ||
      Number(catalogMeta?.row_count || 0) ||
      (catalogMeta?.source && !["none", "error"].includes(String(catalogMeta.source)))
    );
  }

  function setEmptyState(title, subtitle, visible = true) {
    if (!emptyState) return;
    emptyState.hidden = !visible;
    if (!visible) return;
    emptyState.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span>`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let amount = value;
    let unitIndex = 0;
    while (amount >= 1024 && unitIndex < units.length - 1) {
      amount /= 1024;
      unitIndex += 1;
    }
    const decimals = amount >= 10 || unitIndex === 0 ? 0 : 1;
    return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
  }

  function normalizeBarcode(value) {
    const text = String(value || "").trim();
    return /\d/.test(text) ? text : "";
  }

  function barcodeList(row) {
    const values = [];
    const seen = new Set();
    [row?.barcode, ...(Array.isArray(row?.barcodes) ? row.barcodes : [])].forEach((value) => {
      const text = normalizeBarcode(value);
      if (!text || seen.has(text)) {
        return;
      }
      seen.add(text);
      values.push(text);
    });
    return values;
  }

  function canUseBarcodeScanner() {
    return Boolean(window.BarcodeDetector && navigator.mediaDevices?.getUserMedia);
  }

  async function ensureFallbackScannerLibrary() {
    if (window.Html5Qrcode) {
      return window.Html5Qrcode;
    }
    if (scannerScriptPromise) {
      return scannerScriptPromise;
    }
    scannerScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = FALLBACK_SCANNER_SCRIPT;
      script.async = true;
      script.onload = () => resolve(window.Html5Qrcode);
      script.onerror = () => reject(new Error("Could not load the mobile barcode scanner library."));
      document.head.appendChild(script);
    });
    return scannerScriptPromise;
  }

  function getSearchState() {
    const sku = String(skuInput?.value || "").trim();
    const terms = [
      String(descOneInput?.value || "").trim(),
      String(descTwoInput?.value || "").trim(),
      String(descThreeInput?.value || "").trim()
    ].filter(Boolean);
    const hasImagesOnly = Boolean(hasImagesOnlyInput?.checked);
    const warehouseActiveOnly = Boolean(warehouseActiveOnlyInput?.checked);
    return {
      sku,
      terms,
      hasImagesOnly,
      warehouseActiveOnly,
      hasFilters: Boolean(sku || terms.length || hasImagesOnly || warehouseActiveOnly)
    };
  }

  function applySummary(summary) {
    const data = summary || {};
    if (capturedSkuMetric) {
      capturedSkuMetric.textContent = Number(data.captured_sku_count || 0).toLocaleString();
    }
    if (capturedSkuMetricNote) {
      capturedSkuMetricNote.textContent = `${Number(data.image_record_count || 0).toLocaleString()} uploaded photo${Number(data.image_record_count || 0) === 1 ? "" : "s"} across the shared catalogue`;
    }
    if (itemfileCoverageMetric) {
      itemfileCoverageMetric.textContent = `${Number(data.captured_vs_itemfile_percent || 0).toFixed(1)}%`;
    }
    if (itemfileCoverageMetricNote) {
      itemfileCoverageMetricNote.textContent = `${Number(data.captured_itemfile_sku_count || 0).toLocaleString()} / ${Number(data.itemfile_sku_count || 0).toLocaleString()} SKUs from the shared item file`;
    }
    if (warehouseCoverageMetric) {
      warehouseCoverageMetric.textContent = `${Number(data.captured_vs_warehouse_percent || 0).toFixed(1)}%`;
    }
    if (warehouseCoverageMetricNote) {
      warehouseCoverageMetricNote.textContent = `${Number(data.captured_active_sku_count || 0).toLocaleString()} / ${Number(data.warehouse_active_sku_count || 0).toLocaleString()} active warehouse SKUs captured`;
    }
    if (warehouseSnapshotMetric) {
      warehouseSnapshotMetric.textContent = data.warehouse_snapshot_date || "Not synced";
    }
    if (warehouseSnapshotMetricNote) {
      warehouseSnapshotMetricNote.textContent = data.warehouse_uploaded_at
        ? `Latest PI-App warehouse upload at ${data.warehouse_uploaded_at}`
        : "Waiting for the latest PI-App warehouse upload";
    }
  }

  function canLoadSummary() {
    return Boolean(currentUser?.isAdmin && summaryGrid);
  }

  async function refreshSummary() {
    if (!canLoadSummary()) {
      return;
    }
    try {
      const response = await fetch("/api/catalog/summary", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not load metrics");
      }
      applySummary(data.summary || {});
    } catch (error) {
      if (warehouseSnapshotMetric) {
        warehouseSnapshotMetric.textContent = "Unavailable";
      }
      if (warehouseSnapshotMetricNote) {
        warehouseSnapshotMetricNote.textContent = error.message || "Could not load shared metrics";
      }
    }
  }

  function getPendingEntries(sku) {
    return pendingUploads.get(String(sku || "")) || [];
  }

  function getCaptionDraft(sku) {
    return captionDrafts.get(String(sku || "")) || "";
  }

  function setCaptionDraft(sku, value) {
    const key = String(sku || "");
    const text = String(value || "");
    if (text) {
      captionDrafts.set(key, text);
    } else {
      captionDrafts.delete(key);
    }
  }

  function releaseEntries(entries) {
    (entries || []).forEach((entry) => {
      if (entry?.previewUrl) {
        URL.revokeObjectURL(entry.previewUrl);
      }
    });
  }

  function replacePendingEntries(sku, entries) {
    const key = String(sku || "");
    if (entries?.length) {
      pendingUploads.set(key, entries);
    } else {
      pendingUploads.delete(key);
    }
  }

  function clearPendingEntries(sku) {
    const key = String(sku || "");
    releaseEntries(getPendingEntries(key));
    pendingUploads.delete(key);
  }

  function getRowForSku(sku) {
    return latestRows.find((row) => String(row?.sku || "") === String(sku || ""));
  }

  function renderRows(rows) {
    latestRows = Array.isArray(rows) ? rows : [];
    if (resultCountChip) {
      resultCountChip.textContent = `${latestRows.length} matches`;
    }

    if (!latestRows.length) {
      resultsGrid.innerHTML = "";
      const searchState = getSearchState();
      if (!catalogReady()) {
        setEmptyState(
          "No shared catalogue imported yet",
          currentUser?.isAdmin
            ? "Upload a workbook above to publish the shared catalogue."
            : "Ask an admin to upload the workbook first."
        );
        return;
      }
      setEmptyState(
        searchState.hasFilters ? "No matching items found" : "Search to load catalogue items",
        searchState.hasFilters
          ? "Try different SKU text or change one of the description filters."
          : "Use one filter or stack several together to narrow the results."
      );
      return;
    }

    setEmptyState("", "", false);
    resultsGrid.innerHTML = latestRows
      .map((row) => {
        const images = Array.isArray(row.images) ? row.images : [];
        const queued = getPendingEntries(row.sku);
        const safeSku = escapeHtml(row.sku);
        const barcodes = barcodeList(row);
        const matchedBarcodes = Array.isArray(row.matched_barcodes)
          ? row.matched_barcodes.map((value) => normalizeBarcode(value)).filter(Boolean)
          : [];
        const badges = [
          row.active ? "Active" : "Inactive",
          matchedBarcodes.length ? `Matched barcode ${matchedBarcodes[0]}` : "",
          barcodes.length > 1 ? `${barcodes.length} barcodes` : "",
          barcodes.length === 1 ? `Barcode ${barcodes[0]}` : "",
          row.size ? `Size ${row.size}` : "",
          row.color ? `Color ${row.color}` : "",
          row.warehouse_active ? "Active in warehouse" : "",
          `${images.length} photo${images.length === 1 ? "" : "s"}`
        ].filter(Boolean);
        const barcodeLine = barcodes.length
          ? `<p class="result-card__barcode-line"><strong>Known barcodes:</strong> ${escapeHtml(barcodes.slice(0, 4).join(" | "))}${barcodes.length > 4 ? ` <span>+${barcodes.length - 4} more</span>` : ""}</p>`
          : "";
        return `
          <article class="result-card" data-sku="${safeSku}">
            <div class="result-card__head">
              <div>
                <p class="eyebrow">SKU</p>
                <h3>${safeSku}</h3>
                <p>${escapeHtml(row.description || row.description_short || "")}</p>
                ${barcodeLine}
              </div>
              <span class="chip">${images.length} refs</span>
            </div>
            <div class="result-badges">
              ${badges.map((badge) => `<span class="result-badge">${escapeHtml(badge)}</span>`).join("")}
            </div>
            <div class="photo-grid">
              ${
                images.length
                  ? images
                      .map(
                        (image, index) => `
                          <button type="button" class="photo-card photo-card--button" data-sku="${safeSku}" data-image-index="${index}">
                            <img src="${escapeHtml(image.url || "")}" alt="${safeSku} reference ${index + 1}">
                            <span>${escapeHtml(image.caption || `View photo ${index + 1}`)}</span>
                          </button>
                        `
                      )
                      .join("")
                  : `
                    <div class="photo-card">
                      <img alt="No photo" src="${PLACEHOLDER_IMAGE}">
                      <span>Add the first photo</span>
                    </div>
                  `
              }
            </div>
            <div class="upload-box">
              <div class="upload-row upload-row--stacked">
                <input type="text" class="caption-input" data-sku="${safeSku}" value="${escapeHtml(getCaptionDraft(row.sku))}" placeholder="Optional caption for this batch">
                <div class="upload-actions">
                  <button type="button" class="upload-action-button take-photo-button" data-sku="${safeSku}">Take Photo</button>
                  <button type="button" class="ghost-button upload-action-button add-more-button" data-sku="${safeSku}">Add More</button>
                  <button type="button" class="upload-action-button finalize-upload-button" data-sku="${safeSku}" ${queued.length ? "" : "disabled"}>Finalize Upload</button>
                  <button type="button" class="ghost-button upload-action-button queue-clear-button" data-sku="${safeSku}" ${queued.length ? "" : "disabled"}>Clear</button>
                </div>
                <input type="file" class="camera-input" accept="image/*" capture="environment">
                <input type="file" class="gallery-input" accept="image/*" multiple>
              </div>
              ${
                queued.length
                  ? `
                    <div class="upload-tray">
                      <div class="upload-tray__head">
                        <strong>${queued.length} photo${queued.length === 1 ? "" : "s"} staged for upload</strong>
                        <span>Take another photo or finalise when ready.</span>
                      </div>
                      <div class="queued-grid">
                        ${queued
                          .map(
                            (entry) => `
                              <div class="queued-photo">
                                <button type="button" class="queued-photo__remove" data-sku="${safeSku}" data-file-id="${escapeHtml(entry.id)}" aria-label="Remove staged photo">x</button>
                                <img src="${escapeHtml(entry.previewUrl)}" alt="Staged upload for ${safeSku}">
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                    </div>
                  `
                  : ""
              }
              <p class="photo-help">
                ${
                  queued.length
                    ? "This card now holds your staged photos. Use Take Photo or Add More to keep building the batch, then press Finalize Upload."
                    : "Take a photo to start a staging tray for this SKU. Nothing uploads until you press Finalize Upload."
                }
              </p>
            </div>
          </article>
        `;
      })
      .join("");

    resultsGrid.querySelectorAll(".photo-card--button").forEach((button) => {
      button.addEventListener("click", () => {
        openImageLightbox(button.dataset.sku || "", Number(button.dataset.imageIndex || 0));
      });
    });

    resultsGrid.querySelectorAll(".caption-input").forEach((input) => {
      input.addEventListener("input", () => {
        setCaptionDraft(input.dataset.sku || "", input.value || "");
      });
    });

    resultsGrid.querySelectorAll(".take-photo-button").forEach((button) => {
      button.addEventListener("click", () => {
        button.closest(".result-card")?.querySelector(".camera-input")?.click();
      });
    });

    resultsGrid.querySelectorAll(".add-more-button").forEach((button) => {
      button.addEventListener("click", () => {
        button.closest(".result-card")?.querySelector(".gallery-input")?.click();
      });
    });

    resultsGrid.querySelectorAll(".camera-input, .gallery-input").forEach((input) => {
      input.addEventListener("change", async () => {
        const card = input.closest(".result-card");
        const sku = card?.dataset?.sku || "";
        if (!sku || !input.files?.length) return;
        await stageImages(sku, input.files);
        input.value = "";
      });
    });

    resultsGrid.querySelectorAll(".finalize-upload-button").forEach((button) => {
      button.addEventListener("click", async () => {
        const card = button.closest(".result-card");
        const sku = button.dataset.sku || "";
        if (!card || !sku) return;
        await uploadQueuedImages(card, sku);
      });
    });

    resultsGrid.querySelectorAll(".queue-clear-button").forEach((button) => {
      button.addEventListener("click", () => {
        const sku = button.dataset.sku || "";
        if (!sku) return;
        clearPendingEntries(sku);
        renderRows(latestRows);
      });
    });

    resultsGrid.querySelectorAll(".queued-photo__remove").forEach((button) => {
      button.addEventListener("click", () => {
        const sku = button.dataset.sku || "";
        const fileId = button.dataset.fileId || "";
        if (!sku || !fileId) return;
        removeQueuedImage(sku, fileId);
      });
    });
  }

  function updateLightboxControls() {
    if (!lightboxPrev || !lightboxNext) return;
    const disabled = lightboxImages.length <= 1;
    lightboxPrev.disabled = disabled || lightboxIndex <= 0;
    lightboxNext.disabled = disabled || lightboxIndex >= lightboxImages.length - 1;
  }

  function syncLightbox() {
    const image = lightboxImages[lightboxIndex];
    if (!image || !lightboxImage || !lightboxTitle || !lightboxText) {
      closeImageLightbox();
      return;
    }
    lightboxImage.src = image.url || "";
    lightboxImage.alt = `${lightboxSku} image ${lightboxIndex + 1}`;
    lightboxTitle.textContent = `${lightboxSku} | ${lightboxIndex + 1} of ${lightboxImages.length}`;
    lightboxText.textContent = image.caption || "Shared catalogue reference photo";
    updateLightboxControls();
  }

  function openImageLightbox(sku, index) {
    const row = getRowForSku(sku);
    const images = Array.isArray(row?.images) ? row.images.filter((image) => image?.url) : [];
    if (!images.length || !lightbox) return;
    lightboxSku = sku;
    lightboxImages = images;
    lightboxIndex = Math.max(0, Math.min(images.length - 1, Number(index || 0)));
    syncLightbox();
    lightbox.hidden = false;
    document.body.classList.add("lightbox-open");
  }

  function closeImageLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    document.body.classList.remove("lightbox-open");
    lightboxImages = [];
    lightboxIndex = 0;
    lightboxSku = "";
    if (lightboxImage) {
      lightboxImage.src = "";
      lightboxImage.alt = "";
    }
  }

  function moveLightbox(step) {
    const nextIndex = lightboxIndex + step;
    if (nextIndex < 0 || nextIndex >= lightboxImages.length) {
      return;
    }
    lightboxIndex = nextIndex;
    syncLightbox();
  }

  function stopScannerLoop() {
    scannerActive = false;
    scannerBusy = false;
    if (scannerFrameHandle) {
      window.cancelAnimationFrame(scannerFrameHandle);
      scannerFrameHandle = 0;
    }
  }

  function stopScannerStream() {
    if (scannerStream) {
      scannerStream.getTracks().forEach((track) => track.stop());
      scannerStream = null;
    }
    if (scannerVideo) {
      scannerVideo.pause();
      scannerVideo.srcObject = null;
      scannerVideo.hidden = false;
    }
    if (scannerFallbackRegion) {
      scannerFallbackRegion.hidden = true;
      scannerFallbackRegion.innerHTML = "";
    }
  }

  async function stopFallbackScanner() {
    const instance = scannerFallbackInstance;
    scannerFallbackInstance = null;
    if (!instance) {
      return;
    }
    try {
      await instance.stop();
    } catch (error) {
      // ignore stop failures when scanner never fully started
    }
    try {
      await instance.clear();
    } catch (error) {
      // ignore clear failures during teardown
    }
  }

  async function closeScannerModal() {
    stopScannerLoop();
    stopScannerStream();
    await stopFallbackScanner();
    scannerMode = "";
    if (scannerModal) {
      scannerModal.hidden = true;
    }
    document.body.classList.remove("scanner-open");
    if (scannerStatus) {
      scannerStatus.textContent = "Point the camera at a barcode to search the shared catalogue.";
    }
  }

  async function buildBarcodeDetector() {
    if (!window.BarcodeDetector) {
      throw new Error("Barcode scanning is not supported in this browser.");
    }
    let formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "codabar"];
    if (typeof window.BarcodeDetector.getSupportedFormats === "function") {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const filtered = formats.filter((format) => supported.includes(format));
      if (filtered.length) {
        formats = filtered;
      }
    }
    return new window.BarcodeDetector({ formats });
  }

  async function handleDetectedBarcode(rawValue) {
    const barcode = normalizeBarcode(rawValue) || String(rawValue || "").trim();
    if (!barcode) {
      return;
    }
    if (scannerStatus) {
      scannerStatus.textContent = `Scanned ${barcode}. Searching...`;
    }
    if (skuInput) {
      skuInput.value = barcode;
    }
    await closeScannerModal();
    await searchCatalog();
  }

  async function scanBarcodeFrame() {
    if (!scannerActive || !scannerVideo || !scannerDetector) {
      return;
    }
    if (scannerBusy) {
      scannerFrameHandle = window.requestAnimationFrame(scanBarcodeFrame);
      return;
    }
    if (scannerVideo.readyState < 2) {
      scannerFrameHandle = window.requestAnimationFrame(scanBarcodeFrame);
      return;
    }
    scannerBusy = true;
    try {
      const detections = await scannerDetector.detect(scannerVideo);
      const hit = Array.isArray(detections) ? detections.find((item) => item?.rawValue) : null;
      if (hit?.rawValue) {
        await handleDetectedBarcode(hit.rawValue);
        return;
      }
    } catch (error) {
      if (scannerStatus) {
        scannerStatus.textContent = error.message || "Could not scan barcode from this camera feed.";
      }
    } finally {
      scannerBusy = false;
    }
    if (scannerActive) {
      scannerFrameHandle = window.requestAnimationFrame(scanBarcodeFrame);
    }
  }

  async function openNativeScannerModal() {
    scannerDetector = await buildBarcodeDetector();
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    if (!scannerVideo) {
      throw new Error("Scanner preview is not available.");
    }
    scannerMode = "native";
    if (scannerFallbackRegion) {
      scannerFallbackRegion.hidden = true;
      scannerFallbackRegion.innerHTML = "";
    }
    scannerVideo.hidden = false;
    scannerVideo.srcObject = scannerStream;
    await scannerVideo.play();
    scannerActive = true;
    if (scannerModal) {
      scannerModal.hidden = false;
    }
    document.body.classList.add("scanner-open");
    if (scannerStatus) {
      scannerStatus.textContent = "Point the camera at a barcode to search the shared catalogue.";
    }
    scannerFrameHandle = window.requestAnimationFrame(scanBarcodeFrame);
  }

  function fallbackScannerFormats() {
    if (!window.Html5QrcodeSupportedFormats) {
      return undefined;
    }
    const formats = window.Html5QrcodeSupportedFormats;
    return [
      formats.EAN_13,
      formats.EAN_8,
      formats.UPC_A,
      formats.UPC_E,
      formats.CODE_128,
      formats.CODE_39,
      formats.ITF,
      formats.CODABAR
    ].filter(Boolean);
  }

  async function openFallbackScannerModal() {
    await ensureFallbackScannerLibrary();
    if (!scannerFallbackRegion) {
      throw new Error("Scanner fallback region is not available.");
    }
    scannerMode = "fallback";
    if (scannerVideo) {
      scannerVideo.hidden = true;
    }
    scannerFallbackRegion.hidden = false;
    scannerFallbackRegion.innerHTML = "";
    scannerFallbackInstance = new window.Html5Qrcode(scannerFallbackRegion.id, { verbose: false });
    if (scannerModal) {
      scannerModal.hidden = false;
    }
    document.body.classList.add("scanner-open");
    if (scannerStatus) {
      scannerStatus.textContent = "Point the camera at a barcode to search the shared catalogue.";
    }
    await scannerFallbackInstance.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 280, height: 120 },
        aspectRatio: 1.3333333333,
        formatsToSupport: fallbackScannerFormats()
      },
      async (decodedText) => {
        if (scannerBusy) {
          return;
        }
        scannerBusy = true;
        try {
          await handleDetectedBarcode(decodedText);
        } finally {
          scannerBusy = false;
        }
      },
      () => {}
    );
  }

  async function openScannerModal() {
    try {
      if (canUseBarcodeScanner()) {
        await openNativeScannerModal();
        return;
      }
      await openFallbackScannerModal();
    } catch (error) {
      await closeScannerModal();
      window.ItemTracker?.toast(error.message || "Could not open the barcode scanner");
    }
  }

  async function searchCatalog() {
    const state = getSearchState();
    if (!state.hasFilters) {
      renderRows([]);
      return;
    }

    if (searchButton) searchButton.disabled = true;
    try {
      const params = new URLSearchParams();
      params.set("limit", String(maxResults));
      if (state.sku) params.append("sku", state.sku);
      state.terms.forEach((term) => params.append("term", term));
      if (state.hasImagesOnly) params.set("has_images", "true");
      if (state.warehouseActiveOnly) params.set("warehouse_active", "true");
      const response = await fetch(`/api/catalog/search?${params.toString()}`, {
        cache: "no-store"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not search catalogue");
      }
      setMeta(data.meta || {});
      renderRows(data.rows || []);
    } catch (error) {
      renderRows([]);
      setEmptyState("Could not load the shared catalogue", error.message || "Try again in a moment.");
      window.ItemTracker?.toast(error.message || "Could not load the shared catalogue");
    } finally {
      if (searchButton) searchButton.disabled = false;
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob || null), type, quality);
    });
  }

  function normaliseUploadBaseName(name) {
    return String(name || "product-photo")
      .replace(/\.[^.]+$/, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "product-photo";
  }

  async function loadImageSource(file) {
    if (window.createImageBitmap) {
      const bitmap = await window.createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height),
        close: () => {
          if (typeof bitmap.close === "function") bitmap.close();
        }
      };
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const node = new Image();
        node.onload = () => resolve(node);
        node.onerror = () => reject(new Error("Could not read image"));
        node.src = objectUrl;
      });
      return {
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        draw: (context, width, height) => context.drawImage(image, 0, 0, width, height),
        close: () => URL.revokeObjectURL(objectUrl)
      };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }

  async function compressImageFile(file) {
    if (!file || !String(file.type || "").startsWith("image/")) {
      return file;
    }

    let source = null;
    try {
      source = await loadImageSource(file);
      const sourceWidth = Number(source.width || 0);
      const sourceHeight = Number(source.height || 0);
      if (!sourceWidth || !sourceHeight) {
        return file;
      }

      const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) {
        return file;
      }
      source.draw(context, targetWidth, targetHeight);

      const baseName = normaliseUploadBaseName(file.name);
      let smallest = null;
      for (const [type, extension] of [["image/webp", ".webp"], ["image/jpeg", ".jpg"]]) {
        for (const quality of IMAGE_QUALITY_STEPS) {
          const blob = await canvasToBlob(canvas, type, quality);
          if (!blob || !blob.size || (type === "image/webp" && blob.type !== "image/webp")) {
            continue;
          }
          if (!smallest || blob.size < smallest.blob.size) {
            smallest = { blob, type: blob.type || type, extension };
          }
          if (blob.size <= IMAGE_TARGET_BYTES) {
            break;
          }
        }
      }

      if (!smallest || smallest.blob.size >= file.size) {
        return file;
      }

      return new File(
        [smallest.blob],
        `${baseName}${smallest.extension}`,
        { type: smallest.type, lastModified: file.lastModified }
      );
    } catch (error) {
      return file;
    } finally {
      if (source && typeof source.close === "function") {
        source.close();
      }
    }
  }

  async function stageImages(sku, files) {
    const key = String(sku || "");
    const current = getPendingEntries(key).slice();
    let originalBytes = 0;
    let compressedBytes = 0;
    for (const file of Array.from(files || [])) {
      if (!(file instanceof File) || !file.size) {
        continue;
      }
      originalBytes += Number(file.size || 0);
      const preparedFile = await compressImageFile(file);
      compressedBytes += Number(preparedFile.size || 0);
      current.push({
        id: `${Date.now()}-${pendingUploadIndex += 1}`,
        file: preparedFile,
        previewUrl: URL.createObjectURL(preparedFile)
      });
    }

    replacePendingEntries(key, current);
    renderRows(latestRows);
    const savedBytes = Math.max(0, originalBytes - compressedBytes);
    const savedText = savedBytes > 0 ? ` after saving ${formatBytes(savedBytes)}` : "";
    window.ItemTracker?.toast(`${current.length} staged photo${current.length === 1 ? "" : "s"} ready for ${sku}${savedText}`);
  }

  function removeQueuedImage(sku, fileId) {
    const key = String(sku || "");
    const current = getPendingEntries(key);
    const keep = [];
    const removed = [];
    current.forEach((entry) => {
      if (entry.id === fileId) {
        removed.push(entry);
      } else {
        keep.push(entry);
      }
    });
    releaseEntries(removed);
    replacePendingEntries(key, keep);
    renderRows(latestRows);
  }

  async function uploadChunk(sku, caption, entries) {
    const form = new FormData();
    form.append("sku", sku);
    form.append("caption", caption || "");
    entries.forEach((entry) => form.append("images", entry.file, entry.file.name));
    const response = await fetch("/api/catalog/images", {
      method: "POST",
      body: form
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not upload image");
    }
    return data;
  }

  async function uploadQueuedImages(card, sku) {
    const queuedEntries = getPendingEntries(sku).slice();
    if (!queuedEntries.length) {
      window.ItemTracker?.toast("Take or add some photos first");
      return;
    }

    const caption = getCaptionDraft(sku);
    let uploadedCount = 0;
    let latestImages = null;
    card.style.opacity = "0.65";
    card.style.pointerEvents = "none";
    try {
      for (let index = 0; index < queuedEntries.length; index += 6) {
        const chunk = queuedEntries.slice(index, index + 6);
        const data = await uploadChunk(sku, caption, chunk);
        latestImages = data.images || latestImages;
        uploadedCount += chunk.length;
      }

      const row = getRowForSku(sku);
      if (row) {
        row.images = latestImages || [];
      }
      releaseEntries(queuedEntries);
      pendingUploads.delete(String(sku || ""));
      captionDrafts.delete(String(sku || ""));
      renderRows(latestRows);
      await refreshSummary();
      window.ItemTracker?.toast(`${uploadedCount} photo${uploadedCount === 1 ? "" : "s"} uploaded for ${sku}`);
    } catch (error) {
      if (uploadedCount > 0) {
        releaseEntries(queuedEntries.slice(0, uploadedCount));
        replacePendingEntries(String(sku || ""), queuedEntries.slice(uploadedCount));
        const row = getRowForSku(sku);
        if (row && latestImages) {
          row.images = latestImages;
        }
        renderRows(latestRows);
        window.ItemTracker?.toast(`Uploaded ${uploadedCount} photo${uploadedCount === 1 ? "" : "s"} before an error: ${error.message || "Could not finish upload"}`);
      } else {
        window.ItemTracker?.toast(error.message || "Could not upload image");
      }
    } finally {
      card.style.opacity = "";
      card.style.pointerEvents = "";
    }
  }

  async function importWorkbook(event) {
    event.preventDefault();
    if (!importForm) return;
    const formData = new FormData(importForm);
    const file = formData.get("catalog_file");
    if (!(file instanceof File) || !file.size) {
      window.ItemTracker?.toast("Choose a workbook first");
      return;
    }
    if (importStatusChip) importStatusChip.textContent = "Uploading...";
    try {
      const response = await fetch("/api/catalog/import", {
        method: "POST",
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not import workbook");
      }
      setMeta(data.meta || {});
      renderRows([]);
      await refreshSummary();
      importForm.reset();
      if (importStatusChip) importStatusChip.textContent = "Import complete";
      setEmptyState("Shared workbook updated", "Search to load the latest imported items.");
      window.ItemTracker?.toast("Workbook imported");
    } catch (error) {
      if (importStatusChip) importStatusChip.textContent = "Import failed";
      window.ItemTracker?.toast(error.message || "Could not import workbook");
    }
  }

  if (searchButton) {
    searchButton.addEventListener("click", searchCatalog);
  }

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      if (skuInput) skuInput.value = "";
      if (descOneInput) descOneInput.value = "";
      if (descTwoInput) descTwoInput.value = "";
      if (descThreeInput) descThreeInput.value = "";
      if (hasImagesOnlyInput) hasImagesOnlyInput.checked = false;
      if (warehouseActiveOnlyInput) warehouseActiveOnlyInput.checked = false;
      renderRows([]);
    });
  }

  if (scanBarcodeButton) {
    scanBarcodeButton.addEventListener("click", openScannerModal);
  }

  document.querySelectorAll(".catalog-filter-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchCatalog();
      }
    });
  });

  [hasImagesOnlyInput, warehouseActiveOnlyInput].forEach((input) => {
    if (!input) return;
    input.addEventListener("change", () => {
      if (getSearchState().hasFilters) {
        searchCatalog();
      }
    });
  });

  if (currentUser?.isAdmin && importForm) {
    importForm.addEventListener("submit", importWorkbook);
  }

  if (lightboxClose) {
    lightboxClose.addEventListener("click", closeImageLightbox);
  }
  if (lightboxPrev) {
    lightboxPrev.addEventListener("click", () => moveLightbox(-1));
  }
  if (lightboxNext) {
    lightboxNext.addEventListener("click", () => moveLightbox(1));
  }
  if (lightbox) {
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) {
        closeImageLightbox();
      }
    });
  }
  if (scannerCloseButton) {
    scannerCloseButton.addEventListener("click", closeScannerModal);
  }
  if (scannerModal) {
    scannerModal.addEventListener("click", (event) => {
      if (event.target === scannerModal) {
        closeScannerModal();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (scannerModal?.hidden === false && event.key === "Escape") {
      closeScannerModal();
      return;
    }
    if (lightbox?.hidden === false) {
      if (event.key === "Escape") {
        closeImageLightbox();
      } else if (event.key === "ArrowLeft") {
        moveLightbox(-1);
      } else if (event.key === "ArrowRight") {
        moveLightbox(1);
      }
    }
  });

  window.addEventListener("beforeunload", () => {
    Array.from(pendingUploads.values()).forEach((entries) => releaseEntries(entries));
    closeScannerModal();
  });

  setMeta(catalogMeta);
  if (canLoadSummary()) {
    refreshSummary();
  }
})();
