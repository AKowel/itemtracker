(function () {
  const boot = window.ITEMTRACKER_BOOTSTRAP || {};
  const currentUser = boot.currentUser || null;
  const maxResults = Number(boot.maxResults || 60);
  let catalogMeta = boot.catalogMeta || {};
  let latestRows = [];

  const resultsGrid = document.getElementById("resultsGrid");
  const emptyState = document.getElementById("emptyState");
  const queryInput = document.getElementById("catalogQuery");
  const searchButton = document.getElementById("searchButton");
  const clearButton = document.getElementById("clearButton");
  const resultCountChip = document.getElementById("resultCountChip");
  const metaSourceChip = document.getElementById("metaSourceChip");
  const metaCountChip = document.getElementById("metaCountChip");
  const metaImportedChip = document.getElementById("metaImportedChip");
  const importForm = document.getElementById("importForm");
  const importStatusChip = document.getElementById("importStatusChip");
  const pendingUploads = new Map();
  const captionDrafts = new Map();
  let pendingUploadIndex = 0;

  function setMeta(meta) {
    catalogMeta = meta || {};
    if (metaSourceChip) metaSourceChip.textContent = `Source: ${catalogMeta.source || "none"}`;
    if (metaCountChip) metaCountChip.textContent = `${Number(catalogMeta.row_count || 0).toLocaleString()} items`;
    if (metaImportedChip) metaImportedChip.textContent = catalogMeta.imported_at ? `Imported ${catalogMeta.imported_at}` : "No import yet";
  }

  function setEmptyState(title, subtitle, visible = true) {
    if (!emptyState) return;
    emptyState.hidden = !visible;
    if (!visible) return;
    emptyState.innerHTML = `<strong>${title}</strong><span>${subtitle}</span>`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function renderRows(rows) {
    latestRows = Array.isArray(rows) ? rows : [];
    if (resultCountChip) {
      resultCountChip.textContent = `${latestRows.length} matches`;
    }
    if (!latestRows.length) {
      resultsGrid.innerHTML = "";
      const hasQuery = !!String(queryInput?.value || "").trim();
      setEmptyState(
        hasQuery ? "No matching items found" : "Search to load catalogue items",
        hasQuery ? "Try a different SKU fragment or product phrase." : "Start with a SKU or a few description words."
      );
      return;
    }

    setEmptyState("", "", false);
    resultsGrid.innerHTML = latestRows
      .map((row) => {
        const images = Array.isArray(row.images) ? row.images : [];
        const queued = getPendingEntries(row.sku);
        const badges = [
          row.active ? "Active" : "Inactive",
          row.barcode ? `Barcode ${row.barcode}` : "",
          row.size ? `Size ${row.size}` : "",
          row.color ? `Color ${row.color}` : "",
          `${images.length} photo${images.length === 1 ? "" : "s"}`
        ].filter(Boolean);
        return `
          <article class="result-card" data-sku="${escapeHtml(row.sku)}">
            <div class="result-card__head">
              <div>
                <p class="eyebrow">SKU</p>
                <h3>${escapeHtml(row.sku)}</h3>
                <p>${escapeHtml(row.description || row.description_short || "")}</p>
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
                        (image) => `
                          <a href="${image.url}" class="photo-card" target="_blank" rel="noopener">
                            <img src="${image.url}" alt="${escapeHtml(row.sku)}">
                            <span>${escapeHtml(image.caption || "Open image")}</span>
                          </a>
                        `
                      )
                      .join("")
                  : `
                    <div class="photo-card">
                      <img alt="No photo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='100%25' height='100%25' fill='%23eef3f9'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2361728a' font-size='13' font-family='Arial'%3ENo Photo%3C/text%3E%3C/svg%3E">
                      <span>Add the first photo</span>
                    </div>
                  `
              }
            </div>
            <div class="upload-box">
              <div class="upload-row">
                <input type="text" class="caption-input" data-sku="${escapeHtml(row.sku)}" value="${escapeHtml(getCaptionDraft(row.sku))}" placeholder="Optional caption">
                <label class="upload-label">
                  <span>Add Photos / Camera</span>
                  <input type="file" class="image-input" accept="image/*" capture="environment" multiple>
                </label>
              </div>
              ${
                queued.length
                  ? `
                    <div class="queued-uploads">
                      <div class="queued-uploads__head">
                        <strong>${queued.length} photo${queued.length === 1 ? "" : "s"} queued</strong>
                        <div class="queued-uploads__actions">
                          <button type="button" class="ghost-button queue-clear-button" data-sku="${escapeHtml(row.sku)}">Clear Queue</button>
                          <button type="button" class="queue-upload-button" data-sku="${escapeHtml(row.sku)}">Upload Queued Photos</button>
                        </div>
                      </div>
                      <div class="queued-grid">
                        ${queued
                          .map(
                            (entry) => `
                              <div class="queued-photo">
                                <button type="button" class="queued-photo__remove" data-sku="${escapeHtml(row.sku)}" data-file-id="${escapeHtml(entry.id)}" aria-label="Remove queued photo">x</button>
                                <img src="${escapeHtml(entry.previewUrl)}" alt="Queued upload for ${escapeHtml(row.sku)}">
                              </div>
                            `
                          )
                          .join("")}
                      </div>
                    </div>
                  `
                  : ""
              }
              <p class="photo-help">Keep adding photos from the camera or gallery, then tap <strong>Upload Queued Photos</strong> when you are ready.</p>
            </div>
          </article>
        `;
      })
      .join("");

    document.querySelectorAll(".image-input").forEach((input) => {
      input.addEventListener("change", async () => {
        const card = input.closest(".result-card");
        const sku = card?.dataset?.sku || "";
        if (!sku || !input.files?.length) return;
        stageImages(sku, input.files);
        input.value = "";
      });
    });

    document.querySelectorAll(".caption-input").forEach((input) => {
      input.addEventListener("input", () => {
        setCaptionDraft(input.dataset.sku || "", input.value || "");
      });
    });

    document.querySelectorAll(".queue-upload-button").forEach((button) => {
      button.addEventListener("click", async () => {
        const sku = button.dataset.sku || "";
        const card = button.closest(".result-card");
        if (!sku || !card) return;
        await uploadQueuedImages(card, sku);
      });
    });

    document.querySelectorAll(".queue-clear-button").forEach((button) => {
      button.addEventListener("click", () => {
        const sku = button.dataset.sku || "";
        if (!sku) return;
        clearPendingEntries(sku);
        renderRows(latestRows);
      });
    });

    document.querySelectorAll(".queued-photo__remove").forEach((button) => {
      button.addEventListener("click", () => {
        const sku = button.dataset.sku || "";
        const fileId = button.dataset.fileId || "";
        if (!sku || !fileId) return;
        removeQueuedImage(sku, fileId);
      });
    });
  }

  async function searchCatalog() {
    const query = String(queryInput?.value || "").trim();
    if (searchButton) searchButton.disabled = true;
    try {
      const response = await fetch(`/api/catalog/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(maxResults)}`, {
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

  function stageImages(sku, files) {
    const key = String(sku || "");
    const current = getPendingEntries(key).slice();
    Array.from(files || []).forEach((file) => {
      if (!(file instanceof File) || !file.size) return;
      current.push({
        id: `${Date.now()}-${pendingUploadIndex += 1}`,
        file,
        previewUrl: URL.createObjectURL(file)
      });
    });
    replacePendingEntries(key, current);
    renderRows(latestRows);
    window.ItemTracker?.toast(`${current.length} queued photo${current.length === 1 ? "" : "s"} ready for ${sku}`);
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
      window.ItemTracker?.toast("Add some photos first");
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
      const row = latestRows.find((entry) => entry.sku === sku);
      if (row) {
        row.images = latestImages || [];
      }
      releaseEntries(queuedEntries);
      pendingUploads.delete(String(sku || ""));
      captionDrafts.delete(String(sku || ""));
      renderRows(latestRows);
      window.ItemTracker?.toast(`${uploadedCount} photo${uploadedCount === 1 ? "" : "s"} uploaded for ${sku}`);
    } catch (error) {
      if (uploadedCount > 0) {
        releaseEntries(queuedEntries.slice(0, uploadedCount));
        replacePendingEntries(String(sku || ""), queuedEntries.slice(uploadedCount));
        const row = latestRows.find((entry) => entry.sku === sku);
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
      if (queryInput) queryInput.value = "";
      renderRows([]);
    });
  }
  if (queryInput) {
    queryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchCatalog();
      }
    });
  }
  if (currentUser?.isAdmin && importForm) {
    importForm.addEventListener("submit", importWorkbook);
  }

  window.addEventListener("beforeunload", () => {
    Array.from(pendingUploads.values()).forEach((entries) => releaseEntries(entries));
  });

  setMeta(catalogMeta);
})();
