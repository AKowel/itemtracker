const doc = typeof document !== "undefined" ? document : null;

const clientSelect = doc?.getElementById("reportsClientSelect") || null;
const modeSelect = doc?.getElementById("reportsModeSelect") || null;
const dateField = doc?.getElementById("reportsDateField") || null;
const dateSelect = doc?.getElementById("reportsDateSelect") || null;
const startField = doc?.getElementById("reportsStartField") || null;
const endField = doc?.getElementById("reportsEndField") || null;
const startDateInput = doc?.getElementById("reportsStartDate") || null;
const endDateInput = doc?.getElementById("reportsEndDate") || null;
const rankBySelect = doc?.getElementById("reportsRankBySelect") || null;
const limitSelect = doc?.getElementById("reportsLimitSelect") || null;
const exportButton = doc?.getElementById("reportsExportButton") || null;
const reloadButton = doc?.getElementById("reportsReloadButton") || null;
const reportTabs = Array.from(doc?.querySelectorAll("[data-report-tab]") || []);
const reportPanels = Array.from(doc?.querySelectorAll("[data-report-panel]") || []);
const clientAwareLinks = Array.from(doc?.querySelectorAll("[data-client-aware-link]") || []);

const dateChip = doc?.getElementById("reportsDateChip") || null;
const coverageChip = doc?.getElementById("reportsCoverageChip") || null;
const peakDayChip = doc?.getElementById("reportsPeakDayChip") || null;
const statusChip = doc?.getElementById("reportsStatusChip") || null;

const totalPicksMetric = doc?.getElementById("reportsTotalPicksMetric") || null;
const totalQtyMetric = doc?.getElementById("reportsTotalQtyMetric") || null;
const activeSkusMetric = doc?.getElementById("reportsActiveSkusMetric") || null;
const activeLocationsMetric = doc?.getElementById("reportsActiveLocationsMetric") || null;
const avgQtyPerPickMetric = doc?.getElementById("reportsAvgQtyPerPickMetric") || null;
const avgPicksPerDayMetric = doc?.getElementById("reportsAvgPicksPerDayMetric") || null;
const pickBinPicksMetric = doc?.getElementById("reportsPickBinPicksMetric") || null;
const bulkBinPicksMetric = doc?.getElementById("reportsBulkBinPicksMetric") || null;
const highLevelPicksMetric = doc?.getElementById("reportsHighLevelPicksMetric") || null;
const estimatedReplenishmentsMetric = doc?.getElementById("reportsEstimatedReplenishmentsMetric") || null;

const summaryWrap = doc?.getElementById("reportsSummaryWrap") || null;
const recommendationsSummaryWrap = doc?.getElementById("reportsRecommendationsSummaryWrap") || null;
const moveLowerWrap = doc?.getElementById("reportsMoveLowerWrap") || null;
const bulkToPickWrap = doc?.getElementById("reportsBulkToPickWrap") || null;
const abcVelocityWrap = doc?.getElementById("reportsAbcVelocityWrap") || null;
const levelComplianceWrap = doc?.getElementById("reportsLevelComplianceWrap") || null;
const pickFaceSuitabilityWrap = doc?.getElementById("reportsPickFaceSuitabilityWrap") || null;
const topSkusWrap = doc?.getElementById("reportsTopSkusWrap") || null;
const skuOutliersWrap = doc?.getElementById("reportsSkuOutliersWrap") || null;
const locationOutliersWrap = doc?.getElementById("reportsLocationOutliersWrap") || null;
const topLocationsWrap = doc?.getElementById("reportsTopLocationsWrap") || null;
const topAislesWrap = doc?.getElementById("reportsTopAislesWrap") || null;
const levelBreakdownWrap = doc?.getElementById("reportsLevelBreakdownWrap") || null;
const binTypeWrap = doc?.getElementById("reportsBinTypeWrap") || null;
const binSizeWrap = doc?.getElementById("reportsBinSizeWrap") || null;
const highLevelSkusWrap = doc?.getElementById("reportsHighLevelSkusWrap") || null;
const replenishmentWrap = doc?.getElementById("reportsReplenishmentWrap") || null;
const dailyWrap = doc?.getElementById("reportsDailyWrap") || null;

async function apiFetch(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function normalizeClientCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
}

function getSelectedClient() {
  return normalizeClientCode(clientSelect?.value || "FANDMKET") || "FANDMKET";
}

function updateClientAwareLinks() {
  if (!clientAwareLinks.length || typeof window === "undefined") return;
  const selectedClient = getSelectedClient();
  clientAwareLinks.forEach((link) => {
    const href = String(link.getAttribute("href") || "").trim();
    if (!href) return;
    const url = new URL(href, window.location.origin);
    url.searchParams.set("client", selectedClient);
    link.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
  });
}

function syncClientUrl() {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.set("client", getSelectedClient());
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function navigateToSelectedClient() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("client", getSelectedClient());
  window.location.assign(`${url.pathname}${url.search}${url.hash}`);
}

async function readErrorMessage(response, fallbackMessage) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const data = await response.json().catch(() => ({}));
    return data.error || fallbackMessage;
  }
  const text = await response.text().catch(() => "");
  return text || fallbackMessage;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString();
}

function formatDecimal(value, digits = 1) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }) : "0";
}

function formatPercent(value, digits = 1) {
  return `${formatDecimal(value, digits)}%`;
}

function setStatus(message, type = "") {
  if (!statusChip) return;
  statusChip.textContent = message || "Ready";
  statusChip.classList.toggle("chip--inactive", type !== "ok");
}

function activateReportTab(tabKey) {
  if (!reportTabs.length || !reportPanels.length) return;
  const target = String(tabKey || "overview").trim().toLowerCase() || "overview";
  let resolved = target;
  if (!reportTabs.some((button) => String(button.dataset.reportTab || "").trim().toLowerCase() === target)) {
    resolved = String(reportTabs[0]?.dataset.reportTab || "overview").trim().toLowerCase() || "overview";
  }
  reportTabs.forEach((button) => {
    const isActive = String(button.dataset.reportTab || "").trim().toLowerCase() === resolved;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  reportPanels.forEach((panel) => {
    const isActive = String(panel.dataset.reportPanel || "").trim().toLowerCase() === resolved;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
  try {
    window.sessionStorage?.setItem("itemtracker.pickingReportsTab", resolved);
  } catch (_error) {
    // ignore storage failures
  }
}

function syncModeUi() {
  if (!modeSelect) return;
  const mode = String(modeSelect.value || "latest").trim().toLowerCase();
  const showDate = mode === "date";
  const showCustomRange = mode === "custom";

  if (dateField) {
    dateField.hidden = !showDate;
  }
  if (startField) {
    startField.hidden = !showCustomRange;
  }
  if (endField) {
    endField.hidden = !showCustomRange;
  }
}

function updateDateOptions(availableDates, selectedDate) {
  if (!dateSelect) return;
  const current = dateSelect.value;
  dateSelect.innerHTML = "";
  const dates = Array.from(new Set((availableDates || []).filter(Boolean)));

  if (!dates.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No snapshots yet";
    dateSelect.appendChild(option);
    dateSelect.value = "";
    return;
  }

  dates.forEach((date) => {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = date;
    dateSelect.appendChild(option);
  });

  const resolved = selectedDate || current || dates[0] || "";
  dateSelect.value = dates.includes(resolved) ? resolved : dates[0];
}

function buildReportsQuery() {
  const params = new URLSearchParams();
  params.set("client", getSelectedClient());
  const mode = String(modeSelect?.value || "latest").trim().toLowerCase() || "latest";
  params.set("mode", mode);
  params.set("rankBy", String(rankBySelect?.value || "pick_count").trim());
  params.set("limit", String(limitSelect?.value || "50").trim());

  if (mode === "date") {
    const selectedDate = String(dateSelect?.value || "").trim();
    if (selectedDate) {
      params.set("date", selectedDate);
    }
  } else if (mode === "custom") {
    const startDate = String(startDateInput?.value || "").trim();
    const endDate = String(endDateInput?.value || "").trim();
    if (startDate) {
      params.set("start", startDate);
    }
    if (endDate) {
      params.set("end", endDate);
    }
  }

  return `?${params.toString()}`;
}

function parseDownloadFilename(disposition, fallback = "picking-reports.xlsx") {
  const utfMatch = String(disposition || "").match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch (_error) {
      return utfMatch[1];
    }
  }
  const basicMatch = String(disposition || "").match(/filename="?([^"]+)"?/i);
  return basicMatch?.[1] || fallback;
}

async function exportReportsWorkbook() {
  if (!exportButton) return;

  const originalLabel = exportButton.textContent || "Export Excel";
  exportButton.disabled = true;
  exportButton.textContent = "Exporting...";

  try {
    const response = await fetch(`/api/admin/picking-reports/export.xlsx${buildReportsQuery()}`);
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, "Could not export the picking reports."));
    }

    const filename = parseDownloadFilename(
      response.headers.get("content-disposition"),
      "picking-reports.xlsx"
    );
    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
    window.ItemTracker?.toast("Excel export downloaded", "success");
  } catch (error) {
    window.ItemTracker?.toast(error.message || "Could not export the picking reports", "error");
  } finally {
    exportButton.disabled = false;
    exportButton.textContent = originalLabel;
  }
}

function renderTable(wrapper, rows, columns, emptyMessage) {
  if (!wrapper) return;
  if (!rows.length) {
    wrapper.innerHTML = `<p class="admin-empty">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  const headHtml = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const bodyHtml = rows.map((row, index) => (
    `<tr>${columns.map((column) => `<td>${column.render(row, index)}</td>`).join("")}</tr>`
  )).join("");

  wrapper.innerHTML = `
    <div class="admin-table-scroll">
      <table class="admin-table">
        <thead>
          <tr>${headHtml}</tr>
        </thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  `;
}

function renderSummary(reports) {
  if (!summaryWrap) return;
  const meta = reports?.meta || {};
  const summary = reports?.summary || {};
  const missingDates = Array.isArray(meta.pick_missing_dates) ? meta.pick_missing_dates.filter(Boolean) : [];
  const requestedRange = meta.pick_requested_start_date && meta.pick_requested_end_date
    ? meta.pick_requested_start_date === meta.pick_requested_end_date
      ? meta.pick_requested_start_date
      : `${meta.pick_requested_start_date} to ${meta.pick_requested_end_date}`
    : meta.latest_pick_snapshot_date || "Latest available day";
  const missingLabel = missingDates.length
    ? `${missingDates.slice(0, 6).join(", ")}${missingDates.length > 6 ? ` +${missingDates.length - 6} more` : ""}`
    : "None";

  summaryWrap.innerHTML = `
    <article class="reports-summary-card__item">
      <span class="eyebrow">Requested range</span>
      <strong>${escapeHtml(requestedRange)}</strong>
      <p>${formatInteger(meta.pick_available_day_count || 0)} of ${formatInteger(meta.pick_requested_day_count || 0)} requested day(s) were loaded.</p>
    </article>
    <article class="reports-summary-card__item">
      <span class="eyebrow">Missing days</span>
      <strong>${escapeHtml(missingLabel)}</strong>
      <p>Missing snapshot days are excluded from every table and average on this page.</p>
    </article>
    <article class="reports-summary-card__item">
      <span class="eyebrow">Data note</span>
      <strong>${escapeHtml(meta.sku_detail_source || "Snapshot detail")}</strong>
      <p>${escapeHtml(meta.sku_detail_note || "This report is built from the published pick snapshots currently available.")}</p>
    </article>
    <article class="reports-summary-card__item">
      <span class="eyebrow">Peak day</span>
      <strong>${escapeHtml(summary.peak_day_date || "No peak day yet")}</strong>
      <p>${formatInteger(summary.peak_day_pick_count || 0)} picks and ${formatInteger(summary.peak_day_pick_qty || 0)} units on the busiest loaded day.</p>
    </article>
    <article class="reports-summary-card__item">
      <span class="eyebrow">Warehouse structure</span>
      <strong>${escapeHtml(meta.warehouse_snapshot_date || "No warehouse snapshot")}</strong>
      <p>${escapeHtml(meta.structure_note || "Warehouse structure fields drive the level, pick/bulk, and bin-size reporting.")}</p>
    </article>
    <article class="reports-summary-card__item">
      <span class="eyebrow">Replenishment note</span>
      <strong>${escapeHtml(`Level ${meta.high_level_threshold || 10}+ watched`)}</strong>
      <p>${escapeHtml(meta.replenishment_note || "Replenishment estimates use current pick-bin matches and Max. Bin Qty when it is available.")}</p>
    </article>
  `;
}

function renderRecommendationsSummary(reports) {
  if (!recommendationsSummaryWrap) return;
  const recommendations = reports?.recommendations || {};
  const summary = recommendations.summary || {};
  const abcSummary = Array.isArray(recommendations.abc_velocity?.summary) ? recommendations.abc_velocity.summary : [];
  const abcLabels = abcSummary
    .map((entry) => `${escapeHtml(entry.abc_class || "")}: ${formatInteger(entry.sku_count || 0)} SKU(s)`)
    .join(" · ");
  const abcMixLabel = String(abcLabels || "")
    .replace(/[^ -~]+/g, " | ")
    .replace(/\s+\|\s+/g, " | ")
    .replace(/\s{2,}/g, " ")
    .trim();

  recommendationsSummaryWrap.innerHTML = `
    <article class="reports-summary-card__item">
      <span class="eyebrow">Move lower</span>
      <strong>${formatInteger(summary.move_lower_candidate_count || 0)}</strong>
      <p>SKUs whose high-level activity and velocity make them good candidates to move down first.</p>
    </article>
    <article class="reports-summary-card__item">
      <span class="eyebrow">Bulk to pick</span>
      <strong>${formatInteger(summary.move_to_pick_bin_candidate_count || 0)}</strong>
      <p>SKUs that are still doing too much work from bulk bins and likely need a better pick face.</p>
    </article>
    <article class="reports-summary-card__item">
      <span class="eyebrow">Pick-face issues</span>
      <strong>${formatInteger(summary.pick_face_issue_count || 0)}</strong>
      <p>Pick faces with capacity, level, or bin-size signals that deserve a closer look.</p>
    </article>
    <article class="reports-summary-card__item">
      <span class="eyebrow">ABC mix</span>
      <strong>${abcMixLabel || "No ABC data yet"}</strong>
      <p>Velocity classes are based on the current ranking metric and range, so the mix shifts with the filter window.</p>
    </article>
    <article class="reports-summary-card__item">
      <span class="eyebrow">Level easy wins</span>
      <strong>${formatInteger(summary.level_compliance_easy_win_count || 0)}</strong>
      <p>High-level picking opportunities that look easiest to attack first.</p>
    </article>
    <article class="reports-summary-card__item">
      <span class="eyebrow">Scoring note</span>
      <strong>Weighted recommendations</strong>
      <p>${escapeHtml(summary.recommendation_note || reports?.meta?.recommendation_note || "Scores combine activity, level position, replenishment burden, and ABC velocity.")}</p>
    </article>
  `;
}

function renderMoveLower(reports) {
  renderTable(
    moveLowerWrap,
    Array.isArray(reports?.recommendations?.slotting?.move_lower) ? reports.recommendations.slotting.move_lower : [],
    [
      { label: "SKU", render: (row) => `<strong>${escapeHtml(row.sku)}</strong>` },
      { label: "ABC", render: (row) => escapeHtml(row.abc_class || "-") },
      { label: "Score", render: (row) => formatDecimal(row.move_lower_score || 0, 1) },
      { label: "High-level share", render: (row) => formatPercent(row.high_level_share || 0, 1) },
      { label: "High-level picks", render: (row) => formatInteger(row.high_level_pick_count || 0) },
      { label: "Lower picks", render: (row) => formatInteger(row.low_level_pick_count || 0) },
      { label: "Action", render: (row) => escapeHtml(row.suggested_action || "-") }
    ],
    "No move-lower recommendations are available for the selected range."
  );
}

function renderBulkToPick(reports) {
  renderTable(
    bulkToPickWrap,
    Array.isArray(reports?.recommendations?.slotting?.move_to_pick_bin) ? reports.recommendations.slotting.move_to_pick_bin : [],
    [
      { label: "SKU", render: (row) => `<strong>${escapeHtml(row.sku)}</strong>` },
      { label: "ABC", render: (row) => escapeHtml(row.abc_class || "-") },
      { label: "Score", render: (row) => formatDecimal(row.move_to_pick_bin_score || 0, 1) },
      { label: "Bulk share", render: (row) => formatPercent(row.bulk_share || 0, 1) },
      { label: "Bulk picks", render: (row) => formatInteger(row.bulk_bin_pick_count || 0) },
      { label: "Pick-face picks", render: (row) => formatInteger(row.pick_bin_pick_count || 0) },
      { label: "Action", render: (row) => escapeHtml(row.suggested_action || "-") }
    ],
    "No bulk-to-pick recommendations are available for the selected range."
  );
}

function renderAbcVelocity(reports) {
  renderTable(
    abcVelocityWrap,
    Array.isArray(reports?.recommendations?.abc_velocity?.skus) ? reports.recommendations.abc_velocity.skus : [],
    [
      { label: "ABC", render: (row) => `<strong>${escapeHtml(row.abc_class || "-")}</strong>` },
      { label: "SKU", render: (row) => escapeHtml(row.sku || "-") },
      { label: "Picks", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "Qty", render: (row) => formatInteger(row.pick_qty || 0) },
      { label: "Metric share", render: (row) => formatPercent(row.metric_share || 0, 1) },
      { label: "Cum. share", render: (row) => formatPercent(row.cumulative_metric_share || 0, 1) },
      { label: "High-level picks", render: (row) => formatInteger(row.high_level_pick_count || 0) }
    ],
    "No ABC velocity rows are available for the selected range."
  );
}

function renderLevelCompliance(reports) {
  if (!levelComplianceWrap) return;
  const levelCompliance = reports?.recommendations?.level_compliance || {};
  const summary = levelCompliance.summary || {};
  const rows = Array.isArray(levelCompliance.easy_wins) ? levelCompliance.easy_wins : [];
  const summaryHtml = `
    <div class="reports-summary-wrap" style="margin-bottom:1rem;">
      <article class="reports-summary-card__item">
        <span class="eyebrow">Compliant picks</span>
        <strong>${formatInteger(summary.compliant_pick_count || 0)}</strong>
        <p>${formatPercent(summary.compliant_share_of_picks || 0, 1)} of picks are currently below level ${formatInteger((summary.threshold || 10) - 1)}.</p>
      </article>
      <article class="reports-summary-card__item">
        <span class="eyebrow">High-level picks</span>
        <strong>${formatInteger(summary.high_level_pick_count || 0)}</strong>
        <p>${formatPercent(summary.high_level_share_of_picks || 0, 1)} of picks are still happening at level ${formatInteger(summary.threshold || 10)}+.</p>
      </article>
      <article class="reports-summary-card__item">
        <span class="eyebrow">High-level SKUs</span>
        <strong>${formatInteger(summary.high_level_sku_count || 0)}</strong>
        <p>Distinct SKUs with meaningful activity above the target level threshold.</p>
      </article>
      <article class="reports-summary-card__item">
        <span class="eyebrow">Easy wins</span>
        <strong>${formatInteger(summary.easy_win_count || 0)}</strong>
        <p>Rows below are the easiest first moves because they are heavily high-level and have weak lower-level coverage.</p>
      </article>
    </div>
  `;

  const tableHost = document.createElement("div");
  renderTable(
    tableHost,
    rows,
    [
      { label: "SKU", render: (row) => `<strong>${escapeHtml(row.sku)}</strong>` },
      { label: "ABC", render: (row) => escapeHtml(row.abc_class || "-") },
      { label: "Score", render: (row) => formatDecimal(row.move_lower_score || 0, 1) },
      { label: "High-level share", render: (row) => formatPercent(row.high_level_share || 0, 1) },
      { label: "High-level picks", render: (row) => formatInteger(row.high_level_pick_count || 0) },
      { label: "Lower picks", render: (row) => formatInteger(row.low_level_pick_count || 0) }
    ],
    "No easy-win level compliance rows are available for the selected range."
  );

  levelComplianceWrap.innerHTML = `${summaryHtml}${tableHost.innerHTML}`;
}

function renderPickFaceSuitability(reports) {
  renderTable(
    pickFaceSuitabilityWrap,
    Array.isArray(reports?.recommendations?.pick_face_suitability) ? reports.recommendations.pick_face_suitability : [],
    [
      { label: "Location", render: (row) => `<strong>${escapeHtml(row.location)}</strong>` },
      { label: "SKU", render: (row) => escapeHtml(row.sku || "-") },
      { label: "ABC", render: (row) => escapeHtml(row.abc_class || "-") },
      { label: "Level", render: (row) => escapeHtml(row.level || "-") },
      { label: "Bin size", render: (row) => escapeHtml(row.bin_size || "-") },
      { label: "Score", render: (row) => formatDecimal(row.suitability_score || 0, 1) },
      { label: "Est. repl.", render: (row) => formatInteger(row.estimated_replenishments || 0) },
      { label: "Cover at max", render: (row) => row.days_of_cover_at_max ? `${formatDecimal(row.days_of_cover_at_max || 0, 1)} days` : "-" },
      { label: "Issues", render: (row) => escapeHtml(row.issue_summary || "-") }
    ],
    "No pick-face suitability rows are available for the selected range."
  );
}

function renderMetrics(reports) {
  const summary = reports?.summary || {};
  if (totalPicksMetric) totalPicksMetric.textContent = formatInteger(summary.total_pick_count || 0);
  if (totalQtyMetric) totalQtyMetric.textContent = formatInteger(summary.total_pick_qty || 0);
  if (activeSkusMetric) activeSkusMetric.textContent = formatInteger(summary.active_sku_count || 0);
  if (activeLocationsMetric) activeLocationsMetric.textContent = formatInteger(summary.active_location_count || 0);
  if (avgQtyPerPickMetric) avgQtyPerPickMetric.textContent = formatDecimal(summary.avg_qty_per_pick || 0, 2);
  if (avgPicksPerDayMetric) avgPicksPerDayMetric.textContent = formatDecimal(summary.avg_picks_per_day || 0, 1);
  if (pickBinPicksMetric) pickBinPicksMetric.textContent = formatInteger(summary.pick_bin_pick_count || 0);
  if (bulkBinPicksMetric) bulkBinPicksMetric.textContent = formatInteger(summary.bulk_bin_pick_count || 0);
  if (highLevelPicksMetric) highLevelPicksMetric.textContent = formatInteger(summary.high_level_pick_count || 0);
  if (estimatedReplenishmentsMetric) estimatedReplenishmentsMetric.textContent = formatInteger(summary.estimated_replenishment_count || 0);
}

function renderHeroChips(reports) {
  const meta = reports?.meta || {};
  const summary = reports?.summary || {};
  const requestedRange = meta.pick_requested_start_date && meta.pick_requested_end_date
    ? meta.pick_requested_start_date === meta.pick_requested_end_date
      ? `Range ${meta.pick_requested_start_date}`
      : `${meta.pick_requested_start_date} to ${meta.pick_requested_end_date}`
    : meta.latest_pick_snapshot_date
      ? `Snapshot ${meta.latest_pick_snapshot_date}`
      : "No snapshots yet";

  if (dateChip) {
    dateChip.textContent = requestedRange;
  }
  if (coverageChip) {
    if (Number(meta.pick_requested_day_count || 0) > 0) {
      coverageChip.textContent = `${formatInteger(meta.pick_available_day_count || 0)}/${formatInteger(meta.pick_requested_day_count || 0)} day(s) loaded`;
    } else {
      coverageChip.textContent = "No snapshot coverage yet";
    }
  }
  if (peakDayChip) {
    peakDayChip.textContent = summary.peak_day_date
      ? `Peak day ${summary.peak_day_date}`
      : "No peak day yet";
  }
}

function renderTopSkus(reports) {
  renderTable(
    topSkusWrap,
    Array.isArray(reports?.top_skus) ? reports.top_skus : [],
    [
      { label: "#", render: (_row, index) => formatInteger(index + 1) },
      { label: "SKU", render: (row) => `<strong>${escapeHtml(row.sku)}</strong>` },
      { label: "Description", render: (row) => escapeHtml(row.description || "No description") },
      { label: "Picks", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "Qty", render: (row) => formatInteger(row.pick_qty || 0) },
      { label: "Days", render: (row) => formatInteger(row.day_count || 0) },
      { label: "Locations", render: (row) => formatInteger(row.location_count || 0) },
      { label: "Avg qty / pick", render: (row) => formatDecimal(row.avg_qty_per_pick || 0, 2) },
      { label: "Share", render: (row) => formatPercent(row.share_of_picks || 0, 1) }
    ],
    "No SKU activity matches the selected range."
  );
}

function renderSkuOutliers(reports) {
  renderTable(
    skuOutliersWrap,
    Array.isArray(reports?.sku_outliers) ? reports.sku_outliers : [],
    [
      { label: "SKU", render: (row) => `<strong>${escapeHtml(row.sku)}</strong>` },
      { label: "Description", render: (row) => escapeHtml(row.description || "No description") },
      { label: "Picks", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "Qty", render: (row) => formatInteger(row.pick_qty || 0) },
      { label: "Days", render: (row) => formatInteger(row.day_count || 0) },
      { label: "Score", render: (row) => `${formatDecimal(row.outlier_score || 0, 2)}σ` }
    ],
    "No SKU outliers were found for the selected range."
  );
}

function renderLocationOutliers(reports) {
  renderTable(
    locationOutliersWrap,
    Array.isArray(reports?.location_outliers) ? reports.location_outliers : [],
    [
      { label: "Location", render: (row) => `<strong>${escapeHtml(row.location)}</strong>` },
      { label: "Aisle", render: (row) => escapeHtml(row.aisle_prefix || "-") },
      { label: "Picks", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "Qty", render: (row) => formatInteger(row.pick_qty || 0) },
      { label: "Days", render: (row) => formatInteger(row.day_count || 0) },
      { label: "SKUs", render: (row) => formatInteger(row.sku_count || 0) },
      { label: "Score", render: (row) => `${formatDecimal(row.outlier_score || 0, 2)}σ` }
    ],
    "No location outliers were found for the selected range."
  );
}

function renderTopLocations(reports) {
  renderTable(
    topLocationsWrap,
    Array.isArray(reports?.top_locations) ? reports.top_locations : [],
    [
      { label: "Location", render: (row) => `<strong>${escapeHtml(row.location)}</strong>` },
      { label: "Aisle", render: (row) => escapeHtml(row.aisle_prefix || "-") },
      { label: "Bay", render: (row) => escapeHtml(row.bay || "-") },
      { label: "Level", render: (row) => escapeHtml(row.level || "-") },
      { label: "Picks", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "Qty", render: (row) => formatInteger(row.pick_qty || 0) },
      { label: "Days", render: (row) => formatInteger(row.day_count || 0) },
      { label: "SKUs", render: (row) => formatInteger(row.sku_count || 0) }
    ],
    "No location activity matches the selected range."
  );
}

function renderTopAisles(reports) {
  renderTable(
    topAislesWrap,
    Array.isArray(reports?.top_aisles) ? reports.top_aisles : [],
    [
      { label: "Aisle", render: (row) => `<strong>${escapeHtml(row.aisle_prefix)}</strong>` },
      { label: "Picks", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "Qty", render: (row) => formatInteger(row.pick_qty || 0) },
      { label: "Days", render: (row) => formatInteger(row.day_count || 0) },
      { label: "Locations", render: (row) => formatInteger(row.location_count || 0) },
      { label: "SKUs", render: (row) => formatInteger(row.sku_count || 0) }
    ],
    "No aisle activity matches the selected range."
  );
}

function renderLevelBreakdown(reports) {
  renderTable(
    levelBreakdownWrap,
    Array.isArray(reports?.level_breakdown) ? reports.level_breakdown : [],
    [
      { label: "Level", render: (row) => `<strong>${escapeHtml(row.level || "Unknown")}</strong>` },
      { label: "Picks", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "Qty", render: (row) => formatInteger(row.pick_qty || 0) },
      { label: "Locations", render: (row) => formatInteger(row.location_count || 0) },
      { label: "SKUs", render: (row) => formatInteger(row.sku_count || 0) },
      { label: "Pick-bin picks", render: (row) => formatInteger(row.pick_bin_pick_count || 0) },
      { label: "Bulk-bin picks", render: (row) => formatInteger(row.bulk_bin_pick_count || 0) },
      { label: "Share", render: (row) => formatPercent(row.share_of_picks || 0, 1) }
    ],
    "No level activity matches the selected range."
  );
}

function renderBinTypes(reports) {
  renderTable(
    binTypeWrap,
    Array.isArray(reports?.bin_type_breakdown) ? reports.bin_type_breakdown : [],
    [
      { label: "Type", render: (row) => `<strong>${escapeHtml(row.bin_type || "Unknown")}</strong>` },
      { label: "Picks", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "Qty", render: (row) => formatInteger(row.pick_qty || 0) },
      { label: "Locations", render: (row) => formatInteger(row.location_count || 0) },
      { label: "SKUs", render: (row) => formatInteger(row.sku_count || 0) },
      { label: "Levels", render: (row) => formatInteger(row.level_count || 0) },
      { label: "Share", render: (row) => formatPercent(row.share_of_picks || 0, 1) }
    ],
    "No pick-vs-bulk activity matches the selected range."
  );
}

function renderBinSizes(reports) {
  renderTable(
    binSizeWrap,
    Array.isArray(reports?.bin_size_breakdown) ? reports.bin_size_breakdown : [],
    [
      { label: "Bin size", render: (row) => `<strong>${escapeHtml(row.bin_size || "Unknown")}</strong>` },
      { label: "Picks", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "Qty", render: (row) => formatInteger(row.pick_qty || 0) },
      { label: "Locations", render: (row) => formatInteger(row.location_count || 0) },
      { label: "SKUs", render: (row) => formatInteger(row.sku_count || 0) },
      { label: "Levels", render: (row) => formatInteger(row.level_count || 0) },
      { label: "Share", render: (row) => formatPercent(row.share_of_picks || 0, 1) }
    ],
    "No bin-size activity matches the selected range."
  );
}

function renderHighLevelSkus(reports) {
  const threshold = reports?.meta?.high_level_threshold || 10;
  renderTable(
    highLevelSkusWrap,
    Array.isArray(reports?.high_level_skus) ? reports.high_level_skus : [],
    [
      { label: "SKU", render: (row) => `<strong>${escapeHtml(row.sku)}</strong>` },
      { label: "Description", render: (row) => escapeHtml(row.description || "No description") },
      { label: `Level ${threshold}+ picks`, render: (row) => formatInteger(row.high_level_pick_count || 0) },
      { label: `Level ${threshold}+ qty`, render: (row) => formatInteger(row.high_level_pick_qty || 0) },
      { label: "All picks", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "High-level share", render: (row) => formatPercent(row.high_level_share_of_sku_picks || 0, 1) },
      { label: "Lowest", render: (row) => formatInteger(row.lowest_level || 0) },
      { label: "Highest", render: (row) => formatInteger(row.highest_level || 0) }
    ],
    `No SKU activity was found on level ${threshold}+ for the selected range.`
  );
}

function renderReplenishment(reports) {
  if (!replenishmentWrap) return;
  const meta = reports?.meta || {};
  const summary = reports?.replenishment?.summary || {};
  const rows = Array.isArray(reports?.replenishment?.locations) ? reports.replenishment.locations : [];
  const warehouseSnapshotDate = meta.warehouse_snapshot_date || "unknown date";
  const maxBinQtyReady = Boolean(meta.warehouse_supports_max_bin_qty);
  const noteHtml = maxBinQtyReady
    ? (summary.locations_missing_max || 0) > 0
      ? `<p class="reports-inline-note">Some replenishment rows still do not have <strong>Max. Bin Qty</strong> in the current warehouse snapshot from ${escapeHtml(warehouseSnapshotDate)}.</p>`
      : ""
    : `<p class="reports-inline-note">The current warehouse snapshot from <strong>${escapeHtml(warehouseSnapshotDate)}</strong> does not include <strong>Max. Bin Qty</strong> yet. Run <code>PI-App</code> again so it republishes the warehouse snapshot with <code>BLMAXQ</code>.</p>`;
  const summaryHtml = `
    <div class="reports-summary-wrap" style="margin-bottom:1rem;">
      <article class="reports-summary-card__item">
        <span class="eyebrow">Estimated replenishments</span>
        <strong>${formatInteger(summary.estimated_replenishment_count || 0)}</strong>
        <p>Refill estimate based on current pick-bin matches and Max. Bin Qty.</p>
      </article>
      <article class="reports-summary-card__item">
        <span class="eyebrow">Tracked locations</span>
        <strong>${formatInteger(summary.location_count || 0)}</strong>
        <p>Pick-bin SKU locations matched against the current warehouse snapshot.</p>
      </article>
      <article class="reports-summary-card__item">
        <span class="eyebrow">With Max. Bin Qty</span>
        <strong>${formatInteger(summary.locations_with_max || 0)}</strong>
        <p>These rows have the capacity figure needed for a real replenishment estimate.</p>
      </article>
      <article class="reports-summary-card__item">
        <span class="eyebrow">Missing Max. Bin Qty</span>
        <strong>${formatInteger(summary.locations_missing_max || 0)}</strong>
        <p>These rows are tracked, but need the upstream warehouse snapshot to include Max. Bin Qty before they can be estimated.</p>
      </article>
    </div>
  `;

  const tableHost = document.createElement("div");
  renderTable(
    tableHost,
    rows,
    [
      { label: "Location", render: (row) => `<strong>${escapeHtml(row.location)}</strong>` },
      { label: "SKU", render: (row) => escapeHtml(row.sku || "-") },
      { label: "Level", render: (row) => escapeHtml(row.level || "-") },
      { label: "Bin size", render: (row) => escapeHtml(row.bin_size || "-") },
      { label: "Max. Bin Qty", render: (row) => row.max_bin_qty ? formatInteger(row.max_bin_qty) : "Not in snapshot" },
      { label: "Pick Qty", render: (row) => formatInteger(row.pick_qty || 0) },
      { label: "Pick Count", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "Est. Replenishments", render: (row) => formatInteger(row.estimated_replenishments || 0) }
    ],
    "No replenishment estimate rows are available for the selected range."
  );

  replenishmentWrap.innerHTML = `${noteHtml}${summaryHtml}${tableHost.innerHTML}`;
}

function renderDailyBreakdown(reports) {
  renderTable(
    dailyWrap,
    Array.isArray(reports?.daily_breakdown) ? reports.daily_breakdown : [],
    [
      { label: "Date", render: (row) => `<strong>${escapeHtml(row.date)}</strong>` },
      { label: "Picks", render: (row) => formatInteger(row.pick_count || 0) },
      { label: "Qty", render: (row) => formatInteger(row.pick_qty || 0) },
      { label: "Locations", render: (row) => formatInteger(row.location_count || 0) },
      { label: "Aisles", render: (row) => formatInteger(row.aisle_count || 0) },
      { label: "SKUs", render: (row) => formatInteger(row.sku_count || 0) },
      { label: "Avg qty / pick", render: (row) => formatDecimal(row.avg_qty_per_pick || 0, 2) }
    ],
    "No daily snapshot rows are available for the selected range."
  );
}

function renderReports(reports) {
  renderHeroChips(reports);
  renderMetrics(reports);
  renderSummary(reports);
  renderRecommendationsSummary(reports);
  renderMoveLower(reports);
  renderBulkToPick(reports);
  renderAbcVelocity(reports);
  renderLevelCompliance(reports);
  renderPickFaceSuitability(reports);
  renderTopSkus(reports);
  renderSkuOutliers(reports);
  renderLocationOutliers(reports);
  renderTopLocations(reports);
  renderTopAisles(reports);
  renderLevelBreakdown(reports);
  renderBinTypes(reports);
  renderBinSizes(reports);
  renderHighLevelSkus(reports);
  renderReplenishment(reports);
  renderDailyBreakdown(reports);
}

async function loadReports() {
  syncModeUi();
  setStatus("Loading reports...");

  try {
    const query = buildReportsQuery();
    const data = await apiFetch(`/api/admin/picking-reports${query}`);
    const reports = data.reports || {
      meta: {},
      summary: {},
      top_skus: [],
      top_locations: [],
      top_aisles: [],
      sku_outliers: [],
      location_outliers: [],
      level_breakdown: [],
      bin_type_breakdown: [],
      bin_size_breakdown: [],
      high_level_skus: [],
      replenishment: { summary: {}, locations: [] },
      recommendations: {
        summary: {},
        abc_velocity: { summary: [], skus: [] },
        slotting: { move_lower: [], move_to_pick_bin: [] },
        level_compliance: { summary: {}, easy_wins: [] },
        pick_face_suitability: []
      },
      daily_breakdown: []
    };
    const meta = reports.meta || {};

    updateDateOptions(meta.available_pick_dates || [], meta.pick_requested_end_date || meta.latest_pick_snapshot_date || "");

    if (startDateInput && meta.pick_requested_start_date) {
      startDateInput.value = meta.pick_requested_start_date;
    }
    if (endDateInput && meta.pick_requested_end_date) {
      endDateInput.value = meta.pick_requested_end_date;
    }

    renderReports(reports);

    if (!Array.isArray(meta.available_pick_dates) || !meta.available_pick_dates.length) {
      setStatus("No pick snapshots available");
      return;
    }

    if (Number(meta.pick_available_day_count || 0) === 0) {
      setStatus("No snapshots in selected range");
      return;
    }

    setStatus(`${formatInteger(meta.pick_available_day_count || 0)} day(s) loaded`, "ok");
  } catch (error) {
    setStatus("Could not load reports");
    if (summaryWrap) {
      summaryWrap.innerHTML = `<p class="admin-empty">${escapeHtml(error.message || "Could not load the reports.")}</p>`;
    }
    if (recommendationsSummaryWrap) {
      recommendationsSummaryWrap.innerHTML = `<p class="admin-empty">${escapeHtml(error.message || "Could not load the recommendation summary.")}</p>`;
    }
    [moveLowerWrap, bulkToPickWrap, abcVelocityWrap, levelComplianceWrap, pickFaceSuitabilityWrap, topSkusWrap, skuOutliersWrap, locationOutliersWrap, topLocationsWrap, topAislesWrap, levelBreakdownWrap, binTypeWrap, binSizeWrap, highLevelSkusWrap, replenishmentWrap, dailyWrap].forEach((wrapper) => {
      if (wrapper) {
        wrapper.innerHTML = '<p class="admin-empty">Could not load this report section.</p>';
      }
    });
    window.ItemTracker?.toast(error.message || "Could not load the picking reports", "error");
  }
}

function wireEvents() {
  reportTabs.forEach((button) => {
    button.addEventListener("click", () => {
      activateReportTab(button.dataset.reportTab || "overview");
    });
  });
  clientSelect?.addEventListener("change", () => {
    navigateToSelectedClient();
  });
  modeSelect?.addEventListener("change", loadReports);
  dateSelect?.addEventListener("change", () => {
    if (String(modeSelect?.value || "latest").trim().toLowerCase() === "date") {
      loadReports();
    }
  });
  startDateInput?.addEventListener("change", () => {
    if (String(modeSelect?.value || "latest").trim().toLowerCase() === "custom") {
      loadReports();
    }
  });
  endDateInput?.addEventListener("change", () => {
    if (String(modeSelect?.value || "latest").trim().toLowerCase() === "custom") {
      loadReports();
    }
  });
  rankBySelect?.addEventListener("change", loadReports);
  limitSelect?.addEventListener("change", loadReports);
  exportButton?.addEventListener("click", exportReportsWorkbook);
  reloadButton?.addEventListener("click", loadReports);
}

if (modeSelect) {
  let initialTab = "overview";
  try {
    initialTab = window.sessionStorage?.getItem("itemtracker.pickingReportsTab") || "overview";
  } catch (_error) {
    initialTab = "overview";
  }
  activateReportTab(initialTab);
  syncModeUi();
  updateClientAwareLinks();
  syncClientUrl();
  wireEvents();
  loadReports();
}
