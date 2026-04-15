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
let warehouseLocs = null;    // full location list fetched from /api/admin/layout-locations

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
const reverseBayWrap      = document.getElementById("editorReverseBayWrap");
const reverseBayToggle    = document.getElementById("editorReverseBay");

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
    const rotY        = Number(ovr.rotation_y || 0);
    const reverseDir  = !!(ovr.reverse_bay_dir);
    const startX  = zoneOffsetX + xOffset;
    const width   = Math.max(visAisles.length - 1, 0) * aisleSpacing + 4;
    const depth   = 30;
    const centerX = startX + width / 2 - 2;
    const centerZ = zOffset - depth / 2 + 4;
    result.push({ zone, key, active, visAisles, width, depth, centerX, centerZ, rotY, reverseDir });
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
      coords.set(aisle.prefix, { x: baseX + i * aisleSpacing, zoneDepth: z.depth, zoneZ: z.centerZ, rotY: z.rotY, reverseDir: z.reverseDir });
    });
  }
  return coords;
}

// ── Build scene ────────────────────────────────────────────────────────────────
function buildEditorScene() {
  // Clear old meshes
  sc.zoneMeshes.forEach(m => sc.scene.remove(m));
  sc.zoneMeshes.clear();
  sc.locMeshes.clear(); // instance refs — meshes removed via zoneMeshes above

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

// In bay/location mode: render each location as a small cube via InstancedMesh for performance
function buildLocationDots(aisleCoords) {
  const allLocations = getAllLocations(aisleCoords);
  if (!allLocations.length) return;

  const geo  = new THREE.BoxGeometry(0.88, 0.88, 0.68);
  const dummy = new THREE.Object3D();

  // Bucket locations by colour category
  const buckets = {
    selected: [],  // selected location
    bay:      [],  // same bay as selected
    virtual:  [],  // virtual
    default:  [],  // everything else
  };
  const selBayPrefix = selection?.type === "bay"      ? selection.key : null;
  const selLocKey    = selection?.type === "location"  ? selection.key : null;

  for (const loc of allLocations) {
    if      (selLocKey && loc.location === selLocKey)              buckets.selected.push(loc);
    else if (selBayPrefix && loc.bayKey === selBayPrefix)          buckets.bay.push(loc);
    else if (loc.is_virtual)                                        buckets.virtual.push(loc);
    else                                                            buckets.default.push(loc);
  }

  const configs = [
    { list: buckets.default,  color: "#2a4a6a", opacity: 1,   transparent: false },
    { list: buckets.bay,      color: BAY_COLOR,  opacity: 1,   transparent: false },
    { list: buckets.virtual,  color: VIRTUAL_COLOR, opacity: 1, transparent: false },
    { list: buckets.selected, color: SEL_COLOR,  opacity: 1,   transparent: false },
  ];

  for (const { list, color } of configs) {
    if (!list.length) continue;
    const mat  = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1 });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    list.forEach((loc, i) => {
      dummy.position.set(loc.x, loc.y, loc.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // Store userData on each instance via a parallel Map
      sc.locMeshes.set(loc.location, { mesh, index: i, userData: { type: "loc", key: loc.location, bayKey: loc.bayKey } });
    });

    mesh.userData = { instancedLocs: list };
    sc.scene.add(mesh);
    sc.zoneMeshes.set("__locs__" + color, mesh); // register for raycasting via zoneMeshes reuse
  }
}

// Generate world positions for every known location.
// Uses warehouseLocs (fetched from server) for the full set.
// Falls back to locations derived from overrides if data not loaded yet.
function getAllLocations(aisleCoords) {
  const BAY_STEP   = 2.4;
  const AISLE_HALF = 1.5;
  const result = [];

  // Source: full snapshot data if loaded, otherwise derive from overrides only
  const source = warehouseLocs || deriveLocsFromOverrides();

  for (const row of source) {
    const prefix = String(row.aisle_prefix || row.location?.slice(0, 2) || "").toUpperCase();
    const ac = aisleCoords.get(prefix);
    if (!ac) continue;

    const bay   = Number(row.bay)   || 0;
    const level = Number(row.level) || 10;
    const slot  = Number(row.slot)  || 1;

    const locOvr = overrides.locations[row.location] || {};
    const bayKey = prefix + String(bay).padStart(2, "0");
    const bayOvr = overrides.bays[bayKey] || {};

    const bayPair   = Math.ceil(bay / 2);
    const isEvenBay = (bay % 2) === 0;
    const sideSign  = isEvenBay ? 1 : -1;
    const depthSign = ac.reverseDir ? 1 : -1;
    // Slot 01 toward entrance (–Z), slot 02 toward back (+Z)
    const slotZOff  = slot <= 1 ? -0.525 : 0.525;

    const x = ac.x + sideSign * AISLE_HALF + Number(locOvr.x_offset || bayOvr.x_offset || 0);
    const y = Math.max(0.45, Math.round(level / 10) * 1.18 + 0.6) + Number(locOvr.y_offset || 0);
    const z = depthSign * -(bayPair * BAY_STEP) + slotZOff + Number(locOvr.z_offset || bayOvr.z_offset || 0);

    result.push({ location: row.location, bayKey, x, y, z, is_virtual: !!(row.is_virtual) });
  }

  return result;
}

// Fallback: derive a minimal location set from overrides when snapshot not yet loaded
function deriveLocsFromOverrides() {
  const codes = new Set([
    ...Object.keys(overrides.locations),
    ...(overrides.virtual_locations || []).map(v => v.location)
  ]);
  for (const bayKey of Object.keys(overrides.bays)) {
    const prefix = bayKey.slice(0, 2);
    const bay    = bayKey.slice(2);
    for (let level = 10; level <= 50; level += 10) {
      for (let slot = 1; slot <= 2; slot++) {
        codes.add(`${prefix}${bay}${String(level).padStart(2,"0")}0${slot}`);
      }
    }
  }
  return Array.from(codes).map(code => {
    const digits = code.slice(2).replace(/\D/g, "");
    return {
      location: code,
      aisle_prefix: code.slice(0, 2).toUpperCase(),
      bay:   digits.slice(0, 2),
      level: digits.slice(2, 4),
      slot:  digits.slice(4, 6),
      is_virtual: (overrides.virtual_locations || []).some(v => v.location === code)
    };
  });
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

  // Collect all clickable meshes (zone slabs + instanced location meshes)
  const clickable = [];
  sc.zoneMeshes.forEach(m => clickable.push(m));

  const hits = sc.raycaster.intersectObjects(clickable, false);
  if (!hits.length) return;

  const hit = hits[0];
  const ud  = hit.object.userData;

  if (ud.type === "zone" && selMode === "zone") {
    const zone = (layout.zones || []).find(z => z.zone_key === ud.key);
    if (zone) selectItem("zone", ud.key, zone.zone_label || ud.key, zone);
    return;
  }

  // InstancedMesh hit — resolve which location was clicked via instanceId
  if (ud.instancedLocs && hit.instanceId != null) {
    const loc = ud.instancedLocs[hit.instanceId];
    if (!loc) return;
    if (selMode === "bay") {
      selectItem("bay", loc.bayKey, loc.bayKey, null);
    } else if (selMode === "location") {
      selectItem("location", loc.location, loc.location, null);
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
  // Reverse bay direction + aisle list only for zones
  if (reverseBayWrap) reverseBayWrap.hidden = (type !== "zone");
  if (aisleSection)   aisleSection.hidden   = (type !== "zone");

  if (activeLabel) {
    activeLabel.textContent = type === "zone" ? "Zone visible in heatmap" :
                              type === "bay"  ? "Bay visible in heatmap"  : "Location visible";
  }

  // Load current overrides into controls
  let ovr = {};
  if (type === "zone")     ovr = overrides.zones[key]     || {};
  if (type === "bay")      ovr = overrides.bays[key]      || {};
  if (type === "location") ovr = overrides.locations[key] || {};

  if (xOffsetInput)    xOffsetInput.value     = String(ovr.x_offset       || 0);
  if (yOffsetInput)    yOffsetInput.value      = String(ovr.y_offset       || 0);
  if (zOffsetInput)    zOffsetInput.value      = String(ovr.z_offset       || 0);
  if (rotationYSelect) rotationYSelect.value   = String(ovr.rotation_y     || 0);
  if (activeToggle)    activeToggle.checked    = ovr.active !== false;
  if (reverseBayToggle) reverseBayToggle.checked = !!(ovr.reverse_bay_dir);

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
      const removed = overrides.virtual_locations[idx]?.location;
      overrides.virtual_locations.splice(idx, 1);
      if (warehouseLocs && removed) {
        const li = warehouseLocs.findIndex(r => r.location === removed && r.is_virtual);
        if (li !== -1) warehouseLocs.splice(li, 1);
      }
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

  // Reverse bay direction (zone-only toggle)
  reverseBayToggle?.addEventListener("change", () => {
    if (!selection || selection.type !== "zone") return;
    if (!overrides.zones[selection.key]) overrides.zones[selection.key] = {};
    overrides.zones[selection.key].reverse_bay_dir = reverseBayToggle.checked;
    markDirty();
    buildEditorScene();
  });

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
    // Inject into live warehouseLocs so it renders immediately without a reload
    if (warehouseLocs && !warehouseLocs.some(r => r.location === loc)) {
      const digits = loc.slice(2).replace(/\D/g, "");
      warehouseLocs.push({ location: loc, aisle_prefix: loc.slice(0,2).toUpperCase(),
        bay: digits.slice(0,2), level: digits.slice(2,4), slot: digits.slice(4,6),
        bin_size: bs, is_virtual: true });
    }
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

// ── Load full warehouse location data ─────────────────────────────────────────
async function loadWarehouseLocations() {
  const hintEl = document.getElementById("editorHint");
  const hintTx = document.getElementById("editorHintText");
  if (hintTx) hintTx.textContent = "Loading warehouse locations…";
  if (hintEl) hintEl.hidden = false;

  try {
    const res  = await fetch("/api/admin/layout-locations");
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data.locations)) throw new Error(data.error || "Failed to load");
    warehouseLocs = data.locations;
    buildEditorScene(); // rebuild with full data
    if (hintTx) hintTx.textContent = selMode === "zone" ? "Click a zone to select" : "Click a block to select";
    if (hintEl) hintEl.hidden = false;
    if (zoneChip) zoneChip.textContent = `${(layout.zones || []).length} zone${(layout.zones || []).length === 1 ? "" : "s"} · ${warehouseLocs.length.toLocaleString()} locations`;
  } catch (err) {
    console.error("layout-editor: failed to load locations", err);
    if (hintTx) hintTx.textContent = "⚠ Could not load locations — check server";
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────────
if (canvas) {
  renderBinSizes();
  renderVirtualLocations();
  if (noSelectionWrap)   noSelectionWrap.hidden   = false;
  if (selectionControls) selectionControls.hidden = true;
  wireControls();
  initScene();
  loadWarehouseLocations();
}
