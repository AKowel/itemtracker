import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const doc = typeof document !== "undefined" ? document : null;
const canvas = doc?.getElementById("heatmapCanvas") || null;
const modeSelect = doc?.getElementById("heatmapModeSelect") || null;
const dateField = doc?.getElementById("heatmapDateField") || null;
const dateSelect = doc?.getElementById("heatmapDateSelect") || null;
const startField = doc?.getElementById("heatmapStartField") || null;
const endField = doc?.getElementById("heatmapEndField") || null;
const startDateInput = doc?.getElementById("heatmapStartDate") || null;
const endDateInput = doc?.getElementById("heatmapEndDate") || null;
const metricSelect = doc?.getElementById("heatmapMetricSelect") || null;
const searchInput = doc?.getElementById("heatmapSearchInput") || null;
const pickedOnlyToggle = doc?.getElementById("heatmapPickedOnly") || null;
const occupiedOnlyToggle = doc?.getElementById("heatmapOccupiedOnly") || null;
const reloadButton = doc?.getElementById("heatmapReloadButton") || null;
const statusChip = doc?.getElementById("heatmapStatusChip") || null;
const dateChip = doc?.getElementById("heatmapDateChip") || null;
const snapshotStatusChip = doc?.getElementById("heatmapSnapshotStatusChip") || null;
const locationChip = doc?.getElementById("heatmapLocationChip") || null;
const pickChip = doc?.getElementById("heatmapPickChip") || null;
const occupiedMetric = doc?.getElementById("heatmapOccupiedMetric") || null;
const pickedMetric = doc?.getElementById("heatmapPickedMetric") || null;
const snapshotInfo = doc?.getElementById("heatmapSnapshotInfo") || null;
const detailCard = doc?.getElementById("heatmapDetailCard") || null;
const detailHint = doc?.getElementById("heatmapDetailHint") || null;
const hotAislesWrap = doc?.getElementById("heatmapHotAisles") || null;

const state = {
  heatmap: null,
  rows: [],
  selectedLocation: "",
  sceneRows: [],
  aisleCoords: new Map()
};

const sceneState = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  rackMesh: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  selectionBox: null,
  labelGroup: null,
  floorGroup: null
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function apiFetch(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function setStatus(message, type) {
  if (!statusChip) return;
  statusChip.textContent = message || "Ready";
  statusChip.classList.toggle("chip--inactive", type !== "ok");
}

function buildAisleCoords(layout, rows) {
  const aisleStats = new Map();
  for (const row of rows || []) {
    const prefix = String(row.aisle_prefix || "").trim().toUpperCase();
    if (!prefix) continue;
    const current = aisleStats.get(prefix) || { maxBay: 0 };
    current.maxBay = Math.max(current.maxBay, Number.parseInt(row.bay || "0", 10) || 0);
    aisleStats.set(prefix, current);
  }

  const coords = new Map();
  let zoneOffsetX = 0;
  const aisleSpacing = 5.2;
  const zoneGap = 16;

  for (const [zoneIndex, zone] of (layout?.zones || []).entries()) {
    const aisles = zone?.aisles || [];
    const zoneStartX = zoneOffsetX;
    let zoneMaxBay = 0;
    aisles.forEach((aisle, aisleIndex) => {
      const prefix = aisle.prefix;
      const maxBay = Math.max(20, aisleStats.get(prefix)?.maxBay || 20);
      zoneMaxBay = Math.max(zoneMaxBay, maxBay);
      coords.set(prefix, {
        x: zoneOffsetX + aisleIndex * aisleSpacing,
        zoneIndex,
        zoneKey: zone.zone_key || "",
        zoneLabel: zone.zone_label || ""
      });
    });
    const zoneWidth = Math.max(aisles.length - 1, 0) * aisleSpacing + 4;
    zone.layout = {
      x: zoneStartX + zoneWidth / 2 - 2,
      width: zoneWidth,
      depth: Math.max(26, zoneMaxBay * 1.16 + 8)
    };
    zoneOffsetX += aisles.length * aisleSpacing + zoneGap;
  }

  return coords;
}

function metricValue(row, metricKey) {
  if (metricKey === "pick_qty") {
    return Number(row.pick_qty || 0);
  }
  return Number(row.pick_count || 0);
}

function heatColor(row, metricKey, maxMetric) {
  const metric = metricValue(row, metricKey);
  if (metric <= 0) {
    return new THREE.Color(row.sku ? "#567180" : "#2b3742");
  }
  const ratio = Math.min(1, metric / Math.max(1, maxMetric));
  const hue = 0.62 - ratio * 0.62;
  const saturation = 0.85;
  const lightness = 0.42 + ratio * 0.14;
  return new THREE.Color().setHSL(hue, saturation, lightness);
}

function makeTextSprite(label) {
  const canvasEl = document.createElement("canvas");
  canvasEl.width = 256;
  canvasEl.height = 96;
  const ctx = canvasEl.getContext("2d");
  ctx.fillStyle = "rgba(12, 20, 35, 0.82)";
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.strokeStyle = "rgba(136, 173, 255, 0.85)";
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, canvasEl.width - 6, canvasEl.height - 6);
  ctx.fillStyle = "#f4f7ff";
  ctx.font = "700 42px Georgia";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvasEl.width / 2, canvasEl.height / 2);

  const texture = new THREE.CanvasTexture(canvasEl);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6, 2.25, 1);
  return sprite;
}

function initScene() {
  if (sceneState.renderer) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth || canvas.parentElement.clientWidth, 620, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b1523");
  scene.fog = new THREE.Fog("#0b1523", 55, 220);

  const camera = new THREE.PerspectiveCamera(52, (canvas.clientWidth || 1200) / 620, 0.1, 1000);
  camera.position.set(38, 42, 58);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minDistance = 12;
  controls.maxDistance = 250;

  const ambient = new THREE.AmbientLight("#dce6ff", 1.15);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight("#ffffff", 1.15);
  keyLight.position.set(40, 80, 40);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight("#7ab4ff", 0.55);
  fillLight.position.set(-45, 35, -20);
  scene.add(fillLight);

  const grid = new THREE.GridHelper(280, 80, "#24405d", "#162536");
  grid.position.y = -0.1;
  scene.add(grid);

  const selectionBox = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshBasicMaterial({ color: "#ffffff", wireframe: true })
  );
  selectionBox.visible = false;
  scene.add(selectionBox);

  const labelGroup = new THREE.Group();
  scene.add(labelGroup);

  const floorGroup = new THREE.Group();
  scene.add(floorGroup);

  renderer.domElement.addEventListener("click", handleSceneClick);
  window.addEventListener("resize", resizeScene);

  sceneState.renderer = renderer;
  sceneState.scene = scene;
  sceneState.camera = camera;
  sceneState.controls = controls;
  sceneState.selectionBox = selectionBox;
  sceneState.labelGroup = labelGroup;
  sceneState.floorGroup = floorGroup;

  animate();
}

function resizeScene() {
  if (!sceneState.renderer || !sceneState.camera) return;
  const width = canvas.clientWidth || canvas.parentElement.clientWidth || 1200;
  const height = canvas.clientHeight || 620;
  sceneState.renderer.setSize(width, height, false);
  sceneState.camera.aspect = width / height;
  sceneState.camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (!sceneState.renderer) return;
  sceneState.controls.update();
  sceneState.renderer.render(sceneState.scene, sceneState.camera);
}

function clearSceneContent() {
  if (sceneState.rackMesh) {
    sceneState.scene.remove(sceneState.rackMesh);
    sceneState.rackMesh.geometry.dispose();
    sceneState.rackMesh.material.dispose();
    sceneState.rackMesh = null;
  }
  sceneState.labelGroup.clear();
  sceneState.floorGroup.clear();
  sceneState.selectionBox.visible = false;
  state.sceneRows = [];
}

function buildScene(rows, layout, metricKey) {
  clearSceneContent();

  const coords = buildAisleCoords(layout, rows);
  state.aisleCoords = coords;
  const maxMetric = rows.reduce((max, row) => Math.max(max, metricValue(row, metricKey)), 0);

  const geometry = new THREE.BoxGeometry(1.05, 1.05, 0.8);
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.4,
    metalness: 0.12
  });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(rows.length, 1));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const dummy = new THREE.Object3D();
  rows.forEach((row, index) => {
    const aisle = coords.get(row.aisle_prefix) || { x: 0, zoneIndex: 0 };
    const bayNumber = Number.parseInt(row.bay || "0", 10) || 0;
    const levelNumber = Number.parseInt(row.level || "0", 10) || 0;
    const slotNumber = Number.parseInt(row.slot || "1", 10) || 1;
    const slotOffset = ((slotNumber - 1) % 2 === 0 ? -0.52 : 0.52);
    const x = aisle.x + slotOffset;
    const y = Math.max(0.5, Math.round(levelNumber / 10) * 1.18 + 0.6);
    const z = -(bayNumber * 1.18);

    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.setColorAt(index, heatColor(row, metricKey, maxMetric));
    state.sceneRows[index] = { ...row, _position: { x, y, z } };
  });

  mesh.count = rows.length;
  sceneState.scene.add(mesh);
  sceneState.rackMesh = mesh;

  for (const zone of layout?.zones || []) {
    const zoneAisles = zone.aisles || [];
    if (!zoneAisles.length) continue;
    const zoneMeta = zone.layout || null;
    if (zoneMeta) {
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(zoneMeta.width, 0.4, zoneMeta.depth),
        new THREE.MeshPhongMaterial({
          color: zone.zone_key === "zone_1" ? "#12243a" : "#142b22",
          transparent: true,
          opacity: 0.48
        })
      );
      floor.position.set(zoneMeta.x, -0.35, -zoneMeta.depth / 2 + 4);
      sceneState.floorGroup.add(floor);

      const zoneSprite = makeTextSprite(zone.zone_label || zone.zone_key || "Zone");
      zoneSprite.position.set(zoneMeta.x, 0.8, 6);
      sceneState.labelGroup.add(zoneSprite);
    }

    zoneAisles.forEach((aisle, index) => {
      if (index % 2 !== 0) return;
      const coord = coords.get(aisle.prefix);
      if (!coord) return;
      const sprite = makeTextSprite(aisle.prefix);
      sprite.position.set(coord.x, 1.4, 1.5);
      sceneState.labelGroup.add(sprite);
    });
  }

  fitCamera(rows);
}

function fitCamera(rows) {
  if (!rows.length) return;
  const xs = state.sceneRows.map((row) => row._position.x);
  const ys = state.sceneRows.map((row) => row._position.y);
  const zs = state.sceneRows.map((row) => row._position.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  sceneState.camera.position.set(centerX + spanX * 0.72 + 26, maxY + 28, centerZ + spanZ * 0.44 + 26);
  sceneState.controls.target.set(centerX, maxY * 0.3, centerZ);
  sceneState.controls.update();
}

function getFilteredRows() {
  if (!state.heatmap?.rows) return [];
  const q = String(searchInput.value || "").trim().toUpperCase();
  const pickedOnly = pickedOnlyToggle.checked;
  const occupiedOnly = occupiedOnlyToggle.checked;
  return state.heatmap.rows.filter((row) => {
    if (pickedOnly && !(Number(row.pick_count || 0) > 0 || Number(row.pick_qty || 0) > 0)) {
      return false;
    }
    if (occupiedOnly && !String(row.sku || "").trim()) {
      return false;
    }
    if (q) {
      const haystack = [row.location, row.sku, row.description, row.aisle_prefix].join(" ").toUpperCase();
      if (!haystack.includes(q)) {
        return false;
      }
    }
    return true;
  });
}

function renderHotAisles(rows) {
  if (!hotAislesWrap) return;
  const byAisle = new Map();
  rows.forEach((row) => {
    const aisle = row.aisle_prefix || "Unknown";
    const item = byAisle.get(aisle) || { aisle_prefix: aisle, pick_count: 0, pick_qty: 0, occupied: 0 };
    item.pick_count += Number(row.pick_count || 0);
    item.pick_qty += Number(row.pick_qty || 0);
    if (row.sku) item.occupied += 1;
    byAisle.set(aisle, item);
  });
  const hottest = Array.from(byAisle.values())
    .sort((a, b) => (b.pick_count - a.pick_count) || (b.pick_qty - a.pick_qty))
    .slice(0, 8);

  if (!hottest.length) {
    hotAislesWrap.innerHTML = '<p class="admin-empty">No aisle heat data for the current filters.</p>';
    return;
  }

  hotAislesWrap.innerHTML = hottest.map((row) => (
    `<article class="heatmap-hot-aisle">
      <strong>${escapeHtml(row.aisle_prefix)}</strong>
      <span>${Number(row.pick_count || 0).toLocaleString()} picks</span>
      <span>${Number(row.pick_qty || 0).toLocaleString()} units</span>
    </article>`
  )).join("");
}

function renderSnapshotInfo(meta = {}) {
  if (!snapshotInfo) return;

  const availableDates = Array.isArray(meta.available_pick_dates) ? meta.available_pick_dates.filter(Boolean) : [];
  const loadedDates = Array.isArray(meta.pick_loaded_dates) ? meta.pick_loaded_dates.filter(Boolean) : [];
  const missingDates = Array.isArray(meta.pick_missing_dates) ? meta.pick_missing_dates.filter(Boolean) : [];
  const latestDate = String(meta.latest_pick_snapshot_date || "").trim();
  const requestedStart = String(meta.pick_requested_start_date || "").trim();
  const requestedEnd = String(meta.pick_requested_end_date || "").trim();
  const snapshotMeta = meta.pick_snapshot_meta || {};
  const uploadedAt = String(snapshotMeta.uploaded_at || "").trim();
  const sourceSyncedAt = String(snapshotMeta.source_synced_at || "").trim();

  if (!availableDates.length) {
    snapshotInfo.innerHTML = [
      "<strong>No pick snapshots published yet.</strong>",
      "<span>The heatmap is ready, but PocketBase does not have any published pick-day files yet.</span>",
      "<span>Restart the PI-App sync machine or wait for the daily snapshot publish to complete.</span>"
    ].join("");
    return;
  }

  const requestedLabel =
    requestedStart && requestedEnd
      ? requestedStart === requestedEnd
        ? requestedStart
        : `${requestedStart} to ${requestedEnd}`
      : latestDate || "Latest available day";
  const missingLabel = missingDates.length
    ? missingDates.slice(0, 6).join(", ") + (missingDates.length > 6 ? ` +${missingDates.length - 6} more` : "")
    : "None";

  snapshotInfo.innerHTML = [
    `<strong>Requested range: ${escapeHtml(requestedLabel)}</strong>`,
    `<span>Available pick days: ${availableDates.length.toLocaleString()} total.</span>`,
    `<span>Loaded into this view: ${loadedDates.length.toLocaleString()} day(s).</span>`,
    `<span>Latest published day: ${escapeHtml(latestDate || "Unknown")}.</span>`,
    `<span>Missing from this range: ${escapeHtml(missingLabel)}.</span>`,
    uploadedAt ? `<span>Last uploaded to PocketBase: ${escapeHtml(uploadedAt)}.</span>` : "",
    sourceSyncedAt ? `<span>Source synced from PI-App: ${escapeHtml(sourceSyncedAt)}.</span>` : ""
  ].filter(Boolean).join("");
}

function renderStats(rows) {
  if (!occupiedMetric || !pickedMetric || !locationChip || !pickChip || !dateChip) return;
  const meta = state.heatmap?.meta || {};
  const occupied = rows.filter((row) => row.sku).length;
  const picked = rows.filter((row) => Number(row.pick_count || 0) > 0 || Number(row.pick_qty || 0) > 0).length;
  const picks = rows.reduce((sum, row) => sum + Number(row.pick_count || 0), 0);
  const rangeMode = String(meta.pick_range_mode || "latest").trim().toLowerCase();
  const requestedStart = String(meta.pick_requested_start_date || "").trim();
  const requestedEnd = String(meta.pick_requested_end_date || "").trim();
  const latestDate = String(meta.latest_pick_snapshot_date || meta.pick_snapshot_date || meta.warehouse_snapshot_date || "").trim();
  const availableDates = Array.isArray(meta.available_pick_dates) ? meta.available_pick_dates.filter(Boolean) : [];
  const missingDates = Array.isArray(meta.pick_missing_dates) ? meta.pick_missing_dates.filter(Boolean) : [];
  const availableDayCount = Number(meta.pick_available_day_count || 0);

  occupiedMetric.textContent = occupied.toLocaleString();
  pickedMetric.textContent = picked.toLocaleString();
  locationChip.textContent = `${rows.length.toLocaleString()} locations`;
  pickChip.textContent = `${picks.toLocaleString()} picks`;

  if (!availableDates.length) {
    dateChip.textContent = "No pick snapshots yet";
  } else if (rangeMode !== "latest" && requestedStart && requestedEnd) {
    dateChip.textContent =
      requestedStart === requestedEnd
        ? `Snapshot ${requestedStart}`
        : `${requestedStart} to ${requestedEnd}`;
  } else if (latestDate) {
    dateChip.textContent = `Snapshot ${latestDate}`;
  } else {
    dateChip.textContent = "Snapshot unavailable";
  }

  if (snapshotStatusChip) {
    if (!availableDates.length) {
      snapshotStatusChip.textContent = "Waiting for snapshots";
      snapshotStatusChip.classList.add("chip--inactive");
    } else if (missingDates.length) {
      snapshotStatusChip.textContent = `${availableDayCount}/${Math.max(availableDayCount, Number(meta.pick_requested_day_count || 0))} days loaded`;
      snapshotStatusChip.classList.remove("chip--inactive");
    } else if (availableDayCount > 1) {
      snapshotStatusChip.textContent = `${availableDayCount} days loaded`;
      snapshotStatusChip.classList.remove("chip--inactive");
    } else {
      snapshotStatusChip.textContent = "1 day loaded";
      snapshotStatusChip.classList.remove("chip--inactive");
    }
  }

  renderSnapshotInfo(meta);
  renderHotAisles(rows);
}

function renderSelectionPlaceholder(message) {
  if (!detailCard) return;
  detailCard.innerHTML = `<strong class="heatmap-detail-card__empty">${escapeHtml(message)}</strong>`;
}

async function renderSelection(row) {
  if (!detailCard || !detailHint) return;
  if (!row) {
    detailHint.textContent = "Pick a location in the scene to load SKU and photo detail.";
    renderSelectionPlaceholder("No location selected yet.");
    return;
  }

  detailHint.textContent = `Selected ${row.location}`;
  let skuDetail = null;
  if (row.sku) {
    try {
      const data = await apiFetch(`/api/catalog/sku/${encodeURIComponent(row.sku)}`);
      skuDetail = data.sku || null;
    } catch (_) {
      skuDetail = null;
    }
  }

  const images = skuDetail?.images || [];
  const imageHtml = images.length
    ? `<div class="heatmap-detail-images">${images.slice(0, 4).map((image) => `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(row.sku)}" loading="lazy">`).join("")}</div>`
    : '<p class="heatmap-detail-muted">No SKU photos captured yet.</p>';
  const currentSkuLink = row.sku
    ? `<a class="ghost-button" href="/sku/${encodeURIComponent(row.sku)}">Open SKU</a>`
    : "";
  const topSkuHtml = Array.isArray(row.top_skus) && row.top_skus.length
    ? `<div class="heatmap-top-skus">${row.top_skus.map((item) => `<span class="chip chip--inactive">${escapeHtml(item.sku)} · ${Number(item.pick_count || 0)} picks</span>`).join("")}</div>`
    : '<p class="heatmap-detail-muted">No picked SKU activity recorded for this location in the selected view.</p>';

  detailCard.innerHTML = `
    <div class="heatmap-detail-head">
      <div>
        <p class="eyebrow">Location</p>
        <h3>${escapeHtml(row.location)}</h3>
      </div>
      ${currentSkuLink}
    </div>
    <div class="heatmap-detail-grid">
      <div><span>Aisle</span><strong>${escapeHtml(row.aisle_prefix || "—")}</strong></div>
      <div><span>Bay</span><strong>${escapeHtml(row.bay || "—")}</strong></div>
      <div><span>Level</span><strong>${escapeHtml(row.level || "—")}</strong></div>
      <div><span>Slot</span><strong>${escapeHtml(row.slot || "—")}</strong></div>
      <div><span>Pick count</span><strong>${Number(row.pick_count || 0).toLocaleString()}</strong></div>
      <div><span>Pick qty</span><strong>${Number(row.pick_qty || 0).toLocaleString()}</strong></div>
    </div>
    <div class="heatmap-detail-copy">
      <p class="eyebrow">Current SKU</p>
      <strong>${escapeHtml(row.sku || "Empty location")}</strong>
      <p>${escapeHtml(row.description || "No current SKU description available.")}</p>
      <span class="heatmap-detail-muted">Bin quantity: ${Number(row.qty || 0).toLocaleString()} · Photos: ${Number(row.image_count || 0).toLocaleString()}</span>
    </div>
    <div class="heatmap-detail-copy">
      <p class="eyebrow">Top Picked SKUs In This Location</p>
      ${topSkuHtml}
    </div>
    <div class="heatmap-detail-copy">
      <p class="eyebrow">SKU Photos</p>
      ${imageHtml}
    </div>
  `;
}

function applyFilters() {
  if (!state.heatmap) return;
  const rows = getFilteredRows();
  state.rows = rows;
  renderStats(rows);
  buildScene(rows, state.heatmap.layout, metricSelect.value);

  if (state.selectedLocation) {
    const selected = rows.find((row) => row.location === state.selectedLocation) || null;
    if (!selected) {
      state.selectedLocation = "";
      renderSelection(null);
    }
  }
  setStatus(`${rows.length.toLocaleString()} locations in view`, "ok");
}

function legacyUpdateDateOptions(availableDates, selectedDate) {
  if (!dateSelect) return;
  const current = dateSelect.value;
  dateSelect.innerHTML = '<option value="">Latest available</option>';
  const dates = Array.from(new Set((availableDates || []).filter(Boolean)));
  dates.forEach((date) => {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = date;
    dateSelect.appendChild(option);
  });
  dateSelect.value = selectedDate || current || "";
}

async function legacyLoadHeatmap() {
  setStatus("Loading heatmap…");
  try {
    const query = dateSelect.value ? `?date=${encodeURIComponent(dateSelect.value)}` : "";
    const data = await apiFetch(`/api/admin/picking-heatmap${query}`);
    state.heatmap = data.heatmap || { rows: [], layout: { zones: [] }, meta: {}, stats: {} };
    updateDateOptions(state.heatmap.meta?.available_pick_dates || [], state.heatmap.meta?.pick_snapshot_date || "");
    applyFilters();
  } catch (error) {
    setStatus("Could not load heatmap");
    renderSelectionPlaceholder(error.message || "Could not load the picking heatmap.");
    hotAislesWrap.innerHTML = '<p class="admin-empty">Could not load aisle heat data.</p>';
    window.ItemTracker?.toast(error.message || "Could not load the picking heatmap", "error");
  }
}

function handleSceneClick(event) {
  if (!canvas) return;
  if (!sceneState.rackMesh || !state.sceneRows.length) return;
  const rect = canvas.getBoundingClientRect();
  sceneState.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  sceneState.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  sceneState.raycaster.setFromCamera(sceneState.pointer, sceneState.camera);
  const hits = sceneState.raycaster.intersectObject(sceneState.rackMesh);
  if (!hits.length) return;
  const hit = hits[0];
  const row = state.sceneRows[hit.instanceId];
  if (!row) return;
  state.selectedLocation = row.location;
  sceneState.selectionBox.visible = true;
  sceneState.selectionBox.position.set(row._position.x, row._position.y, row._position.z);
  renderSelection(row);
}

function legacyWireEvents() {
  if (!dateSelect || !metricSelect || !searchInput || !pickedOnlyToggle || !occupiedOnlyToggle || !reloadButton) return;
  dateSelect.addEventListener("change", loadHeatmap);
  metricSelect.addEventListener("change", applyFilters);
  searchInput.addEventListener("input", applyFilters);
  pickedOnlyToggle.addEventListener("change", applyFilters);
  occupiedOnlyToggle.addEventListener("change", applyFilters);
  reloadButton.addEventListener("click", loadHeatmap);
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

function buildHeatmapQuery() {
  const params = new URLSearchParams();
  const mode = String(modeSelect?.value || "latest").trim().toLowerCase() || "latest";
  params.set("mode", mode);

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

  const query = params.toString();
  return query ? `?${query}` : "";
}

async function loadHeatmap() {
  syncModeUi();
  setStatus("Loading heatmap...");
  try {
    const query = buildHeatmapQuery();
    const data = await apiFetch(`/api/admin/picking-heatmap${query}`);
    state.heatmap = data.heatmap || { rows: [], layout: { zones: [] }, meta: {}, stats: {} };
    const meta = state.heatmap.meta || {};
    updateDateOptions(meta.available_pick_dates || [], meta.pick_snapshot_date || meta.latest_pick_snapshot_date || "");

    if (startDateInput && meta.pick_requested_start_date) {
      startDateInput.value = meta.pick_requested_start_date;
    }
    if (endDateInput && meta.pick_requested_end_date) {
      endDateInput.value = meta.pick_requested_end_date;
    }

    applyFilters();

    if (!Array.isArray(meta.available_pick_dates) || !meta.available_pick_dates.length) {
      renderSelectionPlaceholder("No pick snapshots have been published yet. Restart the PI-App sync machine or wait for the next publish window.");
      if (hotAislesWrap) {
        hotAislesWrap.innerHTML = '<p class="admin-empty">No pick snapshots have been published yet.</p>';
      }
      setStatus("No pick snapshots available");
      return;
    }

    if (Number(meta.pick_available_day_count || 0) === 0) {
      renderSelectionPlaceholder("No pick snapshots match the selected day or range yet.");
      if (hotAislesWrap) {
        hotAislesWrap.innerHTML = '<p class="admin-empty">No pick snapshots match the selected range.</p>';
      }
      setStatus("No snapshots in selected range");
      return;
    }

    if (!state.selectedLocation) {
      renderSelection(null);
    }
  } catch (error) {
    setStatus("Could not load heatmap");
    renderSelectionPlaceholder(error.message || "Could not load the picking heatmap.");
    renderSnapshotInfo({});
    if (hotAislesWrap) {
      hotAislesWrap.innerHTML = '<p class="admin-empty">Could not load aisle heat data.</p>';
    }
    window.ItemTracker?.toast(error.message || "Could not load the picking heatmap", "error");
  }
}

function wireEvents() {
  if (!metricSelect || !searchInput || !pickedOnlyToggle || !occupiedOnlyToggle || !reloadButton) return;
  modeSelect?.addEventListener("change", () => {
    syncModeUi();
    loadHeatmap();
  });
  dateSelect?.addEventListener("change", () => {
    if (String(modeSelect?.value || "latest").trim().toLowerCase() === "date") {
      loadHeatmap();
    }
  });
  startDateInput?.addEventListener("change", () => {
    if (String(modeSelect?.value || "latest").trim().toLowerCase() === "custom") {
      loadHeatmap();
    }
  });
  endDateInput?.addEventListener("change", () => {
    if (String(modeSelect?.value || "latest").trim().toLowerCase() === "custom") {
      loadHeatmap();
    }
  });
  metricSelect.addEventListener("change", applyFilters);
  searchInput.addEventListener("input", applyFilters);
  pickedOnlyToggle.addEventListener("change", applyFilters);
  occupiedOnlyToggle.addEventListener("change", applyFilters);
  reloadButton.addEventListener("click", loadHeatmap);
}

if (canvas) {
  initScene();
  syncModeUi();
  wireEvents();
  loadHeatmap();
}
