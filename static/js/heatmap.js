import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const doc = typeof document !== "undefined" ? document : null;
const layoutRoot = doc?.getElementById("heatmapLayout") || null;
const canvas = doc?.getElementById("heatmapCanvas") || null;
const modeSelect = doc?.getElementById("heatmapModeSelect") || null;
const clientSelect = doc?.getElementById("heatmapClientSelect") || null;
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
const cameraModeSelect = doc?.getElementById("heatmapCameraModeSelect") || null;
const colourModeSelect = doc?.getElementById("heatmapColourModeSelect") || null;
const levelMinInput = doc?.getElementById("heatmapLevelMin") || null;
const levelMaxInput = doc?.getElementById("heatmapLevelMax") || null;
const levelResetButton = doc?.getElementById("heatmapLevelResetButton") || null;
const resetCameraButton = doc?.getElementById("heatmapResetCameraButton") || null;
const fullscreenButton = doc?.getElementById("heatmapFullscreenButton") || null;
const reloadButton = doc?.getElementById("heatmapReloadButton") || null;
const statusChip = doc?.getElementById("heatmapStatusChip") || null;
const dateChip = doc?.getElementById("heatmapDateChip") || null;
const snapshotStatusChip = doc?.getElementById("heatmapSnapshotStatusChip") || null;
const locationChip = doc?.getElementById("heatmapLocationChip") || null;
const pickChip = doc?.getElementById("heatmapPickChip") || null;
const occupiedMetric = doc?.getElementById("heatmapOccupiedMetric") || null;
const pickedMetric = doc?.getElementById("heatmapPickedMetric") || null;
const snapshotInfo = doc?.getElementById("heatmapSnapshotInfo") || null;
const recommendationInfo = doc?.getElementById("heatmapRecommendationInfo") || null;
const detailCard = doc?.getElementById("heatmapDetailCard") || null;
const detailHint = doc?.getElementById("heatmapDetailHint") || null;
const hotAislesWrap = doc?.getElementById("heatmapHotAisles") || null;
const sceneHint = doc?.getElementById("heatmapSceneHint") || null;
const legend = doc?.querySelector(".heatmap-legend") || null;
const legendBar = doc?.querySelector(".heatmap-legend__bar") || null;
const legendLabels = Array.from(doc?.querySelectorAll(".heatmap-legend__labels span") || []);
const fpsOverlay = doc?.getElementById("heatmapFpsOverlay") || null;
const fpsModeChip = doc?.getElementById("heatmapFpsModeChip") || null;
const playbackPrevButton = doc?.getElementById("heatmapPlaybackPrevButton") || null;
const playbackToggleButton = doc?.getElementById("heatmapPlaybackToggleButton") || null;
const playbackNextButton = doc?.getElementById("heatmapPlaybackNextButton") || null;
const playbackResetButton = doc?.getElementById("heatmapPlaybackResetButton") || null;
const playbackSpeedSelect = doc?.getElementById("heatmapPlaybackSpeedSelect") || null;
const playbackStatusChip = doc?.getElementById("heatmapPlaybackStatusChip") || null;
const timelineRange = doc?.getElementById("heatmapTimelineRange") || null;
const timelineLabel = doc?.getElementById("heatmapTimelineLabel") || null;
const timelineMeta = doc?.getElementById("heatmapTimelineMeta") || null;
const timelineStartLabel = doc?.getElementById("heatmapTimelineStartLabel") || null;
const timelineCurrentLabel = doc?.getElementById("heatmapTimelineCurrentLabel") || null;
const timelineEndLabel = doc?.getElementById("heatmapTimelineEndLabel") || null;
const clientAwareLinks = Array.from(doc?.querySelectorAll("[data-client-aware-link]") || []);

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

// ── Scene settings (localStorage) ────────────────────────────────────────────

const SETTINGS_STORAGE_KEY = "itemtracker.heatmap.settings";
const SETTINGS_DEFAULTS = { rotateSpeed: 1.0, zoomSpeed: 1.0, panSpeed: 1.0, wasdSpeed: 1.0 };
let sceneSettings = { ...SETTINGS_DEFAULTS };

function loadSceneSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) sceneSettings = { ...SETTINGS_DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {}
}

function saveSceneSettings() {
  try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sceneSettings)); } catch (_) {}
}

function applyControlsSettings(controls) {
  if (!controls) return;
  controls.rotateSpeed = sceneSettings.rotateSpeed;
  controls.zoomSpeed = sceneSettings.zoomSpeed;
  controls.panSpeed = sceneSettings.panSpeed;
}

function applySceneSettings() {
  applyControlsSettings(sceneState.orbitControls);
  applyControlsSettings(sceneState.topControls);
}

const settingsPanel      = doc?.getElementById("heatmapSettingsPanel")   || null;
const settingsButton     = doc?.getElementById("heatmapSettingsButton")   || null;
const settingsClose      = doc?.getElementById("heatmapSettingsClose")    || null;
const settingsReset      = doc?.getElementById("heatmapSettingsReset")    || null;
const rotateSpeedInput   = doc?.getElementById("rotateSpeedInput")        || null;
const zoomSpeedInput     = doc?.getElementById("zoomSpeedInput")          || null;
const panSpeedInput      = doc?.getElementById("panSpeedInput")           || null;
const wasdSpeedInput     = doc?.getElementById("wasdSpeedInput")          || null;
const rotateSpeedLabel   = doc?.getElementById("rotateSpeedLabel")        || null;
const zoomSpeedLabel     = doc?.getElementById("zoomSpeedLabel")          || null;
const panSpeedLabel      = doc?.getElementById("panSpeedLabel")           || null;
const wasdSpeedLabel     = doc?.getElementById("wasdSpeedLabel")          || null;

function syncSettingsPanel() {
  if (rotateSpeedInput) rotateSpeedInput.value = String(sceneSettings.rotateSpeed);
  if (zoomSpeedInput)   zoomSpeedInput.value   = String(sceneSettings.zoomSpeed);
  if (panSpeedInput)    panSpeedInput.value     = String(sceneSettings.panSpeed);
  if (wasdSpeedInput)   wasdSpeedInput.value    = String(sceneSettings.wasdSpeed);
  if (rotateSpeedLabel) rotateSpeedLabel.textContent = sceneSettings.rotateSpeed.toFixed(1);
  if (zoomSpeedLabel)   zoomSpeedLabel.textContent   = sceneSettings.zoomSpeed.toFixed(1);
  if (panSpeedLabel)    panSpeedLabel.textContent     = sceneSettings.panSpeed.toFixed(1);
  if (wasdSpeedLabel)   wasdSpeedLabel.textContent    = sceneSettings.wasdSpeed.toFixed(1) + "×";
}

function wireSettingsPanel() {
  settingsButton?.addEventListener("click", () => {
    if (settingsPanel) settingsPanel.hidden = !settingsPanel.hidden;
  });
  settingsClose?.addEventListener("click", () => {
    if (settingsPanel) settingsPanel.hidden = true;
  });
  settingsReset?.addEventListener("click", () => {
    sceneSettings = { ...SETTINGS_DEFAULTS };
    syncSettingsPanel();
    applySceneSettings();
    saveSceneSettings();
  });

  function makeSliderHandler(inputEl, labelEl, key, suffix) {
    if (!inputEl) return;
    inputEl.addEventListener("input", () => {
      const val = parseFloat(inputEl.value) || SETTINGS_DEFAULTS[key];
      sceneSettings[key] = val;
      if (labelEl) labelEl.textContent = val.toFixed(1) + (suffix || "");
      applySceneSettings();
      saveSceneSettings();
    });
  }

  makeSliderHandler(rotateSpeedInput, rotateSpeedLabel, "rotateSpeed", "");
  makeSliderHandler(zoomSpeedInput,   zoomSpeedLabel,   "zoomSpeed",   "");
  makeSliderHandler(panSpeedInput,    panSpeedLabel,    "panSpeed",    "");
  makeSliderHandler(wasdSpeedInput,   wasdSpeedLabel,   "wasdSpeed",   "×");
}

const BAY_STEP = 2.6;
const AISLE_HALF = 1.5;
const SHELF_GAP = 0.03;
const CAMERA_MODES = new Set(["orbit", "top", "fps"]);
const COLOUR_MODES = new Set(["heatmap", "recommendation", "prime", "binsize", "zone", "level"]);

const state = {
  heatmap: null,
  rows: [],
  selectedLocation: "",
  sceneRows: [],
  aisleCoords: new Map(),
  isFullscreen: false,
  cameraMode: CAMERA_MODES.has(cameraModeSelect?.value) ? cameraModeSelect.value : "orbit",
  colourMode: COLOUR_MODES.has(colourModeSelect?.value) ? colourModeSelect.value : "heatmap",
  playback: {
    active: false,
    playing: false,
    index: 0,
    speedMs: Number.parseInt(playbackSpeedSelect?.value || "1000", 10) || 1000,
    timer: null
  }
};

const sceneState = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  perspCamera: null,
  topCamera: null,
  fpsCamera: null,
  orbitControls: null,
  topControls: null,
  rackMesh: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  selectionBox: null,
  labelGroup: null,
  floorGroup: null,
  movementKeys: new Set(),
  lastFrameAt: 0,
  fpsYaw: 0,
  fpsPitch: 0,
  fpsEditMode: false
};
const skuDetailCache = new Map();

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

function isFullscreenActive() {
  return Boolean(layoutRoot && document.fullscreenElement === layoutRoot);
}

function isEditableElement(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mmToM(value) {
  return Number(value) > 10 ? Number(value) / 1000 : Number(value);
}

function normalizeCameraMode(value) {
  return CAMERA_MODES.has(value) ? value : "orbit";
}

function normalizeColourMode(value) {
  return COLOUR_MODES.has(value) ? value : "heatmap";
}

function getTimelineFrames() {
  return Array.isArray(state.heatmap?.timeline) ? state.heatmap.timeline : [];
}

function getActiveTimelineFrame() {
  if (!state.playback.active) {
    return null;
  }
  const frames = getTimelineFrames();
  if (!frames.length) {
    return null;
  }
  const index = clamp(state.playback.index, 0, Math.max(frames.length - 1, 0));
  return frames[index] || null;
}

function getActiveSourceRows() {
  const activeFrame = getActiveTimelineFrame();
  if (Array.isArray(activeFrame?.rows)) {
    return activeFrame.rows;
  }
  return Array.isArray(state.heatmap?.rows) ? state.heatmap.rows : [];
}

function getLevelNumber(row) {
  return Number.parseInt(row?.level || row?.location?.slice(4, 6) || "0", 10) || 0;
}

function getLevelBounds() {
  const minValue = Number.parseInt(levelMinInput?.value || "", 10);
  const maxValue = Number.parseInt(levelMaxInput?.value || "", 10);
  const hasMin = Number.isFinite(minValue);
  const hasMax = Number.isFinite(maxValue);
  if (!hasMin && !hasMax) {
    return { min: null, max: null };
  }
  let min = hasMin ? minValue : null;
  let max = hasMax ? maxValue : null;
  if (min != null && max != null && min > max) {
    [min, max] = [max, min];
  }
  return { min, max };
}

function buildAisleCoords(layout, rows, overrides) {
  const zoneOverrides  = overrides?.zones  || {};
  const aisleOverrides = overrides?.aisles || {};

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
    const zoneKey = zone.zone_key || "";
    const zoneOvr = zoneOverrides[zoneKey] || {};

    // Skip inactive zones
    if (zoneOvr.active === false) continue;

    const allAisles = zone?.aisles || [];
    // Filter inactive aisles
    const aisles = allAisles.filter((a) => (aisleOverrides[a.prefix] || {}).active !== false);

    const xOffset   = Number(zoneOvr.x_offset  || 0);
    const zOffset   = Number(zoneOvr.z_offset   || 0);
    const rotY      = Number(zoneOvr.rotation_y || 0);
    const zoneStartX = zoneOffsetX + xOffset;
    let zoneMaxBay = 0;

    aisles.forEach((aisle, aisleIndex) => {
      const prefix = aisle.prefix;
      const maxBay = Math.max(20, aisleStats.get(prefix)?.maxBay || 20);
      zoneMaxBay = Math.max(zoneMaxBay, maxBay);
      coords.set(prefix, {
        x: zoneStartX + aisleIndex * aisleSpacing,
        z_origin: zOffset,
        rotation_y: rotY,
        reverse_bay_dir: !!(zoneOvr.reverse_bay_dir || (aisleOverrides[prefix] || {}).reverse_bay_dir),
        zoneIndex,
        zoneKey,
        zoneLabel: zone.zone_label || ""
      });
    });

    const zoneWidth = Math.max(aisles.length - 1, 0) * aisleSpacing + 4;
    zone.layout = {
      x: zoneStartX + zoneWidth / 2 - 2,
      width: zoneWidth,
      depth: Math.max(26, Math.ceil(zoneMaxBay / 2) * 2.4 + 8),
      z_offset: zOffset,
      rotation_y: rotY
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

function getCubeSize(row, binSizes, locOverride = {}) {
  const effectiveCode = String(locOverride.bin_size_override || row.bin_size || "").trim().toUpperCase();
  const dims = effectiveCode && binSizes?.[effectiveCode] ? binSizes[effectiveCode] : null;
  return {
    code: effectiveCode,
    w: mmToM(dims?.width ?? 1050),
    h: mmToM(dims?.height ?? 1050),
    d: mmToM(dims?.depth ?? 800)
  };
}

function heatColor(row, metricKey, maxMetric) {
  const metric = metricValue(row, metricKey);
  if (metric <= 0) {
    return new THREE.Color(row.sku ? "#567180" : "#2b3742");
  }
  const ratio = Math.min(1, metric / Math.max(1, maxMetric));
  return new THREE.Color().setHSL(0.62 - ratio * 0.62, 0.85, 0.42 + ratio * 0.14);
}

function buildCategoryColorMap(values, saturation = 0.62, lightness = 0.5) {
  const unique = [...new Set((values || []).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const colorMap = new Map();
  unique.forEach((value, index) => {
    const hue = unique.length <= 1 ? 0.58 : index / unique.length;
    colorMap.set(value, new THREE.Color().setHSL(hue, saturation, lightness));
  });
  return colorMap;
}

function buildColourContext(sceneRows, overrides) {
  const allRows = state.heatmap?.rows || [];
  const locationOverrides = overrides?.locations || {};
  const levelValues = sceneRows.map((row) => row._levelValue);
  return {
    maxMetric: sceneRows.reduce((max, row) => Math.max(max, metricValue(row, metricSelect?.value || "pick_count")), 0),
    maxRecommendationScore: sceneRows.reduce((max, row) => Math.max(max, Number(row.recommendation_score || 0)), 0),
    maxPrimeScore: sceneRows.reduce((max, row) => Math.max(max, Number(row.prime_space_score || 0)), 0),
    binSizeColors: buildCategoryColorMap(allRows.map((row) =>
      String(locationOverrides[row.location]?.bin_size_override || row.bin_size || "").trim().toUpperCase()
    )),
    zoneColors: buildCategoryColorMap(allRows.map((row) => row.zone_key || "")),
    levelMin: levelValues.length ? Math.min(...levelValues) : 0,
    levelMax: levelValues.length ? Math.max(...levelValues) : 1
  };
}

function recommendationColor(row, colourContext) {
  const bucket = String(row.recommendation_bucket || "neutral").trim().toLowerCase();
  const scoreRatio = clamp(Number(row.recommendation_score || 0) / Math.max(1, colourContext.maxRecommendationScore || 1), 0, 1);
  if (bucket === "pick_face_issue") {
    return new THREE.Color().setHSL(0.92, 0.84, 0.46 + scoreRatio * 0.12);
  }
  if (bucket === "move_lower") {
    return new THREE.Color().setHSL(0.04, 0.82, 0.48 + scoreRatio * 0.1);
  }
  if (bucket === "bulk_to_pick") {
    return new THREE.Color().setHSL(0.12, 0.84, 0.5 + scoreRatio * 0.08);
  }
  if (bucket === "well_slotted") {
    return new THREE.Color().setHSL(0.39, 0.62, 0.44 + scoreRatio * 0.12);
  }
  return new THREE.Color(row.sku ? "#4a6075" : "#273341");
}

function primeSpaceColor(row, colourContext) {
  const bucket = String(row.prime_space_bucket || "standard").trim().toLowerCase();
  const scoreRatio = clamp(Number(row.prime_space_score || 0) / Math.max(1, colourContext.maxPrimeScore || 1), 0, 1);
  if (bucket === "deserves_prime") {
    return new THREE.Color().setHSL(0.02, 0.82, 0.48 + scoreRatio * 0.08);
  }
  if (bucket === "underused_prime") {
    return new THREE.Color().setHSL(0.83, 0.78, 0.48 + scoreRatio * 0.08);
  }
  if (bucket === "empty_prime") {
    return new THREE.Color().setHSL(0.55, 0.72, 0.54 + scoreRatio * 0.08);
  }
  if (bucket === "well_used_prime") {
    return new THREE.Color().setHSL(0.34, 0.62, 0.44 + scoreRatio * 0.12);
  }
  if (bucket === "standard_prime") {
    return new THREE.Color().setHSL(0.14, 0.62, 0.5 + scoreRatio * 0.06);
  }
  return new THREE.Color(row.sku ? "#4a6075" : "#273341");
}

function getSceneColor(row, colourContext) {
  if (state.colourMode === "recommendation") {
    return recommendationColor(row, colourContext);
  }
  if (state.colourMode === "prime") {
    return primeSpaceColor(row, colourContext);
  }
  if (state.colourMode === "binsize") {
    return colourContext.binSizeColors.get(row._effectiveBinSize) || new THREE.Color("#4f6b85");
  }
  if (state.colourMode === "zone") {
    return colourContext.zoneColors.get(row._zoneKey || row.zone_key || "") || new THREE.Color("#44638a");
  }
  if (state.colourMode === "level") {
    const span = Math.max(1, colourContext.levelMax - colourContext.levelMin);
    const ratio = clamp((row._levelValue - colourContext.levelMin) / span, 0, 1);
    return new THREE.Color().setHSL(0.66 - ratio * 0.66, 0.68, 0.46);
  }
  return heatColor(row, metricSelect?.value || "pick_count", colourContext.maxMetric);
}

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  if (material?.map) material.map.dispose();
  material?.dispose?.();
}

function disposeObject3D(object) {
  object?.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (child.material) disposeMaterial(child.material);
  });
}

function clearGroup(group) {
  if (!group) return;
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject3D(child);
  }
}

function updateLegend() {
  if (!legend || !legendBar || legendLabels.length < 3) return;
  legend.hidden = false;
  if (state.colourMode === "recommendation") {
    legendBar.style.background = "linear-gradient(90deg, #42556c 0%, #2d8f76 28%, #f09a3e 64%, #cf4d7f 100%)";
    legendLabels[0].textContent = "Stable";
    legendLabels[1].textContent = "Review";
    legendLabels[2].textContent = "Action";
    return;
  }
  if (state.colourMode === "prime") {
    legendBar.style.background = "linear-gradient(90deg, #42556c 0%, #56b4d8 28%, #2c9965 56%, #e04f7a 78%, #d95a3c 100%)";
    legendLabels[0].textContent = "Open";
    legendLabels[1].textContent = "Good Use";
    legendLabels[2].textContent = "Needs Move";
    return;
  }
  if (state.colourMode === "level") {
    legendBar.style.background = "linear-gradient(90deg, #3d6fcf 0%, #56c6f0 50%, #eb5a46 100%)";
    legendLabels[0].textContent = "Low";
    legendLabels[1].textContent = "Mid";
    legendLabels[2].textContent = "High";
    return;
  }
  if (state.colourMode === "binsize") {
    legendBar.style.background = "repeating-linear-gradient(90deg, #4ac0c0 0 18px, #4f7bdc 18px 36px, #8b5ee8 36px 54px, #f0a03c 54px 72px, #e75c56 72px 90px)";
    legendLabels[0].textContent = "Bin";
    legendLabels[1].textContent = "Size";
    legendLabels[2].textContent = "Groups";
    return;
  }
  if (state.colourMode === "zone") {
    legendBar.style.background = "repeating-linear-gradient(90deg, #3fb878 0 24px, #3d6fcf 24px 48px, #a562d6 48px 72px, #f0b24a 72px 96px)";
    legendLabels[0].textContent = "Zone";
    legendLabels[1].textContent = "Colour";
    legendLabels[2].textContent = "Map";
    return;
  }
  legendBar.style.background = "linear-gradient(90deg, #3d6fcf 0%, #4fd0c3 45%, #f7c948 74%, #eb5a46 100%)";
  legendLabels[0].textContent = "Cool";
  legendLabels[1].textContent = "Warm";
  legendLabels[2].textContent = "Hot";
}

function updateSceneModeUi() {
  if (cameraModeSelect) {
    cameraModeSelect.value = state.cameraMode;
  }
  if (colourModeSelect) {
    colourModeSelect.value = state.colourMode;
  }
  if (sceneHint) {
    const title = sceneHint.querySelector("strong");
    const body = sceneHint.querySelector("span");
    if (state.cameraMode === "top") {
      if (title) title.textContent = "Top-down controls";
      if (body) body.innerHTML = "Drag to pan, scroll to zoom, and use the level filter to isolate floor ranges.";
    } else if (state.cameraMode === "fps") {
      if (title) title.textContent = "FPS controls";
      if (body) {
        body.innerHTML = sceneState.fpsEditMode
          ? "<code>W A S D</code> move, <code>E</code>/<code>C</code> up-down, <code>Tab</code> resumes mouse look."
          : "<code>W A S D</code> move, mouse look, <code>E</code>/<code>C</code> up-down, <code>Tab</code> enters edit mode.";
      }
    } else {
      if (title) title.textContent = "Perspective controls";
      if (body) body.innerHTML = "<code>W A S D</code> pan in full screen, mouse drag orbits, scroll zooms, <code>Esc</code> exits.";
    }
  }
  if (fpsOverlay) {
    fpsOverlay.hidden = state.cameraMode !== "fps";
  }
  if (fpsModeChip) {
    fpsModeChip.textContent = sceneState.fpsEditMode ? "FPS Edit Mode" : "FPS Look Mode";
  }
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

function updateTopCameraFrustum(width, height) {
  if (!sceneState.topCamera) return;
  const zoom = sceneState.topCamera.zoom || 1;
  sceneState.topCamera.left = width / -2 / zoom;
  sceneState.topCamera.right = width / 2 / zoom;
  sceneState.topCamera.top = height / 2 / zoom;
  sceneState.topCamera.bottom = height / -2 / zoom;
  sceneState.topCamera.updateProjectionMatrix();
}

function syncFpsRotation() {
  if (!sceneState.fpsCamera) return;
  sceneState.fpsCamera.rotation.order = "YXZ";
  sceneState.fpsCamera.rotation.y = sceneState.fpsYaw;
  sceneState.fpsCamera.rotation.x = sceneState.fpsPitch;
}

function requestFpsPointerLock() {
  if (!canvas || state.cameraMode !== "fps" || sceneState.fpsEditMode) return;
  try {
    canvas.requestPointerLock();
  } catch (_) {}
}

function initScene() {
  if (sceneState.renderer || !canvas) return;

  const width = canvas.clientWidth || canvas.parentElement.clientWidth || 1200;
  const height = canvas.clientHeight || 620;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b1523");
  scene.fog = new THREE.Fog("#0b1523", 55, 220);

  const perspCamera = new THREE.PerspectiveCamera(52, width / height, 0.1, 1000);
  perspCamera.position.set(38, 42, 58);

  const topCamera = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2, 0.1, 1200);
  topCamera.position.set(0, 260, 0);
  topCamera.up.set(0, 0, -1);
  topCamera.lookAt(0, 0, 0);
  topCamera.zoom = 2.2;
  updateTopCameraFrustum(width, height);

  const fpsCamera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  fpsCamera.position.copy(perspCamera.position);
  fpsCamera.rotation.order = "YXZ";

  const orbitControls = new OrbitControls(perspCamera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.maxPolarAngle = Math.PI / 2.1;
  orbitControls.minDistance = 12;
  orbitControls.maxDistance = 250;

  const topControls = new OrbitControls(topCamera, renderer.domElement);
  topControls.enableDamping = true;
  topControls.enableRotate = false;
  topControls.screenSpacePanning = true;
  topControls.minZoom = 0.25;
  topControls.maxZoom = 16;
  topControls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  topControls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  topControls.target.set(0, 0, 0);
  topControls.enabled = false;

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
    new THREE.BoxGeometry(1, 1, 1),
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
  document.addEventListener("pointerlockchange", () => {
    if (state.cameraMode !== "fps") return;
    if (document.pointerLockElement === canvas) {
      sceneState.fpsEditMode = false;
    } else {
      sceneState.fpsEditMode = true;
      sceneState.movementKeys.clear();
    }
    updateSceneModeUi();
  });
  document.addEventListener("mousemove", (event) => {
    if (state.cameraMode !== "fps" || sceneState.fpsEditMode || document.pointerLockElement !== canvas) return;
    sceneState.fpsYaw -= event.movementX * 0.0022;
    sceneState.fpsPitch = clamp(sceneState.fpsPitch - event.movementY * 0.0018, -Math.PI / 2.1, Math.PI / 2.1);
    syncFpsRotation();
  });

  sceneState.renderer = renderer;
  sceneState.scene = scene;
  sceneState.camera = perspCamera;
  sceneState.controls = orbitControls;
  sceneState.perspCamera = perspCamera;
  sceneState.topCamera = topCamera;
  sceneState.fpsCamera = fpsCamera;
  sceneState.orbitControls = orbitControls;
  sceneState.topControls = topControls;
  sceneState.selectionBox = selectionBox;
  sceneState.labelGroup = labelGroup;
  sceneState.floorGroup = floorGroup;

  applySceneSettings();
  updateLegend();
  setCameraMode(state.cameraMode);
  animate();
}

function resizeScene() {
  if (!sceneState.renderer || !canvas) return;
  const width = canvas.clientWidth || canvas.parentElement.clientWidth || 1200;
  const height = canvas.clientHeight || 620;
  sceneState.renderer.setSize(width, height, false);
  if (sceneState.perspCamera) {
    sceneState.perspCamera.aspect = width / height;
    sceneState.perspCamera.updateProjectionMatrix();
  }
  if (sceneState.fpsCamera) {
    sceneState.fpsCamera.aspect = width / height;
    sceneState.fpsCamera.updateProjectionMatrix();
  }
  updateTopCameraFrustum(width, height);
}

function syncOrbitCameraFromFps() {
  if (!sceneState.fpsCamera || !sceneState.perspCamera || !sceneState.orbitControls) return;
  const forward = new THREE.Vector3();
  sceneState.fpsCamera.getWorldDirection(forward);
  const target = sceneState.fpsCamera.position.clone().add(forward.multiplyScalar(18));
  sceneState.perspCamera.position.copy(sceneState.fpsCamera.position);
  sceneState.orbitControls.target.copy(target);
  sceneState.perspCamera.lookAt(target);
  sceneState.orbitControls.update();
}

function syncFpsCameraFromOrbit() {
  if (!sceneState.fpsCamera || !sceneState.perspCamera || !sceneState.orbitControls) return;
  const target = sceneState.orbitControls.target.clone();
  sceneState.fpsCamera.position.copy(sceneState.perspCamera.position);
  sceneState.fpsCamera.lookAt(target);
  const euler = new THREE.Euler().setFromQuaternion(sceneState.fpsCamera.quaternion, "YXZ");
  sceneState.fpsYaw = euler.y;
  sceneState.fpsPitch = euler.x;
  syncFpsRotation();
}

function setCameraMode(mode) {
  const nextMode = normalizeCameraMode(mode);
  if (state.cameraMode === "fps" && nextMode !== "fps") {
    syncOrbitCameraFromFps();
    if (document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
    sceneState.fpsEditMode = false;
  }

  state.cameraMode = nextMode;

  if (nextMode === "top") {
    sceneState.camera = sceneState.topCamera;
    sceneState.controls = sceneState.topControls;
    if (sceneState.orbitControls) sceneState.orbitControls.enabled = false;
    if (sceneState.topControls) sceneState.topControls.enabled = true;
  } else if (nextMode === "fps") {
    if (state.cameraMode === "top" && sceneState.topControls && sceneState.fpsCamera) {
      const target = sceneState.topControls.target.clone();
      sceneState.fpsCamera.position.set(target.x + 8, Math.max(target.y + 1.75, 1.75), target.z + 8);
      sceneState.fpsCamera.lookAt(target.x, Math.max(target.y + 1.5, 1.5), target.z);
      const euler = new THREE.Euler().setFromQuaternion(sceneState.fpsCamera.quaternion, "YXZ");
      sceneState.fpsYaw = euler.y;
      sceneState.fpsPitch = euler.x;
      syncFpsRotation();
    } else {
      syncFpsCameraFromOrbit();
    }
    sceneState.camera = sceneState.fpsCamera;
    sceneState.controls = null;
    if (sceneState.orbitControls) sceneState.orbitControls.enabled = false;
    if (sceneState.topControls) sceneState.topControls.enabled = false;
    sceneState.fpsEditMode = false;
    requestFpsPointerLock();
  } else {
    sceneState.camera = sceneState.perspCamera;
    sceneState.controls = sceneState.orbitControls;
    if (sceneState.orbitControls) sceneState.orbitControls.enabled = true;
    if (sceneState.topControls) sceneState.topControls.enabled = false;
  }

  updateSceneModeUi();
}

function updateKeyboardMovement(deltaSeconds) {
  if (!sceneState.camera || !sceneState.movementKeys.size || isEditableElement(document.activeElement)) {
    return;
  }

  if (state.cameraMode === "fps") {
    const forward = new THREE.Vector3();
    sceneState.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 0) forward.normalize();
    else forward.set(0, 0, -1);

    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const movement = new THREE.Vector3();
    if (sceneState.movementKeys.has("KeyW")) movement.add(forward);
    if (sceneState.movementKeys.has("KeyS")) movement.sub(forward);
    if (sceneState.movementKeys.has("KeyD")) movement.add(right);
    if (sceneState.movementKeys.has("KeyA")) movement.sub(right);
    if (sceneState.movementKeys.has("KeyE")) movement.y += 1;
    if (sceneState.movementKeys.has("KeyC")) movement.y -= 1;
    if (movement.lengthSq() === 0) return;
    movement.normalize().multiplyScalar(Math.max(3, 10 * deltaSeconds) * sceneSettings.wasdSpeed);
    sceneState.camera.position.add(movement);
    return;
  }

  if (!sceneState.controls || !isFullscreenActive()) {
    return;
  }

  if (state.cameraMode === "top") {
    const movement = new THREE.Vector3();
    if (sceneState.movementKeys.has("KeyW")) movement.z -= 1;
    if (sceneState.movementKeys.has("KeyS")) movement.z += 1;
    if (sceneState.movementKeys.has("KeyD")) movement.x += 1;
    if (sceneState.movementKeys.has("KeyA")) movement.x -= 1;
    if (movement.lengthSq() === 0) return;
    movement.normalize().multiplyScalar(Math.max(6, 18 * deltaSeconds) * sceneSettings.wasdSpeed);
    sceneState.topCamera.position.add(movement);
    sceneState.topControls.target.add(movement);
    return;
  }

  const forward = new THREE.Vector3();
  sceneState.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() === 0) return;
  forward.normalize();

  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const movement = new THREE.Vector3();

  if (sceneState.movementKeys.has("KeyW")) {
    movement.add(forward);
  }
  if (sceneState.movementKeys.has("KeyS")) {
    movement.sub(forward);
  }
  if (sceneState.movementKeys.has("KeyD")) {
    movement.add(right);
  }
  if (sceneState.movementKeys.has("KeyA")) {
    movement.sub(right);
  }
  if (movement.lengthSq() === 0) {
    return;
  }

  movement.normalize().multiplyScalar(Math.max(8, 18 * deltaSeconds) * sceneSettings.wasdSpeed);
  sceneState.camera.position.add(movement);
  sceneState.controls.target.add(movement);
}

function animate(frameAt = 0) {
  requestAnimationFrame(animate);
  if (!sceneState.renderer) return;

  const now = frameAt || performance.now();
  const previous = sceneState.lastFrameAt || now;
  const deltaSeconds = Math.min(0.08, Math.max(0.001, (now - previous) / 1000));
  sceneState.lastFrameAt = now;

  updateKeyboardMovement(deltaSeconds);
  sceneState.orbitControls?.update();
  sceneState.topControls?.update();
  sceneState.renderer.render(sceneState.scene, sceneState.camera);
}

function clearSceneContent() {
  if (sceneState.rackMesh) {
    sceneState.scene.remove(sceneState.rackMesh);
    sceneState.rackMesh.geometry.dispose();
    disposeMaterial(sceneState.rackMesh.material);
    sceneState.rackMesh = null;
  }
  clearGroup(sceneState.labelGroup);
  clearGroup(sceneState.floorGroup);
  if (sceneState.selectionBox) {
    sceneState.selectionBox.visible = false;
  }
  state.sceneRows = [];
}

function getCubeSizeLegacy(row, binSizes) {
  const code = String(row.bin_size || "").trim().toUpperCase();
  const locOvr = (state.heatmap?.overrides?.locations || {})[row.location] || {};
  const dims = (code && binSizes?.[code]) ? binSizes[code] : null;
  // bin_sizes values are stored in mm — divide by 1000 for Three.js world units
  const mmToM = v => Number(v) > 10 ? Number(v) / 1000 : Number(v); // handle legacy metre values gracefully
  return {
    w: mmToM(locOvr.width  || dims?.width  || 1050),
    h: mmToM(locOvr.height || dims?.height || 1050),
    d: mmToM(locOvr.depth  || dims?.depth  || 800)
  };
}

function buildSceneLegacy(rows, layout, metricKey, overrides) {
  clearSceneContent();
  if (!sceneState.scene) return;

  const coords   = buildAisleCoords(layout, rows, overrides);
  const binSizes = state.heatmap?.bin_sizes || {};
  const locOvrs  = overrides?.locations || {};
  const bayOvrs  = overrides?.bays      || {};
  state.aisleCoords = coords;
  const maxMetric = rows.reduce((max, row) => Math.max(max, metricValue(row, metricKey)), 0);

  // Each row may have a different cube size — use separate geometries grouped by size key
  // For performance with InstancedMesh we use a single mesh with average size and scale per-instance via matrix
  const geometry = new THREE.BoxGeometry(1, 1, 1); // Unit box — scaled per instance via matrix
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.4,
    metalness: 0.12
  });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(rows.length, 1));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // ── Pre-processing pass 1: slot info per bay+level ──────────────────────
  // Key format: "<prefix><bay>L<levelNum>"  e.g. "WK29L10"
  // Stores the max slot number and bin dimensions (max h taken for stack safety)
  const levelSlotInfo = new Map();
  for (const row of rows) {
    const prefix   = row.aisle_prefix || "";
    const levelNum = Number.parseInt(row.level || "0", 10);
    const slot     = Number.parseInt(row.slot  || "1", 10) || 1;
    const lKey     = prefix + (row.bay || "") + "L" + levelNum;
    const { w, h, d } = getCubeSize(row, binSizes);
    const ex = levelSlotInfo.get(lKey);
    if (!ex) {
      levelSlotInfo.set(lKey, { maxSlot: slot, w, h, d });
    } else {
      if (slot > ex.maxSlot) ex.maxSlot = slot;
      if (h > ex.h) ex.h = h; // tallest bin at this level drives stack height
    }
  }

  // ── Pre-processing pass 2: stacked Y base per bay+level ─────────────────
  // Sort levels numerically and accumulate actual bin heights from the floor up.
  // 30 mm gap between shelves (shelf board thickness).
  const SHELF_GAP  = 0.03;
  const levelBaseY = new Map(); // lKey → Y coordinate of shelf floor
  const bayLevels  = new Map(); // bayKey → [levelNums]
  for (const lKey of levelSlotInfo.keys()) {
    const li     = lKey.lastIndexOf("L");
    const bayKey = lKey.slice(0, li);
    const lvlNum = Number.parseInt(lKey.slice(li + 1), 10);
    if (!bayLevels.has(bayKey)) bayLevels.set(bayKey, []);
    bayLevels.get(bayKey).push(lvlNum);
  }
  for (const [bayKey, levels] of bayLevels) {
    levels.sort((a, b) => a - b);
    let cumY = 0;
    for (const lvlNum of levels) {
      const lKey = bayKey + "L" + lvlNum;
      levelBaseY.set(lKey, cumY);
      cumY += (levelSlotInfo.get(lKey)?.h || 1.05) + SHELF_GAP;
    }
  }

  const dummy = new THREE.Object3D();
  rows.forEach((row, index) => {
    const aisle = coords.get(row.aisle_prefix) || { x: 0, z_origin: 0, rotation_y: 0 };
    const bayNumber   = Number.parseInt(row.bay   || "0", 10) || 0;
    const levelNumber = Number.parseInt(row.level || "0", 10) || 0;
    const slotNumber  = Number.parseInt(row.slot  || "1", 10) || 1;

    // Per-location overrides (x/y/z offset)
    const locOvr = locOvrs[row.location] || {};
    const bayKey = row.aisle_prefix + row.bay;
    const bayOvr = bayOvrs[bayKey] || {};
    const extraX = Number(locOvr.x_offset || bayOvr.x_offset || 0);
    const extraY = Number(locOvr.y_offset || 0);
    const extraZ = Number(locOvr.z_offset || bayOvr.z_offset || 0);

    const { w, h, d } = getCubeSize(row, binSizes);

    // ── Hallway model ───────────────────────────────────────────────────────
    // The aisle is a corridor running along Z. Odd bays are on the LEFT wall
    // (–X), even bays on the RIGHT wall (+X) — both at the same Z depth.
    // Slots 01/02 within a bay are side-by-side ALONG Z (not across the aisle).
    //
    //  entrance ──────────────────────────────────── back
    //  left  │ [bay1-s01][bay1-s02]  [bay3-s01][bay3-s02] │
    //        │              HALLWAY                         │
    //  right │ [bay2-s01][bay2-s02]  [bay4-s01][bay4-s02] │
    //
    const BAY_STEP   = 2.6;   // Z-distance between adjacent bay-pair centres (≥ 2×CF 1.2m + 0.2m gap)
    const AISLE_HALF = 1.5;   // X-distance from aisle centre to rack face centre
    const bayPair    = Math.ceil(bayNumber / 2);
    const isEvenBay  = (bayNumber % 2) === 0;
    const sideSign   = isEvenBay ? 1 : -1;           // +1 = right wall, -1 = left wall
    const depthSign  = aisle.reverse_bay_dir ? 1 : -1;

    // Slot offset along Z — centred per bay+level (each level may have different count/width)
    const lKey       = (row.aisle_prefix || "") + (row.bay || "") + "L" + levelNumber;
    const levelInfo  = levelSlotInfo.get(lKey);
    const totalSlots = levelInfo?.maxSlot || 1;
    const slotZOff   = (slotNumber - 1 - (totalSlots - 1) / 2) * w;

    const rotY = aisle.rotation_y || 0;
    let x, z;
    if (rotY === 90 || rotY === -270) {
      // Rotated 90°: depth runs along X instead of Z
      x = (aisle.z_origin || 0) + depthSign * (bayPair * BAY_STEP) + slotZOff + extraX;
      z = -(aisle.x + sideSign * AISLE_HALF) + extraZ;
    } else if (rotY === -90 || rotY === 270) {
      x = (aisle.z_origin || 0) - depthSign * (bayPair * BAY_STEP) - slotZOff + extraX;
      z = aisle.x + sideSign * AISLE_HALF + extraZ;
    } else {
      x = aisle.x + sideSign * AISLE_HALF + extraX;
      z = depthSign * -(bayPair * BAY_STEP) + slotZOff + (aisle.z_origin || 0) + extraZ;
    }
    // Y: floor of this shelf level + half bin height (bin centre), plus any per-location Y override
    const baseY = levelBaseY.get(lKey) || 0;
    const y     = baseY + h * 0.5 + extraY;

    dummy.position.set(x, y, z);
    // Cube X = rack depth (d), Y = height (h), Z = bin width along hallway (w)
    dummy.scale.set(d, h, w);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.setColorAt(index, heatColor(row, metricKey, maxMetric));
    state.sceneRows[index] = { ...row, _position: { x, y, z }, _size: { w, h, d } };
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

function fitCameraLegacy(rows) {
  if (!rows.length || !sceneState.camera || !sceneState.controls) return;
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

function getFilteredRowsLegacy() {
  if (!state.heatmap?.rows) return [];
  const q = String(searchInput?.value || "").trim().toUpperCase();
  const pickedOnly = Boolean(pickedOnlyToggle?.checked);
  const occupiedOnly = Boolean(occupiedOnlyToggle?.checked);
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

function buildSceneRows(rows, layout, overrides) {
  const allRows = state.heatmap?.rows || rows || [];
  const coords = buildAisleCoords(layout, allRows, overrides);
  const binSizes = state.heatmap?.bin_sizes || {};
  const locationOverrides = overrides?.locations || {};
  const bayOverrides = overrides?.bays || {};
  const levelSlotInfo = new Map();
  const bayLevels = new Map();

  state.aisleCoords = coords;

  rows.forEach((row) => {
    const prefix = String(row.aisle_prefix || row.location?.slice(0, 2) || "").trim().toUpperCase();
    const bayNumber = Number.parseInt(row.bay || "0", 10) || 0;
    const levelNumber = getLevelNumber(row);
    const slotNumber = Number.parseInt(row.slot || "1", 10) || 1;
    const bayKey = `${prefix}${String(bayNumber).padStart(2, "0")}`;
    const levelKey = `${bayKey}L${levelNumber}`;
    const cube = getCubeSize(row, binSizes, locationOverrides[row.location] || {});
    const current = levelSlotInfo.get(levelKey);

    if (!current) {
      levelSlotInfo.set(levelKey, { maxSlot: slotNumber, h: cube.h });
    } else {
      if (slotNumber > current.maxSlot) current.maxSlot = slotNumber;
      if (cube.h > current.h) current.h = cube.h;
    }

    if (!bayLevels.has(bayKey)) {
      bayLevels.set(bayKey, new Set());
    }
    bayLevels.get(bayKey).add(levelNumber);
  });

  const levelBaseY = new Map();
  const levelHeightMap = new Map();

  bayLevels.forEach((levelsSet, bayKey) => {
    const levels = [...levelsSet].sort((a, b) => a - b);
    const bayOverride = bayOverrides[bayKey] || {};
    const customHeights = Array.isArray(bayOverride.level_heights) ? bayOverride.level_heights : [];
    let cumulativeHeight = 0;

    levels.forEach((levelNumber) => {
      const levelKey = `${bayKey}L${levelNumber}`;
      const defaultHeight = levelSlotInfo.get(levelKey)?.h || 1.05;
      const customHeight = customHeights[levelNumber - 1];
      const levelHeight = customHeight != null && customHeight !== ""
        ? mmToM(customHeight)
        : defaultHeight;

      levelBaseY.set(levelKey, cumulativeHeight);
      levelHeightMap.set(levelKey, levelHeight);
      cumulativeHeight += levelHeight + SHELF_GAP;
    });
  });

  return rows.flatMap((row) => {
    const prefix = String(row.aisle_prefix || row.location?.slice(0, 2) || "").trim().toUpperCase();
    const aisle = coords.get(prefix);
    if (!aisle) {
      return [];
    }

    const bayNumber = Number.parseInt(row.bay || "0", 10) || 0;
    const levelNumber = getLevelNumber(row);
    const slotNumber = Number.parseInt(row.slot || "1", 10) || 1;
    const bayKey = `${prefix}${String(bayNumber).padStart(2, "0")}`;
    const levelKey = `${bayKey}L${levelNumber}`;
    const locationOverride = locationOverrides[row.location] || {};
    const bayOverride = bayOverrides[bayKey] || {};
    const cube = getCubeSize(row, binSizes, locationOverride);

    const bayPair = Math.ceil(bayNumber / 2);
    const isEvenBay = bayNumber % 2 === 0;
    const sideSign = isEvenBay ? 1 : -1;
    const depthSign = aisle.reverse_bay_dir ? 1 : -1;
    const totalSlots = levelSlotInfo.get(levelKey)?.maxSlot || 1;
    const slotOffset = (slotNumber - 1 - (totalSlots - 1) / 2) * cube.w;
    const rotY = Number(aisle.rotation_y || 0);
    const extraX = Number(locationOverride.x_offset ?? bayOverride.x_offset ?? 0);
    const extraY = Number(locationOverride.y_offset ?? 0);
    const extraZ = Number(locationOverride.z_offset ?? bayOverride.z_offset ?? 0);
    const floorHeight = Number(bayOverride.floor_height || 0);
    const height = levelHeightMap.get(levelKey) ?? cube.h;
    let x;
    let z;

    if (rotY === 90 || rotY === -270) {
      x = (aisle.z_origin || 0) + depthSign * (bayPair * BAY_STEP) + slotOffset + extraX;
      z = -(aisle.x + sideSign * AISLE_HALF) + extraZ;
    } else if (rotY === -90 || rotY === 270) {
      x = (aisle.z_origin || 0) - depthSign * (bayPair * BAY_STEP) - slotOffset + extraX;
      z = aisle.x + sideSign * AISLE_HALF + extraZ;
    } else {
      x = aisle.x + sideSign * AISLE_HALF + extraX;
      z = depthSign * -(bayPair * BAY_STEP) + slotOffset + (aisle.z_origin || 0) + extraZ;
    }

    const baseY = levelBaseY.get(levelKey) || 0;
    const y = baseY + height * 0.5 + extraY + floorHeight;

    return [{
      ...row,
      _position: { x, y, z },
      _size: { w: cube.w, h: height, d: cube.d },
      _zoneKey: aisle.zoneKey || row.zone_key || "",
      _levelValue: levelNumber,
      _effectiveBinSize: cube.code || "",
      _bayKey: bayKey,
      _aisleKey: prefix
    }];
  });
}

function updateSelectionBox() {
  if (!sceneState.selectionBox) return;
  const row = state.selectedLocation
    ? state.sceneRows.find((item) => item.location === state.selectedLocation) || null
    : null;

  if (!row) {
    sceneState.selectionBox.visible = false;
    return;
  }

  sceneState.selectionBox.visible = true;
  sceneState.selectionBox.position.set(row._position.x, row._position.y, row._position.z);
  sceneState.selectionBox.scale.set(
    Math.max(0.5, row._size.d + 0.12),
    Math.max(0.5, row._size.h + 0.12),
    Math.max(0.5, row._size.w + 0.12)
  );
}

function buildScene(rows, layout, overrides) {
  clearSceneContent();
  if (!sceneState.scene) return;

  const sceneRows = buildSceneRows(rows, layout, overrides);
  const colourContext = buildColourContext(sceneRows, overrides);
  state.sceneRows = sceneRows;

  if (sceneRows.length) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.4,
      metalness: 0.12
    });
    const mesh = new THREE.InstancedMesh(geometry, material, sceneRows.length);
    const dummy = new THREE.Object3D();

    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    sceneRows.forEach((row, index) => {
      dummy.position.set(row._position.x, row._position.y, row._position.z);
      dummy.scale.set(row._size.d, row._size.h, row._size.w);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, getSceneColor(row, colourContext));
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    sceneState.scene.add(mesh);
    sceneState.rackMesh = mesh;
  }

  (layout?.zones || []).forEach((zone, zoneIndex) => {
    const activeAisles = (zone.aisles || []).filter((aisle) => state.aisleCoords.has(aisle.prefix));
    if (!activeAisles.length) return;

    const zoneMeta = zone.layout || null;
    if (zoneMeta) {
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(zoneMeta.width, 0.4, zoneMeta.depth),
        new THREE.MeshPhongMaterial({
          color: zoneIndex % 2 === 0 ? "#12243a" : "#142b22",
          transparent: true,
          opacity: 0.48
        })
      );
      floor.position.set(zoneMeta.x, -0.35, (zoneMeta.z_offset || 0) - zoneMeta.depth / 2 + 4);
      floor.rotation.y = THREE.MathUtils.degToRad(Number(zoneMeta.rotation_y || 0));
      sceneState.floorGroup.add(floor);

      const zoneSprite = makeTextSprite(zone.zone_label || zone.zone_key || "Zone");
      zoneSprite.position.set(zoneMeta.x, 0.8, (zoneMeta.z_offset || 0) + 6);
      sceneState.labelGroup.add(zoneSprite);
    }

    activeAisles.forEach((aisle, index) => {
      if (index % 2 !== 0) return;
      const coord = state.aisleCoords.get(aisle.prefix);
      if (!coord) return;
      const sprite = makeTextSprite(aisle.prefix);
      sprite.position.set(coord.x, 1.4, (coord.z_origin || 0) + 1.5);
      sceneState.labelGroup.add(sprite);
    });
  });

  updateLegend();
  updateSelectionBox();
}

function recolorScene() {
  updateLegend();
  renderRecommendationInfo(state.rows || []);
  if (!sceneState.rackMesh || !state.sceneRows.length) return;

  const colourContext = buildColourContext(state.sceneRows, state.heatmap?.overrides || {});
  state.sceneRows.forEach((row, index) => {
    sceneState.rackMesh.setColorAt(index, getSceneColor(row, colourContext));
  });

  if (sceneState.rackMesh.instanceColor) {
    sceneState.rackMesh.instanceColor.needsUpdate = true;
  }
  updateSelectionBox();
}

function fitCamera() {
  if (!sceneState.perspCamera || !sceneState.topCamera || !sceneState.fpsCamera) return;

  if (!state.sceneRows.length) {
    sceneState.perspCamera.position.set(38, 42, 58);
    sceneState.orbitControls?.target.set(0, 0, 0);
    sceneState.orbitControls?.update();
    sceneState.topCamera.position.set(0, 260, 0);
    sceneState.topCamera.zoom = 2.2;
    sceneState.topControls?.target.set(0, 0, 0);
    updateTopCameraFrustum(canvas?.clientWidth || 1200, canvas?.clientHeight || 620);
    sceneState.topControls?.update();
    sceneState.fpsCamera.position.set(24, 2.2, 24);
    sceneState.fpsCamera.lookAt(0, 2, 0);
    const defaultEuler = new THREE.Euler().setFromQuaternion(sceneState.fpsCamera.quaternion, "YXZ");
    sceneState.fpsYaw = defaultEuler.y;
    sceneState.fpsPitch = defaultEuler.x;
    syncFpsRotation();
    updateSelectionBox();
    return;
  }

  const minX = Math.min(...state.sceneRows.map((row) => row._position.x - row._size.d / 2));
  const maxX = Math.max(...state.sceneRows.map((row) => row._position.x + row._size.d / 2));
  const minY = Math.min(...state.sceneRows.map((row) => row._position.y - row._size.h / 2));
  const maxY = Math.max(...state.sceneRows.map((row) => row._position.y + row._size.h / 2));
  const minZ = Math.min(...state.sceneRows.map((row) => row._position.z - row._size.w / 2));
  const maxZ = Math.max(...state.sceneRows.map((row) => row._position.z + row._size.w / 2));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const spanX = Math.max(8, maxX - minX);
  const spanY = Math.max(4, maxY - minY);
  const spanZ = Math.max(8, maxZ - minZ);
  const radius = Math.max(spanX, spanZ, spanY * 1.4);
  const sceneWidth = canvas?.clientWidth || canvas?.parentElement?.clientWidth || 1200;
  const sceneHeight = canvas?.clientHeight || 620;

  sceneState.perspCamera.position.set(
    centerX + radius * 0.9,
    maxY + Math.max(12, radius * 0.55),
    centerZ + radius * 0.9
  );
  sceneState.orbitControls?.target.set(centerX, centerY * 0.65, centerZ);
  sceneState.orbitControls?.update();

  sceneState.topControls?.target.set(centerX, centerY, centerZ);
  sceneState.topCamera.position.set(centerX, maxY + 260, centerZ);
  sceneState.topCamera.zoom = clamp(
    Math.min(sceneWidth / (spanX + 12), sceneHeight / (spanZ + 12)),
    sceneState.topControls?.minZoom ?? 0.25,
    sceneState.topControls?.maxZoom ?? 16
  );
  updateTopCameraFrustum(sceneWidth, sceneHeight);
  sceneState.topControls?.update();

  sceneState.fpsCamera.position.set(
    centerX + Math.max(6, spanX * 0.35),
    Math.max(minY + 1.75, 1.75),
    centerZ + Math.max(6, spanZ * 0.35)
  );
  sceneState.fpsCamera.lookAt(centerX, Math.max(minY + 1.5, centerY * 0.45), centerZ);
  const fpsEuler = new THREE.Euler().setFromQuaternion(sceneState.fpsCamera.quaternion, "YXZ");
  sceneState.fpsYaw = fpsEuler.y;
  sceneState.fpsPitch = fpsEuler.x;
  syncFpsRotation();
  updateSelectionBox();
}

function getFilteredRows() {
  const sourceRows = getActiveSourceRows();
  if (!sourceRows.length) return [];

  const query = String(searchInput?.value || "").trim().toUpperCase();
  const pickedOnly = Boolean(pickedOnlyToggle?.checked);
  const occupiedOnly = Boolean(occupiedOnlyToggle?.checked);
  const { min, max } = getLevelBounds();

  return sourceRows.filter((row) => {
    const levelNumber = getLevelNumber(row);

    if (min != null && levelNumber < min) return false;
    if (max != null && levelNumber > max) return false;
    if (pickedOnly && !(Number(row.pick_count || 0) > 0 || Number(row.pick_qty || 0) > 0)) return false;
    if (occupiedOnly && !String(row.sku || "").trim()) return false;
    if (!query) return true;

    const haystack = [
      row.location,
      row.sku,
      row.description,
      row.aisle_prefix,
      row.zone_key,
      row.bin_size
    ].join(" ").toUpperCase();

    return haystack.includes(query);
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
    .sort((a, b) => (
      (metricSelect?.value === "pick_qty" ? Number(b.pick_qty || 0) - Number(a.pick_qty || 0) : Number(b.pick_count || 0) - Number(a.pick_count || 0)) ||
      (b.pick_count - a.pick_count) ||
      (b.pick_qty - a.pick_qty)
    ))
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

function renderRecommendationInfo(rows) {
  if (!recommendationInfo) return;
  const meta = state.heatmap?.meta || {};
  const activeFrame = getActiveTimelineFrame();
  const playbackNote = activeFrame
    ? `<span>Playback is showing ${escapeHtml(activeFrame.snapshot_date || "one loaded day")}, while recommendation scores still use the selected full range.</span>`
    : "";

  if (state.colourMode === "recommendation") {
    const summary = rows.reduce((acc, row) => {
      const bucket = String(row.recommendation_bucket || "neutral").trim().toLowerCase();
      if (bucket === "move_lower") acc.moveLower += 1;
      if (bucket === "bulk_to_pick") acc.bulkToPick += 1;
      if (bucket === "pick_face_issue") acc.pickFace += 1;
      if (bucket === "well_slotted") acc.wellSlotted += 1;
      return acc;
    }, { moveLower: 0, bulkToPick: 0, pickFace: 0, wellSlotted: 0 });

    recommendationInfo.innerHTML = [
      "<strong>Recommendation layer</strong>",
      `<span>${summary.moveLower.toLocaleString()} location(s) are tied to move-lower candidates.</span>`,
      `<span>${summary.bulkToPick.toLocaleString()} location(s) are leaning on bulk-to-pick fixes.</span>`,
      `<span>${summary.pickFace.toLocaleString()} location(s) have pick-face suitability issues.</span>`,
      `<span>${summary.wellSlotted.toLocaleString()} fast-mover location(s) already look well slotted.</span>`,
      meta.recommendation_note ? `<span>${escapeHtml(meta.recommendation_note)}</span>` : "",
      playbackNote
    ].filter(Boolean).join("");
    return;
  }

  if (state.colourMode === "prime") {
    const summary = rows.reduce((acc, row) => {
      const bucket = String(row.prime_space_bucket || "standard").trim().toLowerCase();
      if (bucket === "empty_prime") acc.open += 1;
      if (bucket === "well_used_prime") acc.goodUse += 1;
      if (bucket === "underused_prime") acc.wasted += 1;
      if (bucket === "deserves_prime") acc.shouldMove += 1;
      return acc;
    }, { open: 0, goodUse: 0, wasted: 0, shouldMove: 0 });

    recommendationInfo.innerHTML = [
      `<strong>Prime space view</strong>`,
      `<span>${summary.open.toLocaleString()} low-level prime slot(s) are open.</span>`,
      `<span>${summary.goodUse.toLocaleString()} prime slot(s) are already serving fast movers well.</span>`,
      `<span>${summary.wasted.toLocaleString()} prime slot(s) look underused or tied up by slow movers.</span>`,
      `<span>${summary.shouldMove.toLocaleString()} higher-level location(s) belong to SKUs that should move lower.</span>`,
      `<span>Prime space is currently treated as levels 1 to ${Number(meta.prime_space_level_threshold || 3).toLocaleString()}.</span>`,
      playbackNote
    ].filter(Boolean).join("");
    return;
  }

  recommendationInfo.innerHTML = [
    "<strong>Decision lenses ready</strong>",
    "<span>Switch Colour mode to Recommendation layer to see move-lower, bulk-to-pick, and pick-face actions.</span>",
    `<span>Switch to Prime space view to find wasted low-level space and SKUs that deserve moving lower.</span>`,
    activeFrame ? `<span>Playback frame: ${escapeHtml(activeFrame.snapshot_date || "Loaded day")}.</span>` : ""
  ].filter(Boolean).join("");
}

function renderStats(rows) {
  if (!occupiedMetric || !pickedMetric || !locationChip || !pickChip || !dateChip) return;

  const meta = state.heatmap?.meta || {};
  const activeFrame = getActiveTimelineFrame();
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

  if (activeFrame?.snapshot_date) {
    dateChip.textContent = `Playback ${activeFrame.snapshot_date}`;
  } else if (!availableDates.length) {
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
    if (activeFrame) {
      const frames = getTimelineFrames();
      snapshotStatusChip.textContent = `Playback frame ${Math.min(state.playback.index + 1, frames.length).toLocaleString()}/${frames.length.toLocaleString()}`;
      snapshotStatusChip.classList.remove("chip--inactive");
    } else if (!availableDates.length) {
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
  renderRecommendationInfo(rows);
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
      const cacheKey = `${getSelectedClient()}::${String(row.sku).trim().toUpperCase()}`;
      if (skuDetailCache.has(cacheKey)) {
        skuDetail = skuDetailCache.get(cacheKey) || null;
      } else {
        const data = await apiFetch(`/api/catalog/sku/${encodeURIComponent(row.sku)}`);
        skuDetail = data.sku || null;
        skuDetailCache.set(cacheKey, skuDetail);
      }
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
  const recommendationChips = [
    row.abc_class ? `<span class="chip chip--inactive">ABC ${escapeHtml(row.abc_class)}</span>` : "",
    row.recommendation_label ? `<span class="chip chip--inactive">${escapeHtml(row.recommendation_label)}</span>` : "",
    row.prime_space_label ? `<span class="chip chip--inactive">${escapeHtml(row.prime_space_label)}</span>` : "",
    row.bin_type ? `<span class="chip chip--inactive">${escapeHtml(row.bin_type)} bin</span>` : ""
  ].filter(Boolean).join("");
  const topSkuHtml = Array.isArray(row.top_skus) && row.top_skus.length
    ? `<div class="heatmap-top-skus">${row.top_skus.map((item) => `<span class="chip chip--inactive">${escapeHtml(item.sku)} - ${Number(item.pick_count || 0)} picks</span>`).join("")}</div>`
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
      <div><span>Aisle</span><strong>${escapeHtml(row.aisle_prefix || "-")}</strong></div>
      <div><span>Bay</span><strong>${escapeHtml(row.bay || "-")}</strong></div>
      <div><span>Level</span><strong>${escapeHtml(row.level || "-")}</strong></div>
      <div><span>Slot</span><strong>${escapeHtml(row.slot || "-")}</strong></div>
      <div><span>Bin type</span><strong>${escapeHtml(row.bin_type || "-")}</strong></div>
      <div><span>Max bin qty</span><strong>${Number(row.max_bin_qty || 0).toLocaleString()}</strong></div>
      <div><span>Pick count</span><strong>${Number(row.pick_count || 0).toLocaleString()}</strong></div>
      <div><span>Pick qty</span><strong>${Number(row.pick_qty || 0).toLocaleString()}</strong></div>
    </div>
    <div class="heatmap-detail-copy">
      <p class="eyebrow">Current SKU</p>
      <strong>${escapeHtml(row.sku || "Empty location")}</strong>
      <p>${escapeHtml(row.description || "No current SKU description available.")}</p>
      <span class="heatmap-detail-muted">Bin quantity: ${Number(row.qty || 0).toLocaleString()} - Photos: ${Number(row.image_count || 0).toLocaleString()}</span>
    </div>
    <div class="heatmap-detail-copy">
      <p class="eyebrow">Recommendation Signals</p>
      <div class="heatmap-top-skus">${recommendationChips || '<span class="chip chip--inactive">No recommendation signals</span>'}</div>
      <span class="heatmap-detail-muted">${escapeHtml(row.recommendation_reason || "No strong recommendation reason for this location yet.")}</span>
      <span class="heatmap-detail-muted">${escapeHtml(row.prime_space_reason || "")}</span>
      ${row.pick_face_issue_summary ? `<span class="heatmap-detail-muted">Pick-face issue: ${escapeHtml(row.pick_face_issue_summary)}</span>` : ""}
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

function applyFiltersLegacy() {
  if (!state.heatmap) return;
  const rows = getFilteredRows();
  state.rows = rows;
  renderStats(rows);
  buildScene(rows, state.heatmap.layout, metricSelect?.value || "pick_count", state.heatmap.overrides || {});

  if (state.selectedLocation) {
    const selected = rows.find((row) => row.location === state.selectedLocation) || null;
    if (!selected) {
      state.selectedLocation = "";
      renderSelection(null);
    }
  }

  setStatus(`${rows.length.toLocaleString()} locations in view`, "ok");
}

function handleSceneClickLegacy(event) {
  if (!canvas || !sceneState.rackMesh || !state.sceneRows.length) return;
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
  if (sceneState.selectionBox) {
    sceneState.selectionBox.visible = true;
    sceneState.selectionBox.position.set(row._position.x, row._position.y, row._position.z);
  }
  renderSelection(row);
}

function applyFilters({ refit = false } = {}) {
  if (!state.heatmap) return;

  state.colourMode = normalizeColourMode(colourModeSelect?.value || state.colourMode);
  const rows = getFilteredRows();
  const selectedRow = state.selectedLocation
    ? rows.find((row) => row.location === state.selectedLocation) || null
    : null;

  state.rows = rows;
  renderStats(rows);
  buildScene(rows, state.heatmap.layout, state.heatmap.overrides || {});

  if (refit || !sceneState.hasFittedScene) {
    fitCamera();
    sceneState.hasFittedScene = true;
  } else {
    updateSelectionBox();
  }

  if (state.selectedLocation && !selectedRow) {
    state.selectedLocation = "";
    renderSelection(null);
  } else if (selectedRow) {
    renderSelection(selectedRow);
  }

  if (!rows.length) {
    setStatus("No locations match the current filters");
    return;
  }

  setStatus(`${rows.length.toLocaleString()} locations in view`, "ok");
}

function handleSceneClick(event) {
  if (state.cameraMode === "fps" && !sceneState.fpsEditMode) {
    requestFpsPointerLock();
    return;
  }
  if (!canvas || !sceneState.camera || !sceneState.rackMesh || !state.sceneRows.length) return;

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
  updateSelectionBox();
  renderSelection(row);
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
  params.set("client", getSelectedClient());
  const mode = String(modeSelect?.value || "latest").trim().toLowerCase() || "latest";
  params.set("mode", mode);
  params.set("rankBy", String(metricSelect?.value || "pick_count").trim());

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

function clearPlaybackTimer() {
  if (state.playback.timer) {
    window.clearTimeout(state.playback.timer);
    state.playback.timer = null;
  }
}

function syncPlaybackUi() {
  const frames = getTimelineFrames();
  const hasFrames = frames.length > 0;
  const canStepFrames = frames.length > 1;
  const activeFrame = getActiveTimelineFrame();
  const firstFrame = frames[0] || null;
  const lastFrame = frames[frames.length - 1] || null;
  const resolvedIndex = clamp(state.playback.index, 0, Math.max(frames.length - 1, 0));

  if (playbackPrevButton) playbackPrevButton.disabled = !canStepFrames;
  if (playbackNextButton) playbackNextButton.disabled = !canStepFrames;
  if (playbackResetButton) playbackResetButton.disabled = !state.playback.active;
  if (playbackSpeedSelect) playbackSpeedSelect.disabled = !canStepFrames;
  if (playbackToggleButton) {
    playbackToggleButton.disabled = !canStepFrames;
    playbackToggleButton.textContent = !state.playback.active
      ? "Play"
      : state.playback.playing
        ? "Pause"
        : "Resume";
  }
  if (playbackStatusChip) {
    if (!frames.length) {
      playbackStatusChip.textContent = "No playback frames";
      playbackStatusChip.classList.add("chip--inactive");
    } else if (activeFrame) {
      playbackStatusChip.textContent = `${activeFrame.snapshot_date || "Frame"} (${Math.min(state.playback.index + 1, frames.length)}/${frames.length})`;
      playbackStatusChip.classList.remove("chip--inactive");
    } else {
      playbackStatusChip.textContent = "Aggregate view";
      playbackStatusChip.classList.add("chip--inactive");
    }
  }
  if (timelineRange) {
    timelineRange.disabled = !hasFrames;
    timelineRange.min = "0";
    timelineRange.max = String(Math.max(frames.length - 1, 0));
    timelineRange.step = "1";
    timelineRange.value = String(resolvedIndex);
  }
  if (timelineLabel) {
    timelineLabel.textContent = activeFrame?.snapshot_date
      ? `Viewing ${activeFrame.snapshot_date}`
      : firstFrame && lastFrame
        ? firstFrame.snapshot_date === lastFrame.snapshot_date
          ? `Loaded day ${firstFrame.snapshot_date}`
          : `Aggregate ${firstFrame.snapshot_date} to ${lastFrame.snapshot_date}`
        : "Aggregate range";
  }
  if (timelineMeta) {
    if (!hasFrames) {
      timelineMeta.textContent = "No loaded playback frames yet";
    } else if (activeFrame) {
      timelineMeta.textContent = `Frame ${Math.min(resolvedIndex + 1, frames.length)}/${frames.length} loaded day(s)`;
    } else {
      timelineMeta.textContent = `${frames.length} loaded day(s) available to scrub`;
    }
  }
  if (timelineStartLabel) {
    timelineStartLabel.textContent = firstFrame?.snapshot_date || "Start";
  }
  if (timelineEndLabel) {
    timelineEndLabel.textContent = lastFrame?.snapshot_date || "End";
  }
  if (timelineCurrentLabel) {
    timelineCurrentLabel.textContent = activeFrame?.snapshot_date
      ? `Selected ${activeFrame.snapshot_date}`
      : hasFrames
        ? "Aggregate view"
        : "No day selected";
  }
}

function applyPlaybackFrame(index, { playing = false } = {}) {
  const frames = getTimelineFrames();
  if (!frames.length) {
    state.playback.active = false;
    state.playback.playing = false;
    state.playback.index = 0;
    syncPlaybackUi();
    return;
  }

  state.playback.active = true;
  state.playback.playing = playing;
  state.playback.index = ((index % frames.length) + frames.length) % frames.length;
  applyFilters();
  syncPlaybackUi();
}

function schedulePlaybackStep() {
  clearPlaybackTimer();
  if (!state.playback.active || !state.playback.playing) {
    return;
  }
  const frames = getTimelineFrames();
  if (frames.length <= 1) {
    state.playback.playing = false;
    syncPlaybackUi();
    return;
  }
  state.playback.timer = window.setTimeout(() => {
    applyPlaybackFrame(state.playback.index + 1, { playing: true });
    schedulePlaybackStep();
  }, Math.max(400, Number(state.playback.speedMs || 1000)));
}

function resetPlaybackToAggregate() {
  clearPlaybackTimer();
  state.playback.active = false;
  state.playback.playing = false;
  applyFilters();
  syncPlaybackUi();
}

function togglePlayback() {
  const frames = getTimelineFrames();
  if (frames.length <= 1) {
    syncPlaybackUi();
    return;
  }

  if (!state.playback.active) {
    const requestedIndex = Number.parseInt(timelineRange?.value || String(state.playback.index || 0), 10);
    applyPlaybackFrame(Number.isFinite(requestedIndex) ? requestedIndex : 0, { playing: true });
    schedulePlaybackStep();
    return;
  }

  if (state.playback.playing) {
    state.playback.playing = false;
    clearPlaybackTimer();
    syncPlaybackUi();
    return;
  }

  state.playback.playing = true;
  syncPlaybackUi();
  schedulePlaybackStep();
}

function stepPlayback(direction) {
  const frames = getTimelineFrames();
  if (!frames.length) {
    syncPlaybackUi();
    return;
  }
  clearPlaybackTimer();
  const nextIndex = state.playback.active
    ? state.playback.index + direction
    : direction >= 0
      ? 0
      : frames.length - 1;
  applyPlaybackFrame(nextIndex, { playing: false });
}

function scrubPlaybackToIndex(rawIndex) {
  const frames = getTimelineFrames();
  if (!frames.length) {
    syncPlaybackUi();
    return;
  }
  clearPlaybackTimer();
  const nextIndex = Number.parseInt(String(rawIndex ?? ""), 10);
  applyPlaybackFrame(Number.isFinite(nextIndex) ? nextIndex : state.playback.index, { playing: false });
}

async function loadHeatmap() {
  syncModeUi();
  setStatus("Loading heatmap...");
  clearPlaybackTimer();
  state.playback.active = false;
  state.playback.playing = false;
  state.playback.index = 0;
  try {
    const query = buildHeatmapQuery();
    const data = await apiFetch(`/api/admin/picking-heatmap${query}`);
    state.heatmap = data.heatmap || { rows: [], timeline: [], layout: { zones: [] }, meta: {}, stats: {}, overrides: {}, bin_sizes: {}, known_bin_sizes: [] };
    state.playback.index = Math.max(getTimelineFrames().length - 1, 0);
    const meta = state.heatmap.meta || {};
    updateDateOptions(meta.available_pick_dates || [], meta.pick_snapshot_date || meta.latest_pick_snapshot_date || "");

    if (startDateInput && meta.pick_requested_start_date) {
      startDateInput.value = meta.pick_requested_start_date;
    }
    if (endDateInput && meta.pick_requested_end_date) {
      endDateInput.value = meta.pick_requested_end_date;
    }

    applyFilters({ refit: true });

    if (!Array.isArray(meta.available_pick_dates) || !meta.available_pick_dates.length) {
      renderSelectionPlaceholder("No pick snapshots have been published yet. Restart the PI-App sync machine or wait for the next publish window.");
      if (hotAislesWrap) {
        hotAislesWrap.innerHTML = '<p class="admin-empty">No pick snapshots have been published yet.</p>';
      }
      syncPlaybackUi();
      setStatus("No pick snapshots available");
      return;
    }

    if (Number(meta.pick_available_day_count || 0) === 0) {
      renderSelectionPlaceholder("No pick snapshots match the selected day or range yet.");
      if (hotAislesWrap) {
        hotAislesWrap.innerHTML = '<p class="admin-empty">No pick snapshots match the selected range.</p>';
      }
      syncPlaybackUi();
      setStatus("No snapshots in selected range");
      return;
    }

    if (!state.selectedLocation) {
      renderSelection(null);
    }
    syncPlaybackUi();
  } catch (error) {
    setStatus("Could not load heatmap");
    renderSelectionPlaceholder(error.message || "Could not load the picking heatmap.");
    renderSnapshotInfo({});
    renderRecommendationInfo([]);
    syncPlaybackUi();
    if (hotAislesWrap) {
      hotAislesWrap.innerHTML = '<p class="admin-empty">Could not load aisle heat data.</p>';
    }
    window.ItemTracker?.toast(error.message || "Could not load the picking heatmap", "error");
  }
}

function refreshFullscreenState() {
  state.isFullscreen = isFullscreenActive();
  if (layoutRoot) {
    layoutRoot.classList.toggle("is-fullscreen", state.isFullscreen);
  }
  if (fullscreenButton) {
    fullscreenButton.textContent = state.isFullscreen ? "Exit full screen" : "Full screen";
  }
  if (!state.isFullscreen) {
    sceneState.movementKeys.clear();
  }
  window.setTimeout(resizeScene, 40);
}

async function toggleFullscreen() {
  if (!layoutRoot) return;
  try {
    if (isFullscreenActive()) {
      await document.exitFullscreen();
    } else {
      await layoutRoot.requestFullscreen();
    }
  } catch (error) {
    window.ItemTracker?.toast(error.message || "Could not toggle full screen", "error");
  }
}

function handleKeyDownLegacy(event) {
  if (!isFullscreenActive()) {
    return;
  }
  if (isEditableElement(event.target)) {
    return;
  }
  if (!["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
    return;
  }
  event.preventDefault();
  sceneState.movementKeys.add(event.code);
}

function handleKeyUpLegacy(event) {
  if (!["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
    return;
  }
  sceneState.movementKeys.delete(event.code);
}

function wireEventsLegacy() {
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
  fullscreenButton?.addEventListener("click", toggleFullscreen);

  document.addEventListener("fullscreenchange", refreshFullscreenState);
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
}

function handleKeyDown(event) {
  if (isEditableElement(event.target)) {
    return;
  }

  if (event.code === "Digit1") {
    event.preventDefault();
    setCameraMode("orbit");
    return;
  }
  if (event.code === "Digit2") {
    event.preventDefault();
    setCameraMode("top");
    return;
  }
  if (event.code === "Digit3") {
    event.preventDefault();
    setCameraMode("fps");
    return;
  }
  if (event.code === "KeyR") {
    event.preventDefault();
    fitCamera();
    return;
  }

  if (state.cameraMode === "fps" && event.code === "Tab") {
    event.preventDefault();
    sceneState.fpsEditMode = !sceneState.fpsEditMode;
    if (sceneState.fpsEditMode) {
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }
    } else {
      requestFpsPointerLock();
    }
    updateSceneModeUi();
    return;
  }

  if (state.cameraMode === "fps" && event.code === "Escape") {
    sceneState.fpsEditMode = true;
    sceneState.movementKeys.clear();
    if (document.pointerLockElement === canvas) {
      event.preventDefault();
      document.exitPointerLock();
    }
    updateSceneModeUi();
    return;
  }

  const movementKeys = state.cameraMode === "fps"
    ? ["KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyC"]
    : isFullscreenActive()
      ? ["KeyW", "KeyA", "KeyS", "KeyD"]
      : [];

  if (!movementKeys.includes(event.code)) {
    return;
  }

  event.preventDefault();
  sceneState.movementKeys.add(event.code);
}

function handleKeyUp(event) {
  if (!["KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyC"].includes(event.code)) {
    return;
  }
  sceneState.movementKeys.delete(event.code);
}

function wireEvents() {
  if (!metricSelect || !searchInput || !pickedOnlyToggle || !occupiedOnlyToggle || !reloadButton) return;

  clientSelect?.addEventListener("change", () => {
    navigateToSelectedClient();
  });
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

  metricSelect.addEventListener("change", loadHeatmap);
  searchInput.addEventListener("input", () => applyFilters());
  pickedOnlyToggle.addEventListener("change", () => applyFilters());
  occupiedOnlyToggle.addEventListener("change", () => applyFilters());
  cameraModeSelect?.addEventListener("change", () => {
    setCameraMode(cameraModeSelect.value);
  });
  colourModeSelect?.addEventListener("change", () => {
    state.colourMode = normalizeColourMode(colourModeSelect.value);
    recolorScene();
    updateSceneModeUi();
  });
  levelMinInput?.addEventListener("input", () => applyFilters());
  levelMaxInput?.addEventListener("input", () => applyFilters());
  levelResetButton?.addEventListener("click", () => {
    if (levelMinInput) levelMinInput.value = "";
    if (levelMaxInput) levelMaxInput.value = "";
    applyFilters();
  });
  resetCameraButton?.addEventListener("click", fitCamera);
  reloadButton.addEventListener("click", loadHeatmap);
  fullscreenButton?.addEventListener("click", toggleFullscreen);
  playbackPrevButton?.addEventListener("click", () => stepPlayback(-1));
  playbackToggleButton?.addEventListener("click", togglePlayback);
  playbackNextButton?.addEventListener("click", () => stepPlayback(1));
  playbackResetButton?.addEventListener("click", resetPlaybackToAggregate);
  timelineRange?.addEventListener("input", () => {
    scrubPlaybackToIndex(timelineRange.value);
  });
  timelineRange?.addEventListener("change", () => {
    scrubPlaybackToIndex(timelineRange.value);
  });
  playbackSpeedSelect?.addEventListener("change", () => {
    state.playback.speedMs = Number.parseInt(playbackSpeedSelect.value || "1000", 10) || 1000;
    if (state.playback.playing) {
      schedulePlaybackStep();
    } else {
      syncPlaybackUi();
    }
  });

  document.addEventListener("fullscreenchange", refreshFullscreenState);
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
}

if (canvas) {
  loadSceneSettings();
  syncSettingsPanel();
  wireSettingsPanel();
  initScene();
  syncModeUi();
  updateClientAwareLinks();
  syncClientUrl();
  refreshFullscreenState();
  syncPlaybackUi();
  wireEvents();
  loadHeatmap();
}
