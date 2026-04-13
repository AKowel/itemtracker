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
                <input type="text" class="caption-input" placeholder="Optional caption">
                <label class="upload-label">
                  <span>Upload / Camera</span>
                  <input type="file" class="image-input" accept="image/*" capture="environment" multiple>
                </label>
              </div>
              <p class="photo-help">Uploads here are shared back through PocketBase so local PI-App refreshes can see them too.</p>
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
        const caption = card.querySelector(".caption-input")?.value || "";
        await uploadImages(card, sku, caption, input.files);
        input.value = "";
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

  async function uploadImages(card, sku, caption, files) {
    const form = new FormData();
    form.append("sku", sku);
    form.append("caption", caption || "");
    Array.from(files).forEach((file) => form.append("images", file));
    card.style.opacity = "0.65";
    card.style.pointerEvents = "none";
    try {
      const response = await fetch("/api/catalog/images", {
        method: "POST",
        body: form
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not upload image");
      }
      const row = latestRows.find((entry) => entry.sku === sku);
      if (row) {
        row.images = data.images || [];
      }
      renderRows(latestRows);
      window.ItemTracker?.toast(`Photo uploaded for ${sku}`);
    } catch (error) {
      window.ItemTracker?.toast(error.message || "Could not upload image");
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

  setMeta(catalogMeta);
})();
