import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const boot   = window.LAYOUT_EDITOR_BOOTSTRAP || {};
const layout = boot.layout || { zones: [], aisle_order: [] };

// ── Overrides state ───────────────────────────────────────────────────────────
// zones:    { zone_key:  { x_offset, z_offset, rotation_y, active } }
// aisles:   { prefix:   { active } }
// bays:     { "WF29":   { x_offset, z_offset, active } }
// locations:{ "WF291501": { x_offset, y_offset, z_offset, active } }
// virtual_locations: [{ id, location, bin_size }]
// bin_sizes:{ "CF": { width, height, depth } }
let overrides = structuredClone(boot.overrides || {});
overrides.zones             = overrides.zones             || {};
overrides.aisles            = overrides.aisles            || {};
overrides.bays              = overrides.bays              || {};
overrides.locations         = overrides.locations         || {};
overrides.virtual_locations = overrides.virtual_locations || [];
overrides.bin_sizes         = overrides.bin_sizes         || {};

let dirty        = false;
let selMode      = "zone";   // "zone" | "bay" | "location"
let selection    = null;     // { type, key, label }

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas            = document.getElementById("editorCanvas");
const zoneChip          = document.getElementById("editorZoneChip");
const saveChip          = document.getElementById("editorSaveChip");
const saveButton        = document.getElementById("editorSaveButton");
const statusChip        = document.getElementById("editorStatusChip");
const resetViewBtn      = document.getElementById("editorResetViewButton");
const locationSearch    = document.getElementById("editorLocationSearch");
const locationSearchBtn = document.getElementById("editorLocationSearchBtn");
const hint              = document.getElementById("editorHint");
const hintText          = document.getElementById("editorHintText");

// Selection tab
const noSelectionWrap     = document.getElementById("editorNoSelection");
const selectionControls   = document.getElementById("editorSelectionControls");
const selectionType       = document.getElementById("editorSelectionType");
const selectionLabel      = document.getElementById("editorSelectionLabel");
const deselectBtn         = document.getElementById("editorDeselectButton");
const xOffsetInput        = document.getElementById("editorXOffset");
const yOffsetInput        = document.getElementById("editorYOffset");
const zOffsetInput        = document.getElementById("editorZOffset");
const yOffsetWrap         = document.getElementById("editorYOffsetWrap");
const rotationWrap        = document.getElementById("editorRotationWrap");
const rotationYSelect     = document.getElementById("editorRotationY");
const activeToggle        = document.getElementById("editorActiveToggle");
const activeLabel         = document.getElementById("editorActiveLabel");
const aisleSection        = document.getElementById("editorAisleSection");
const aisleListWrap       = document.getElementById("editorAisleList");

// Bin sizes tab
const binSizesList        = document.getElementById("binSizesList");
const binSizeNewCode      = document.getElementById("binSizeNewCode");
const binSizeAddBtn       = document.getElementById("binSizeAddBtn");

// Virtual locations tab
const virtualLocationsList = document.getElementById("virtualLocationsList");
const virtualLocCode       = document.getElementById("virtualLocCode");
const virtualLocBinSize    = document.getElementById("virtualLocBinSize");
const virtualLocAddBtn     = document.getElementById("virtualLocAddBtn");

function escapeHtml(v) {
  return String(v || "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Build derived lookup tables from layout ───────────────────────────────────
// bayMap: "WF29" → [all location codes with that prefix]
// (These are derived at runtime from layout + overrides, not stored)
function buildAisleSet() {
  const s = new Set();
  for (const z of layout.zones || []) for (const a of z.aisles || []) s.add(a.prefix);
  return s;
}
const aisleSet = buildAisleSet();

// ── Three.js scene ────────────────────────────────────────────────────────────
const ZONE_COLORS  = ["#1a4d8a","#194d3a","#4a2a6a","#6a3a1a","#1a6a6a","#6a1a4a","#3a4a1a","#1a3a6a"];
const SEL_COLOR    = "#88aaff";
const BAY_COLOR    = "#d8a030";
const LOC_COLOR    = "#f04080";
const VIRTUAL_COLOR = "#30d880";

const sc = {
  renderer: null, scene: null, camera: null, controls: null,
  raycaster: new THREE.Raycaster(),
  pointer:   new THREE.Vector2(),
  zoneMeshes: new Map(),   // zone_key → Mesh
  locMeshes:  new Map(),   // location → Mesh (shown in location/bay mode)
};

// ── Zone layout computation ────────────────────────────────────────────────────
function computeZoneLayouts() {
  let zoneOffsetX = 0;
  const aisleSpacing = 5.2, zoneGap = 16;
  const result = [];
  for (const zone of layout.zones || []) {
    const key    = zone.zone_key || "";
    const ovr    = overrides.zones[key] || {};
    const active = ovr.active !== false;
    const visAisles = (zone.aisles || []).filter(a => (overrides.aisles[a.prefix] || {}).active !== false);
    const xOffset = Number(ovr.x_offset || 0);
    const zOffset = Number(ovr.z_offset || 0);
    const rotY    = Number(ovr.rotation_y || 0);
    const startX  = zoneOffsetX + xOffset;
    const width   = Math.max(visAisles.length - 1, 0) * aisleSpacing + 4;
    const depth   = 30;
    const centerX = startX + width / 2 - 2;
    const centerZ = zOffset - depth / 2 + 4;
    result.push({ zone, key, active, visAisles, width, depth, centerX, centerZ, rotY });
    zoneOffsetX += visAisles.length * aisleSpacing + zoneGap;
  }
  return result;
}

// Per-aisle X position map (prefix → world X)
function buildAisleCoords(zoneLayouts) {
  const coords = new Map();
  const aisleSpacing = 5.2;
  for (const z of zoneLayouts) {
    let baseX = z.centerX - (z.visAisles.length - 1) * aisleSpacing / 2;
    z.visAisles.forEach((aisle, i) => {
      coords.set(aisle.prefix, { x: baseX + i * aisleSpacing, zoneDepth: z.depth, zoneZ: z.centerZ, rotY: z.rotY });
    });
  }
  return coords;
}

// ── Build scene ────────────────────────────────────────────────────────────────
function buildEditorScene() {
  // Clear old
  sc.zoneMeshes.forEach(m => sc.scene.remove(m));
  sc.zoneMeshes.clear();
  sc.locMeshes.forEach(m => sc.scene.remove(m));
  sc.locMeshes.clear();

  const zoneLayouts  = computeZoneLayouts();
  const aisleCoords  = buildAisleCoords(zoneLayouts);

  if (zoneChip) zoneChip.textContent = zoneLayouts.length + " zone" + (zoneLayouts.length === 1 ? "" : "s");

  if (selMode === "zone") {
    buildZoneBlocks(zoneLayouts);
  } else {
    buildZoneBlocks(zoneLayouts, true); // wireframe-only in bay/location mode
    buildLocationDots(aisleCoords);
  }
}

function buildZoneBlocks(zoneLayouts, wireframeOnly = false) {
  zoneLayouts.forEach((z, ci) => {
    const isSelected = selection?.type === "zone" && selection?.key === z.key;
    const color   = isSelected ? SEL_COLOR : ZONE_COLORS[ci % ZONE_COLORS.length];
    const opacity = wireframeOnly ? 0.18 : (z.active ? 0.65 : 0.22);

    const geo = new THREE.BoxGeometry(z.width, 1.2, z.depth);
    const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.6, metalness: 0.08 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(z.centerX, 0, z.centerZ);
    mesh.rotation.y = (z.rotY * Math.PI) / 180;
    mesh.userData = { type: "zone", key: z.key };

    // Edges
    mesh.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: isSelected ? "#aaccff" : "#4a7aaa", transparent: true, opacity: 0.8 })
    ));

    // Label
    const spr = makeSprite(z.zone.zone_label || z.key);
    spr.position.set(0, 2.8, 0);
    mesh.add(spr);

    sc.scene.add(mesh);
    sc.zoneMeshes.set(z.key, mesh);
  });
}

// In bay/location mode: render each location as a small cube
function buildLocationDots(aisleCoords) {
  const allLocations = getAllLocations(aisleCoords);
  const geo = new THREE.BoxGeometry(0.9, 0.9, 0.7);
  const matDefault  = new THREE.MeshStandardMaterial({ color: "#2a4a6a", roughness: 0.5, metalness: 0.1 });
  const matSelected = new THREE.MeshStandardMaterial({ color: SEL_COLOR, roughness: 0.3 });
  const matBay      = new THREE.MeshStandardMaterial({ color: BAY_COLOR, roughness: 0.4 });
  const matLoc      = new THREE.MeshStandardMaterial({ color: LOC_COLOR, roughness: 0.3 });
  const matVirtual  = new THREE.MeshStandardMaterial({ color: VIRTUAL_COLOR, roughness: 0.4 });

  for (const loc of allLocations) {
    let mat;
    if (loc.is_virtual) {
      mat = matVirtual;
    } else if (selection?.type === "location" && selection?.key === loc.location) {
      mat = matSelected;
    } else if (selection?.type === "bay" && loc.location.startsWith(selection.key)) {
      mat = matBay;
    } else {
      mat = matDefault;
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(loc.x, loc.y, loc.z);
    mesh.userData = { type: "loc", key: loc.location, bayKey: loc.bayKey };
    sc.scene.add(mesh);
    sc.locMeshes.set(loc.location, mesh);
  }
}

// Generate world positions for every known location code
function getAllLocations(aisleCoords) {
  const result = [];
  const aisleSpacing = 5.2;

  // Build a set of all location codes from overrides (bays, locations, virtual)
  // and infer position from aisle_prefix + bay + level + slot
  const allCodes = new Set([
    ...Object.keys(overrides.locations),
    ...(overrides.virtual_locations || []).map(v => v.location)
  ]);
  // Also generate synthetic entries from bay overrides
  for (const bayKey of Object.keys(overrides.bays)) {
    const prefix = bayKey.slice(0, 2);
    const bay    = bayKey.slice(2);
    // Add placeholder entries for visualization
    for (let level = 10; level <= 50; level += 10) {
      for (let slot = 1; slot <= 2; slot++) {
        allCodes.add(`${prefix}${bay}${String(level).padStart(2,"0")}0${slot}`);
      }
    }
  }

  for (const code of allCodes) {
    const prefix = code.slice(0, 2).toUpperCase();
    const digits = code.slice(2).replace(/\D/g, "");
    const bay    = Number(digits.slice(0, 2)) || 0;
    const level  = Number(digits.slice(2, 4)) || 10;
    const slot   = Number(digits.slice(4, 6)) || 1;
    const ac     = aisleCoords.get(prefix);
    if (!ac) continue;

    const locOvr = overrides.locations[code] || {};
    const bayKey = prefix + String(bay).padStart(2, "0");
    const bayOvr = overrides.bays[bayKey] || {};

    const slotOffset = (slot % 2 === 1 ? -0.52 : 0.52);
    const x = ac.x + slotOffset + Number(locOvr.x_offset || bayOvr.x_offset || 0);
    const y = Math.max(0.45, Math.round(level / 10) * 1.18 + 0.6) + Number(locOvr.y_offset || 0);
    const z = -(bay * 1.18) + Number(locOvr.z_offset || bayOvr.z_offset || 0);
    const isVirtual = (overrides.virtual_locations || []).some(v => v.location === code);

    result.push({ location: code, bayKey: prefix + String(bay).padStart(2,"0"), x, y, z, is_virtual: isVirtual });
  }

  return result;
}

// ── Sprite label ───────────────────────────────────────────────────────────────
function makeSprite(label) {
  const c = document.createElement("canvas");
  c.width = 384; c.height = 96;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(8,16,32,0.78)";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "rgba(136,173,255,0.75)";
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, c.width - 6, c.height - 6);
  ctx.fillStyle = "#f4f7ff";
  ctx.font = "700 40px Georgia";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, c.width / 2, c.height / 2);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  spr.scale.set(8, 2, 1);
  return spr;
}

// ── Three.js init ──────────────────────────────────────────────────────────────
function initScene() {
  if (!canvas) return;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth || 900, canvas.clientHeight || 500, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b1523");
  scene.fog = new THREE.Fog("#0b1523", 80, 380);

  const w = canvas.clientWidth || 900, h = canvas.clientHeight || 500;
  const camera = new THREE.PerspectiveCamera(52, w / h, 0.1, 1000);
  camera.position.set(60, 70, 90);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance   = 5;
  controls.maxDistance   = 450;

  scene.add(new THREE.AmbientLight("#dce6ff", 1.2));
  const kl = new THREE.DirectionalLight("#ffffff", 1.1);
  kl.position.set(50, 100, 50); scene.add(kl);
  const fl = new THREE.DirectionalLight("#7ab4ff", 0.5);
  fl.position.set(-50, 40, -30); scene.add(fl);

  const grid = new THREE.GridHelper(600, 120, "#24405d", "#162536");
  grid.position.y = -0.7;
  scene.add(grid);

  sc.renderer = renderer;
  sc.scene    = scene;
  sc.camera   = camera;
  sc.controls = controls;

  renderer.domElement.addEventListener("click", handleCanvasClick);
  window.addEventListener("resize", () => {
    if (!sc.renderer || !sc.camera || !canvas) return;
    const w = canvas.clientWidth || 900, h = canvas.clientHeight || 500;
    sc.renderer.setSize(w, h, false);
    sc.camera.aspect = w / h;
    sc.camera.updateProjectionMatrix();
  });

  buildEditorScene();
  fitCamera();

  (function animate() {
    requestAnimationFrame(animate);
    sc.controls.update();
    sc.renderer.render(sc.scene, sc.camera);
  })();
}

function fitCamera() {
  if (!sc.camera || !sc.controls) return;
  const zl = computeZoneLayouts();
  if (!zl.length) return;
  const xs = zl.map(z => z.centerX);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  sc.camera.position.set(cx + 60, 70, 90);
  sc.controls.target.set(cx, 0, -14);
  sc.controls.update();
}

// ── Click handler ──────────────────────────────────────────────────────────────
function handleCanvasClick(event) {
  if (!canvas || !sc.scene) return;
  const rect = canvas.getBoundingClientRect();
  sc.pointer.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
  sc.pointer.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
  sc.raycaster.setFromCamera(sc.pointer, sc.camera);

  const meshes = [...sc.zoneMeshes.values(), ...sc.locMeshes.values()];
  const hits   = sc.raycaster.intersectObjects(meshes, false);
  if (!hits.length) return;

  const ud = hits[0].object.userData;
  if (ud.type === "zone" && selMode === "zone") {
    const zone = (layout.zones || []).find(z => z.zone_key === ud.key);
    if (zone) selectItem("zone", ud.key, zone.zone_label || ud.key, zone);
  } else if (ud.type === "loc") {
    if (selMode === "bay") {
      selectItem("bay", ud.bayKey, ud.bayKey, null);
    } else if (selMode === "location") {
      selectItem("location", ud.key, ud.key, null);
    }
  }
}

// ── Selection ──────────────────────────────────────────────────────────────────
function selectItem(type, key, label, zoneObj) {
  selection = { type, key, label, zoneObj };
  showSelectionControls(type, key, label, zoneObj);
  buildEditorScene();
  if (statusChip) {
    statusChip.textContent = label;
    statusChip.classList.remove("chip--inactive");
  }
}

function deselect() {
  selection = null;
  if (selectionControls) selectionControls.hidden = true;
  if (noSelectionWrap)   noSelectionWrap.hidden   = false;
  buildEditorScene();
  if (statusChip) { statusChip.textContent = "Click to select"; statusChip.classList.add("chip--inactive"); }
}

function showSelectionControls(type, key, label, zoneObj) {
  if (!selectionControls) return;
  selectionControls.hidden = false;
  if (noSelectionWrap) noSelectionWrap.hidden = true;

  if (selectionType) selectionType.textContent = type === "zone" ? "Zone" : type === "bay" ? "Bay group" : "Location";
  if (selectionLabel) selectionLabel.textContent = label;

  // Show/hide Y offset only for locations
  if (yOffsetWrap) yOffsetWrap.hidden = (type !== "location");
  // Show/hide rotation only for zone/bay
  if (rotationWrap) rotationWrap.hidden = (type === "location");
  // Aisle list only for zones
  if (aisleSection) aisleSection.hidden = (type !== "zone");

  if (activeLabel) {
    activeLabel.textContent = type === "zone" ? "Zone visible in heatmap" :
                              type === "bay"  ? "Bay visible in heatmap"  : "Location visible";
  }

  // Load current overrides into controls
  let ovr = {};
  if (type === "zone")     ovr = overrides.zones[key]     || {};
  if (type === "bay")      ovr = overrides.bays[key]      || {};
  if (type === "location") ovr = overrides.locations[key] || {};

  if (xOffsetInput)    xOffsetInput.value     = String(ovr.x_offset   || 0);
  if (yOffsetInput)    yOffsetInput.value      = String(ovr.y_offset   || 0);
  if (zOffsetInput)    zOffsetInput.value      = String(ovr.z_offset   || 0);
  if (rotationYSelect) rotationYSelect.value   = String(ovr.rotation_y || 0);
  if (activeToggle)    activeToggle.checked    = ovr.active !== false;

  // Render aisle list for zones
  if (type === "zone" && zoneObj) renderAisleList(zoneObj);
}

function renderAisleList(zone) {
  if (!aisleListWrap) return;
  const aisles = zone.aisles || [];
  aisleListWrap.innerHTML = aisles.map(a => {
    const active = (overrides.aisles[a.prefix] || {}).active !== false;
    return `<label class="toggle-pill editor-aisle-toggle">
      <input type="checkbox" class="aisle-cb" data-prefix="${escapeHtml(a.prefix)}" ${active ? "checked" : ""}>
      <span>${escapeHtml(a.prefix)}</span>
    </label>`;
  }).join("");
  aisleListWrap.querySelectorAll(".aisle-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      if (!overrides.aisles[cb.dataset.prefix]) overrides.aisles[cb.dataset.prefix] = {};
      overrides.aisles[cb.dataset.prefix].active = cb.checked;
      markDirty(); buildEditorScene();
    });
  });
}

// ── Bin sizes panel ────────────────────────────────────────────────────────────
function renderBinSizes() {
  if (!binSizesList) return;
  const entries = Object.entries(overrides.bin_sizes || {});
  if (!entries.length) {
    binSizesList.innerHTML = '<p class="admin-empty">No bin size dimensions configured yet.</p>';
    return;
  }
  binSizesList.innerHTML = entries.map(([code, dims]) =>
    `<div class="bin-size-row" data-code="${escapeHtml(code)}">
      <strong class="bin-size-code">${escapeHtml(code)}</strong>
      <label class="bin-size-field">
        <span>W</span>
        <input type="number" class="bin-sz" data-dim="width"  min="0.1" step="0.05" value="${Number(dims.width  || 1.05).toFixed(2)}">
      </label>
      <label class="bin-size-field">
        <span>H</span>
        <input type="number" class="bin-sz" data-dim="height" min="0.1" step="0.05" value="${Number(dims.height || 1.05).toFixed(2)}">
      </label>
      <label class="bin-size-field">
        <span>D</span>
        <input type="number" class="bin-sz" data-dim="depth"  min="0.1" step="0.05" value="${Number(dims.depth  || 0.8).toFixed(2)}">
      </label>
      <button type="button" class="bin-size-remove ghost-button" data-code="${escapeHtml(code)}">✕</button>
    </div>`
  ).join("");

  binSizesList.querySelectorAll(".bin-sz").forEach(inp => {
    inp.addEventListener("input", () => {
      const row  = inp.closest("[data-code]");
      const code = row?.dataset.code;
      const dim  = inp.dataset.dim;
      if (!code || !dim) return;
      if (!overrides.bin_sizes[code]) overrides.bin_sizes[code] = {};
      overrides.bin_sizes[code][dim] = parseFloat(inp.value) || 0;
      markDirty();
    });
  });
  binSizesList.querySelectorAll(".bin-size-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      delete overrides.bin_sizes[btn.dataset.code];
      markDirty(); renderBinSizes();
    });
  });
}

// ── Virtual locations panel ────────────────────────────────────────────────────
function renderVirtualLocations() {
  if (!virtualLocationsList) return;
  const vl = overrides.virtual_locations || [];
  if (!vl.length) {
    virtualLocationsList.innerHTML = '<p class="admin-empty">No virtual locations yet.</p>';
    return;
  }
  virtualLocationsList.innerHTML = vl.map((v, i) =>
    `<div class="virtual-loc-row">
      <span class="virtual-loc-code">${escapeHtml(v.location)}</span>
      ${v.bin_size ? `<span class="chip chip--inactive">${escapeHtml(v.bin_size)}</span>` : ""}
      <button type="button" class="ghost-button virtual-loc-remove" data-index="${i}">✕</button>
    </div>`
  ).join("");
  virtualLocationsList.querySelectorAll(".virtual-loc-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      overrides.virtual_locations.splice(idx, 1);
      markDirty(); renderVirtualLocations(); buildEditorScene();
    });
  });
}

// ── Wire all controls ──────────────────────────────────────────────────────────
function wireControls() {
  // Mode tabs
  document.querySelectorAll(".editor-mode-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".editor-mode-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selMode = btn.dataset.mode;
      deselect();
      if (hintText) hintText.textContent = selMode === "zone" ? "Click a zone to select" :
                                           selMode === "bay"  ? "Click a group of cubes (bay)" :
                                                                "Click a cube to select location";
    });
  });

  // Location search
  function doLocationSearch() {
    const raw = String(locationSearch?.value || "").trim().toUpperCase();
    if (!raw) return;
    // If ≥6 chars, treat as a specific location; if 4 chars treat as bay group
    if (raw.length <= 4 && /^[A-Z]{2}\d{2}$/.test(raw)) {
      selMode = "bay";
      document.querySelectorAll(".editor-mode-tab").forEach(b => b.classList.toggle("active", b.dataset.mode === "bay"));
      selectItem("bay", raw, raw, null);
    } else if (raw.length >= 6) {
      selMode = "location";
      document.querySelectorAll(".editor-mode-tab").forEach(b => b.classList.toggle("active", b.dataset.mode === "location"));
      selectItem("location", raw, raw, null);
    }
  }
  locationSearchBtn?.addEventListener("click", doLocationSearch);
  locationSearch?.addEventListener("keydown", e => { if (e.key === "Enter") doLocationSearch(); });

  // Deselect
  deselectBtn?.addEventListener("click", deselect);

  // Reset view
  resetViewBtn?.addEventListener("click", fitCamera);

  // Position inputs
  function applyPositionOverride() {
    if (!selection) return;
    const { type, key } = selection;
    const target = type === "zone" ? overrides.zones : type === "bay" ? overrides.bays : overrides.locations;
    if (!target[key]) target[key] = {};
    target[key].x_offset   = parseFloat(xOffsetInput?.value || 0) || 0;
    target[key].z_offset   = parseFloat(zOffsetInput?.value || 0) || 0;
    if (type === "location") target[key].y_offset = parseFloat(yOffsetInput?.value || 0) || 0;
    if (type !== "location") target[key].rotation_y = Number(rotationYSelect?.value || 0);
    target[key].active = activeToggle?.checked !== false;
    markDirty();
    buildEditorScene();
  }
  [xOffsetInput, yOffsetInput, zOffsetInput].forEach(inp => inp?.addEventListener("input", applyPositionOverride));
  rotationYSelect?.addEventListener("change", applyPositionOverride);
  activeToggle?.addEventListener("change", applyPositionOverride);

  // Sidebar tabs
  document.querySelectorAll(".editor-sidebar-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".editor-sidebar-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".editor-tab-panel").forEach(p => p.hidden = true);
      const panel = document.getElementById("tab" + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1));
      if (panel) panel.hidden = false;
    });
  });

  // Bin size add
  binSizeAddBtn?.addEventListener("click", () => {
    const code = String(binSizeNewCode?.value || "").trim().toUpperCase();
    if (!code) return;
    if (!overrides.bin_sizes[code]) {
      overrides.bin_sizes[code] = { width: 1.05, height: 1.05, depth: 0.8 };
      markDirty(); renderBinSizes();
    }
    if (binSizeNewCode) binSizeNewCode.value = "";
  });
  binSizeNewCode?.addEventListener("keydown", e => { if (e.key === "Enter") binSizeAddBtn?.click(); });

  // Virtual location add
  virtualLocAddBtn?.addEventListener("click", () => {
    const loc = String(virtualLocCode?.value || "").trim().toUpperCase();
    const bs  = String(virtualLocBinSize?.value || "").trim().toUpperCase();
    if (!loc || loc.length < 4) {
      window.ItemTracker?.toast("Enter a valid location code (e.g. WF291503)", "error");
      return;
    }
    const already = (overrides.virtual_locations || []).some(v => v.location === loc);
    if (already) {
      window.ItemTracker?.toast("That location already exists", "error");
      return;
    }
    if (!overrides.virtual_locations) overrides.virtual_locations = [];
    overrides.virtual_locations.push({ id: Date.now().toString(36), location: loc, bin_size: bs });
    if (virtualLocCode)    virtualLocCode.value    = "";
    if (virtualLocBinSize) virtualLocBinSize.value = "";
    markDirty(); renderVirtualLocations(); buildEditorScene();
  });

  // Save
  saveButton?.addEventListener("click", async () => {
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    try {
      const res  = await fetch("/api/admin/layout-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(overrides)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
      overrides = { ...overrides, ...(data.overrides || {}) };
      dirty = false;
      if (saveChip)   saveChip.hidden = true;
      saveButton.textContent = "Saved ✓";
      setTimeout(() => { if (saveButton) saveButton.textContent = "Save layout"; }, 2000);
      window.ItemTracker?.toast("Layout overrides saved", "success");
    } catch (err) {
      window.ItemTracker?.toast(err.message || "Could not save", "error");
      saveButton.textContent = "Save layout";
    } finally {
      saveButton.disabled = false;
    }
  });
}

function markDirty() {
  dirty = true;
  if (saveChip)   saveChip.hidden = false;
  if (saveButton) saveButton.disabled = false;
}

// ── Boot ───────────────────────────────────────────────────────────────────────
if (canvas) {
  renderBinSizes();
  renderVirtualLocations();
  if (noSelectionWrap)   noSelectionWrap.hidden   = false;
  if (selectionControls) selectionControls.hidden = true;
  wireControls();
  initScene();
}
