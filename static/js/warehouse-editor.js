// ── Warehouse Editor — standalone ES module ───────────────────────────────────
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const BAY_STEP   = 2.6;
const AISLE_HALF = 1.5;
const SHELF_GAP  = 0.03;

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  rawLocations: [],      // raw rows from API
  allLocations: [],      // computed { location, bayKey, aisleKey, zoneKey, x, y, z, w, h, d, bin_size, is_virtual }
  locMap:       new Map(), // location code → { ...loc, index }
  overrides:    { zones: {}, aisles: {}, bays: {}, locations: {}, bin_sizes: {}, virtual_locations: [] },
  layout:       { zones: [], aisle_order: [] },
  selection:    new Set(),
  history:      [],
  historyIndex: -1,
  dirty:        false,
  mode:         "select", // "select" | "box"
};

// ── Scene container ───────────────────────────────────────────────────────────
const sc = {
  renderer:     null,
  scene:        null,
  camera:       null,
  controls:     null,
  locationMesh: null,
  raycaster:    new THREE.Raycaster(),
  pointer:      new THREE.Vector2(),
};

// ── Box-select state ──────────────────────────────────────────────────────────
const boxSel = {
  active:   false,
  startX:   0,
  startY:   0,
  currentX: 0,
  currentY: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const mmToM = v => Number(v) > 10 ? Number(v) / 1000 : Number(v);

function getWHD(row, overrides) {
  const code = String(row.bin_size || "").trim().toUpperCase();
  const dims  = code ? (overrides.bin_sizes[code] || null) : null;
  return {
    w: mmToM(dims?.width  ?? 1050),
    h: mmToM(dims?.height ?? 1050),
    d: mmToM(dims?.depth  ?? 800),
  };
}

// ── Zone layout computation (mirrors layout-editor.js) ────────────────────────
function computeZoneLayouts(layout, overrides) {
  let zoneOffsetX = 0;
  const aisleSpacing = 5.2;
  const zoneGap      = 16;
  const result       = [];

  for (const zone of (layout.zones || [])) {
    const key     = zone.zone_key || "";
    const ovr     = overrides.zones[key] || {};
    const visAisles = (zone.aisles || []).filter(
      a => (overrides.aisles[a.prefix] || {}).active !== false
    );
    const xOffset    = Number(ovr.x_offset || 0);
    const zOffset    = Number(ovr.z_offset || 0);
    const reverseDir = !!(ovr.reverse_bay_dir);
    const startX     = zoneOffsetX + xOffset;
    const width      = Math.max(visAisles.length - 1, 0) * aisleSpacing + 4;
    const centerX    = startX + width / 2 - 2;
    const centerZ    = zOffset;

    result.push({ zone, key, visAisles, width, centerX, centerZ, zOffset, reverseDir, startX });
    zoneOffsetX += visAisles.length * aisleSpacing + zoneGap;
  }
  return result;
}

// Build per-aisle X coordinate map
function buildAisleCoords(zoneLayouts) {
  const coords = new Map();
  const aisleSpacing = 5.2;
  for (const z of zoneLayouts) {
    const baseX = z.startX;
    z.visAisles.forEach((aisle, i) => {
      // Also factor in per-aisle x_offset
      const aisleOvr = {}; // aisles store only active in the layout-editor pattern
      coords.set(aisle.prefix, {
        x:           baseX + i * aisleSpacing,
        zoneZOffset: z.zOffset,
        reverseDir:  z.reverseDir,
        zoneKey:     z.key,
      });
    });
  }
  return coords;
}

// ── Full position computation ──────────────────────────────────────────────────
function computeAllPositions(rawLocations, layout, overrides) {
  const zoneLayouts  = computeZoneLayouts(layout, overrides);
  const aisleCoords  = buildAisleCoords(zoneLayouts);
  const result       = [];

  // Pass 1: slot info per bay+level
  const levelSlotInfo = new Map();
  for (const row of rawLocations) {
    const prefix   = String(row.aisle_prefix || row.location?.slice(0, 2) || "").toUpperCase();
    const bay      = Number(row.bay)   || 0;
    const levelNum = Number(row.level) || 0;
    const slot     = Number(row.slot)  || 1;
    const lKey     = prefix + String(bay).padStart(2, "0") + "L" + levelNum;
    const { w, h, d } = getWHD(row, overrides);
    const ex = levelSlotInfo.get(lKey);
    if (!ex) {
      levelSlotInfo.set(lKey, { maxSlot: slot, w, h, d });
    } else {
      if (slot > ex.maxSlot) ex.maxSlot = slot;
      if (h > ex.h) ex.h = h;
    }
  }

  // Pass 2: stacked Y base per bay+level
  const levelBaseY = new Map();
  const bayLevels  = new Map();
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

  // Main loop
  for (const row of rawLocations) {
    const prefix = String(row.aisle_prefix || row.location?.slice(0, 2) || "").toUpperCase();
    const ac = aisleCoords.get(prefix);
    if (!ac) continue;

    const bay   = Number(row.bay)   || 0;
    const level = Number(row.level) || 0;
    const slot  = Number(row.slot)  || 1;

    const locOvr = overrides.locations[row.location] || {};
    const bayKey = prefix + String(bay).padStart(2, "0");
    const bayOvr = overrides.bays[bayKey] || {};

    const { w, h, d } = getWHD(row, overrides);

    const bayPair   = Math.ceil(bay / 2);
    const isEvenBay = (bay % 2) === 0;
    const sideSign  = isEvenBay ? 1 : -1;
    const depthSign = ac.reverseDir ? 1 : -1;

    const lKey       = bayKey + "L" + level;
    const levelInfo  = levelSlotInfo.get(lKey);
    const totalSlots = levelInfo?.maxSlot || 1;
    const slotZOff   = (slot - 1 - (totalSlots - 1) / 2) * w;

    const x     = ac.x + sideSign * AISLE_HALF + Number(locOvr.x_offset || bayOvr.x_offset || 0);
    const baseY = levelBaseY.get(lKey) || 0;
    const y     = baseY + h * 0.5 + Number(locOvr.y_offset || 0);
    const z     = depthSign * -(bayPair * BAY_STEP) + slotZOff + (ac.zoneZOffset || 0) + Number(locOvr.z_offset || bayOvr.z_offset || 0);

    result.push({
      location:   row.location,
      bayKey,
      aisleKey:   prefix,
      zoneKey:    ac.zoneKey,
      x, y, z, w, h, d,
      bin_size:   row.bin_size,
      is_virtual: !!(row.is_virtual),
    });
  }

  return result;
}

// ── Three.js scene init ───────────────────────────────────────────────────────
function initScene() {
  const canvas = document.getElementById("we-canvas");

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b1523");
  scene.fog = new THREE.Fog("#0b1523", 150, 800);

  const wrap = document.getElementById("we-canvas-wrap");
  const W = wrap.clientWidth  || 900;
  const H = wrap.clientHeight || 600;
  const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 2000);
  camera.position.set(80, 90, 120);
  renderer.setSize(W, H, false);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping  = true;
  controls.dampingFactor  = 0.08;
  controls.maxPolarAngle  = Math.PI / 2.05;
  controls.minDistance    = 5;
  controls.maxDistance    = 1200;

  scene.add(new THREE.AmbientLight("#dce6ff", 1.2));
  const kl = new THREE.DirectionalLight("#ffffff", 1.1);
  kl.position.set(50, 100, 50);
  scene.add(kl);
  const fl = new THREE.DirectionalLight("#7ab4ff", 0.5);
  fl.position.set(-50, 40, -30);
  scene.add(fl);

  const grid = new THREE.GridHelper(2000, 300, "#1a3050", "#0e2040");
  grid.position.y = -0.7;
  scene.add(grid);

  sc.renderer = renderer;
  sc.scene    = scene;
  sc.camera   = camera;
  sc.controls = controls;

  window.addEventListener("resize", onResize);

  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    updateCameraStatus();
  })();
}

function onResize() {
  const wrap = document.getElementById("we-canvas-wrap");
  if (!wrap || !sc.renderer) return;
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  sc.camera.aspect = W / H;
  sc.camera.updateProjectionMatrix();
  sc.renderer.setSize(W, H, false);
}

// ── InstancedMesh build ───────────────────────────────────────────────────────
function buildLocationMesh(positions) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({
    roughness:    0.45,
    metalness:    0.1,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(positions.length * 3), 3
  );

  const dummy        = new THREE.Object3D();
  const defaultColor = new THREE.Color("#2a5080");

  positions.forEach((loc, i) => {
    dummy.position.set(loc.x, loc.y, loc.z);
    dummy.scale.set(loc.d, loc.h, loc.w);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, defaultColor);
  });

  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate  = true;
  mesh.userData.isLocationMesh    = true;
  return mesh;
}

// ── Color update ──────────────────────────────────────────────────────────────
function updateInstanceColors() {
  if (!sc.locationMesh) return;
  const selColor     = new THREE.Color("#88aaff");
  const defaultColor = new THREE.Color("#2a5080");
  const virtualColor = new THREE.Color("#30d880");

  state.allLocations.forEach((loc, i) => {
    const color = state.selection.has(loc.location) ? selColor
                : loc.is_virtual                    ? virtualColor
                : defaultColor;
    sc.locationMesh.setColorAt(i, color);
  });
  sc.locationMesh.instanceColor.needsUpdate = true;
}

// ── Rebuild positions after override change ───────────────────────────────────
function rebuildPositions() {
  state.allLocations = computeAllPositions(state.rawLocations, state.layout, state.overrides);
  state.locMap       = new Map(
    state.allLocations.map((l, i) => [l.location, { ...l, index: i }])
  );

  if (!sc.locationMesh) return;
  const dummy = new THREE.Object3D();
  state.allLocations.forEach((loc, i) => {
    dummy.position.set(loc.x, loc.y, loc.z);
    dummy.scale.set(loc.d, loc.h, loc.w);
    dummy.updateMatrix();
    sc.locationMesh.setMatrixAt(i, dummy.matrix);
  });
  sc.locationMesh.instanceMatrix.needsUpdate = true;
  updateInstanceColors();
}

// ── Undo / Redo ───────────────────────────────────────────────────────────────
function snapshotHistory() {
  state.history.splice(state.historyIndex + 1);
  state.history.push(JSON.parse(JSON.stringify(state.overrides)));
  state.historyIndex = state.history.length - 1;
  if (state.history.length > 50) {
    state.history.shift();
    state.historyIndex--;
  }
  updateUndoRedoButtons();
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  state.overrides = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
  rebuildPositions();
  markDirty();
  updateUndoRedoButtons();
  updateOverrideLevelDisplay();
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  state.overrides = JSON.parse(JSON.stringify(state.history[state.historyIndex]));
  rebuildPositions();
  markDirty();
  updateUndoRedoButtons();
  updateOverrideLevelDisplay();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById("we-undo");
  const redoBtn = document.getElementById("we-redo");
  if (undoBtn) undoBtn.disabled = state.historyIndex <= 0;
  if (redoBtn) redoBtn.disabled = state.historyIndex >= state.history.length - 1;
}

// ── Override level detection ──────────────────────────────────────────────────
function detectOverrideLevel(selectedCodes) {
  const bays   = new Set(selectedCodes.map(c => state.locMap.get(c)?.bayKey).filter(Boolean));
  const aisles = new Set(selectedCodes.map(c => state.locMap.get(c)?.aisleKey).filter(Boolean));
  const zones  = new Set(selectedCodes.map(c => state.locMap.get(c)?.zoneKey).filter(Boolean));
  if (bays.size   === 1) return { level: "bay",      key: [...bays][0] };
  if (aisles.size === 1) return { level: "aisle",    key: [...aisles][0] };
  if (zones.size  === 1) return { level: "zone",     key: [...zones][0] };
  return { level: "location", key: null };
}

// ── Apply offset ──────────────────────────────────────────────────────────────
function applyOffset(dx, dy, dz, absolute = false) {
  if (!state.selection.size) return;
  snapshotHistory();

  const sel             = [...state.selection];
  const { level, key } = detectOverrideLevel(sel);

  if (level === "bay") {
    const ovr = state.overrides.bays[key] || {};
    state.overrides.bays[key] = {
      ...ovr,
      x_offset: absolute ? dx : (Number(ovr.x_offset || 0) + dx),
      z_offset: absolute ? dz : (Number(ovr.z_offset || 0) + dz),
    };
    if (dy !== 0) {
      for (const code of sel) {
        const lo = state.overrides.locations[code] || {};
        state.overrides.locations[code] = {
          ...lo,
          y_offset: absolute ? dy : (Number(lo.y_offset || 0) + dy),
        };
      }
    }
  } else if (level === "aisle") {
    const ovr = state.overrides.aisles[key] || {};
    state.overrides.aisles[key] = {
      ...ovr,
      x_offset: absolute ? dx : (Number(ovr.x_offset || 0) + dx),
      z_offset: absolute ? dz : (Number(ovr.z_offset || 0) + dz),
    };
    if (dy !== 0) {
      for (const code of sel) {
        const lo = state.overrides.locations[code] || {};
        state.overrides.locations[code] = {
          ...lo,
          y_offset: absolute ? dy : (Number(lo.y_offset || 0) + dy),
        };
      }
    }
  } else if (level === "zone") {
    const ovr = state.overrides.zones[key] || {};
    state.overrides.zones[key] = {
      ...ovr,
      x_offset: absolute ? dx  : (Number(ovr.x_offset || 0) + dx),
      z_offset: absolute ? dz  : (Number(ovr.z_offset || 0) + dz),
    };
    if (dy !== 0) {
      for (const code of sel) {
        const lo = state.overrides.locations[code] || {};
        state.overrides.locations[code] = {
          ...lo,
          y_offset: absolute ? dy : (Number(lo.y_offset || 0) + dy),
        };
      }
    }
  } else {
    for (const code of sel) {
      const lo = state.overrides.locations[code] || {};
      state.overrides.locations[code] = {
        ...lo,
        x_offset: absolute ? dx : (Number(lo.x_offset || 0) + dx),
        y_offset: absolute ? dy : (Number(lo.y_offset || 0) + dy),
        z_offset: absolute ? dz : (Number(lo.z_offset || 0) + dz),
      };
    }
  }

  rebuildPositions();
  markDirty();
  updateOverrideLevelDisplay();
}

// ── Reset offsets for selection ───────────────────────────────────────────────
function resetSelectionOffsets() {
  if (!state.selection.size) return;
  snapshotHistory();

  const sel             = [...state.selection];
  const { level, key } = detectOverrideLevel(sel);

  if (level === "bay" && key) {
    const ovr = { ...state.overrides.bays[key] };
    delete ovr.x_offset;
    delete ovr.z_offset;
    state.overrides.bays[key] = ovr;
  } else if (level === "aisle" && key) {
    const ovr = { ...state.overrides.aisles[key] };
    delete ovr.x_offset;
    delete ovr.z_offset;
    state.overrides.aisles[key] = ovr;
  } else if (level === "zone" && key) {
    const ovr = { ...state.overrides.zones[key] };
    delete ovr.x_offset;
    delete ovr.z_offset;
    state.overrides.zones[key] = ovr;
  }

  for (const code of sel) {
    const ovr = { ...state.overrides.locations[code] };
    delete ovr.x_offset;
    delete ovr.y_offset;
    delete ovr.z_offset;
    if (Object.keys(ovr).length === 0) {
      delete state.overrides.locations[code];
    } else {
      state.overrides.locations[code] = ovr;
    }
  }

  rebuildPositions();
  markDirty();
  updateOverrideLevelDisplay();
}

// ── Dirty state ───────────────────────────────────────────────────────────────
function markDirty() {
  state.dirty = true;
  updateDirtyState();
}

function updateDirtyState() {
  const chip    = document.getElementById("we-dirty-chip");
  const saveBtn = document.getElementById("we-save");
  if (chip)    chip.hidden    = !state.dirty;
  if (saveBtn) saveBtn.disabled = !state.dirty;
}

// ── Save to server ────────────────────────────────────────────────────────────
async function saveToServer() {
  const saveBtn = document.getElementById("we-save");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
  try {
    const res  = await fetch("/api/admin/layout-overrides", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(state.overrides),
    });
    const data = await res.json();
    if (data.ok) {
      state.dirty = false;
      updateDirtyState();
    } else {
      alert("Save failed: " + (data.error || "Unknown error"));
    }
  } catch (err) {
    alert("Save failed: " + err.message);
  } finally {
    if (saveBtn) saveBtn.textContent = "Save to server";
    updateDirtyState();
  }
}

// ── Selection helpers ─────────────────────────────────────────────────────────
function setSelection(codes, additive = false) {
  if (!additive) state.selection.clear();
  for (const c of codes) state.selection.add(c);
  afterSelectionChange();
}

function toggleSelection(code) {
  if (state.selection.has(code)) {
    state.selection.delete(code);
  } else {
    state.selection.add(code);
  }
  afterSelectionChange();
}

function clearSelection() {
  state.selection.clear();
  afterSelectionChange();
}

function afterSelectionChange() {
  updateInstanceColors();
  updateSelectionUI();
  updateStatusBar();
}

function updateSelectionUI() {
  const count    = state.selection.size;
  const countEl  = document.getElementById("we-sel-count");
  const deselBtn = document.getElementById("we-deselect");
  const panel    = document.getElementById("we-panel");
  const infoEl   = document.getElementById("we-panel-sel-info");

  if (countEl)  countEl.textContent = count + " selected";
  if (deselBtn) deselBtn.disabled   = count === 0;

  if (count === 0) {
    if (panel)  panel.classList.add("collapsed");
    if (infoEl) infoEl.textContent = "Nothing selected";
  } else {
    if (panel)  panel.classList.remove("collapsed");
    if (infoEl) {
      const sel = [...state.selection];
      if (sel.length === 1) {
        infoEl.textContent = sel[0];
      } else if (sel.length <= 4) {
        infoEl.textContent = sel.join(", ");
      } else {
        infoEl.textContent = sel.slice(0, 3).join(", ") + " +" + (sel.length - 3) + " more";
      }
    }
    updateOverrideLevelDisplay();
  }
}

function updateOverrideLevelDisplay() {
  const el = document.getElementById("we-ovr-level");
  if (!el || !state.selection.size) return;
  const { level, key } = detectOverrideLevel([...state.selection]);
  const labels = { bay: "Bay", aisle: "Aisle", zone: "Zone", location: "Per-location" };
  el.textContent = labels[level] + (key ? ` (${key})` : "");
}

// ── Status bar ────────────────────────────────────────────────────────────────
function updateStatusBar() {
  const locsEl = document.getElementById("we-status-locs");
  if (locsEl) {
    const n = state.allLocations.length;
    const s = state.selection.size;
    locsEl.textContent = n + " locations" + (s ? ` · ${s} selected` : "");
  }
}

function updateCameraStatus() {
  const camEl = document.getElementById("we-status-cam");
  if (!camEl || !sc.camera) return;
  const p = sc.camera.position;
  camEl.textContent = `cam (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`;
}

// ── Mode switch ───────────────────────────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".we-tool-btn[data-mode]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  const hint = document.getElementById("we-status-hint");
  if (hint) {
    hint.textContent = mode === "box"
      ? "Drag to box-select · Shift+drag to add to selection"
      : "Click to select · Shift+click to add · Drag to orbit";
  }
  // Disable OrbitControls in box mode so dragging creates a box
  if (sc.controls) sc.controls.enabled = (mode !== "box");
}

// ── Click / raycast ───────────────────────────────────────────────────────────
function onCanvasClick(e) {
  if (state.mode !== "select") return;
  if (boxSel.active) return;

  const canvas = document.getElementById("we-canvas");
  const rect   = canvas.getBoundingClientRect();
  sc.pointer.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
  sc.pointer.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1;

  sc.raycaster.setFromCamera(sc.pointer, sc.camera);

  if (!sc.locationMesh) return;
  const hits = sc.raycaster.intersectObject(sc.locationMesh);
  if (!hits.length) {
    if (!e.shiftKey) clearSelection();
    return;
  }

  const hit = hits[0];
  const loc = state.allLocations[hit.instanceId];
  if (!loc) return;

  if (e.shiftKey) {
    toggleSelection(loc.location);
  } else {
    setSelection([loc.location]);
  }
}

// ── Box select ────────────────────────────────────────────────────────────────
function onBoxPointerDown(e) {
  if (state.mode !== "box") return;
  const wrap = document.getElementById("we-canvas-wrap");
  const rect = wrap.getBoundingClientRect();
  boxSel.active   = true;
  boxSel.startX   = e.clientX - rect.left;
  boxSel.startY   = e.clientY - rect.top;
  boxSel.currentX = boxSel.startX;
  boxSel.currentY = boxSel.startY;

  const div = document.getElementById("we-box-sel");
  if (div) {
    div.hidden = false;
    updateBoxSelDiv(div);
  }
}

function onBoxPointerMove(e) {
  if (!boxSel.active) return;
  const wrap = document.getElementById("we-canvas-wrap");
  const rect = wrap.getBoundingClientRect();
  boxSel.currentX = e.clientX - rect.left;
  boxSel.currentY = e.clientY - rect.top;

  const div = document.getElementById("we-box-sel");
  if (div) updateBoxSelDiv(div);
}

function onBoxPointerUp(e) {
  if (!boxSel.active) return;
  boxSel.active = false;

  const div = document.getElementById("we-box-sel");
  if (div) div.hidden = true;

  const wrap = document.getElementById("we-canvas-wrap");
  const rect = wrap.getBoundingClientRect();

  const x1 = Math.min(boxSel.startX, boxSel.currentX);
  const y1 = Math.min(boxSel.startY, boxSel.currentY);
  const x2 = Math.max(boxSel.startX, boxSel.currentX);
  const y2 = Math.max(boxSel.startY, boxSel.currentY);

  // Tiny drag = treat as click, ignore
  if ((x2 - x1) < 4 && (y2 - y1) < 4) return;

  const W = rect.width;
  const H = rect.height;

  // Convert box to NDC range
  const ndcX1 = (x1 / W) *  2 - 1;
  const ndcX2 = (x2 / W) *  2 - 1;
  const ndcY1 = (y1 / H) * -2 + 1;
  const ndcY2 = (y2 / H) * -2 + 1;
  const ndcMinX = Math.min(ndcX1, ndcX2);
  const ndcMaxX = Math.max(ndcX1, ndcX2);
  const ndcMinY = Math.min(ndcY1, ndcY2);
  const ndcMaxY = Math.max(ndcY1, ndcY2);

  const tempVec = new THREE.Vector3();
  const matched = [];

  for (const loc of state.allLocations) {
    tempVec.set(loc.x, loc.y, loc.z);
    tempVec.project(sc.camera);
    if (
      tempVec.x >= ndcMinX && tempVec.x <= ndcMaxX &&
      tempVec.y >= ndcMinY && tempVec.y <= ndcMaxY
    ) {
      matched.push(loc.location);
    }
  }

  setSelection(matched, e.shiftKey);
}

function updateBoxSelDiv(div) {
  const x = Math.min(boxSel.startX, boxSel.currentX);
  const y = Math.min(boxSel.startY, boxSel.currentY);
  const w = Math.abs(boxSel.currentX - boxSel.startX);
  const h = Math.abs(boxSel.currentY - boxSel.startY);
  div.style.left   = x + "px";
  div.style.top    = y + "px";
  div.style.width  = w + "px";
  div.style.height = h + "px";
}

// ── Hierarchy tree ────────────────────────────────────────────────────────────
function buildTree() {
  const container = document.getElementById("we-tree");
  if (!container) return;
  container.innerHTML = "";

  // Build counts
  const bayCount   = new Map(); // bayKey → count
  const aisleCount = new Map(); // aisleKey → count
  const zoneCount  = new Map(); // zoneKey → count

  for (const loc of state.allLocations) {
    bayCount.set(loc.bayKey,   (bayCount.get(loc.bayKey)   || 0) + 1);
    aisleCount.set(loc.aisleKey, (aisleCount.get(loc.aisleKey) || 0) + 1);
    zoneCount.set(loc.zoneKey, (zoneCount.get(loc.zoneKey)   || 0) + 1);
  }

  for (const zone of (state.layout.zones || [])) {
    const zoneKey   = zone.zone_key || "";
    const zoneLabel = zone.zone_label || zoneKey;
    const count     = zoneCount.get(zoneKey) || 0;

    const zoneDetails = document.createElement("details");
    zoneDetails.className = "we-tree-zone";
    zoneDetails.dataset.zone = zoneKey;

    const zoneSummary = document.createElement("summary");
    zoneSummary.innerHTML =
      escHtml(zoneLabel) +
      `<span class="we-tree-count">${count}</span>`;
    zoneSummary.title = "Click to select all in zone";
    zoneSummary.addEventListener("click", e => {
      e.preventDefault();
      const locsInZone = state.allLocations.filter(l => l.zoneKey === zoneKey).map(l => l.location);
      setSelection(locsInZone, e.shiftKey);
      zoneDetails.open = !zoneDetails.open;
    });
    zoneDetails.appendChild(zoneSummary);

    // Aisles
    const aislesInZone = zone.aisles || [];
    for (const aisleObj of aislesInZone) {
      const prefix     = aisleObj.prefix || "";
      const aisleCount2 = aisleCount.get(prefix) || 0;

      const aisleDetails = document.createElement("details");
      aisleDetails.className = "we-tree-aisle";
      aisleDetails.dataset.aisle = prefix;

      const aisleSummary = document.createElement("summary");
      aisleSummary.innerHTML =
        `Aisle ${escHtml(prefix)}` +
        `<span class="we-tree-count">${aisleCount2}</span>`;
      aisleSummary.title = "Click to select all in aisle";
      aisleSummary.addEventListener("click", ev => {
        ev.preventDefault();
        const locsInAisle = state.allLocations.filter(l => l.aisleKey === prefix).map(l => l.location);
        setSelection(locsInAisle, ev.shiftKey);
        aisleDetails.open = !aisleDetails.open;
      });
      aisleDetails.appendChild(aisleSummary);

      // Bays within this aisle
      const bayKeys = [...new Set(
        state.allLocations
          .filter(l => l.aisleKey === prefix)
          .map(l => l.bayKey)
      )].sort();

      for (const bk of bayKeys) {
        const bCount  = bayCount.get(bk) || 0;
        const bayDiv  = document.createElement("div");
        bayDiv.className = "we-tree-bay";
        bayDiv.dataset.bay = bk;
        bayDiv.innerHTML =
          `Bay ${escHtml(bk.slice(2))}` +
          `<span class="we-tree-bay-count">${bCount}</span>`;
        bayDiv.title = "Click to select bay";
        bayDiv.addEventListener("click", ev => {
          const locsInBay = state.allLocations.filter(l => l.bayKey === bk).map(l => l.location);
          setSelection(locsInBay, ev.shiftKey);
          highlightTreeBay(bk);
        });
        aisleDetails.appendChild(bayDiv);
      }

      zoneDetails.appendChild(aisleDetails);
    }

    container.appendChild(zoneDetails);
  }
}

function highlightTreeBay(bayKey) {
  document.querySelectorAll(".we-tree-bay.selected").forEach(el => el.classList.remove("selected"));
  const el = document.querySelector(`.we-tree-bay[data-bay="${bayKey}"]`);
  if (el) el.classList.add("selected");
}

function filterTree(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll(".we-tree-aisle, .we-tree-bay, .we-tree-zone").forEach(el => {
    el.classList.remove("we-tree-hidden");
  });

  if (!q) return;

  // Hide bays that don't match
  document.querySelectorAll(".we-tree-bay").forEach(el => {
    const bay    = (el.dataset.bay    || "").toLowerCase();
    const aisle  = el.closest(".we-tree-aisle");
    const prefix = aisle ? (aisle.dataset.aisle || "").toLowerCase() : "";
    if (!bay.includes(q) && !prefix.includes(q)) {
      el.classList.add("we-tree-hidden");
    }
  });

  // Hide aisles that have no visible bays and don't match
  document.querySelectorAll(".we-tree-aisle").forEach(el => {
    const prefix     = (el.dataset.aisle || "").toLowerCase();
    const visibleBay = el.querySelector(".we-tree-bay:not(.we-tree-hidden)");
    if (!prefix.includes(q) && !visibleBay) {
      el.classList.add("we-tree-hidden");
    }
  });

  // Open matching zones/aisles
  document.querySelectorAll(".we-tree-zone").forEach(el => {
    const visibleAisle = el.querySelector(".we-tree-aisle:not(.we-tree-hidden)");
    if (visibleAisle) el.open = true;
  });
  document.querySelectorAll(".we-tree-aisle:not(.we-tree-hidden)").forEach(el => {
    el.open = true;
  });
}

// ── Utility ───────────────────────────────────────────────────────────────────
function escHtml(v) {
  return String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Wire UI ───────────────────────────────────────────────────────────────────
function wireUI() {
  // Mode buttons
  document.querySelectorAll(".we-tool-btn[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  // Undo / redo
  document.getElementById("we-undo")?.addEventListener("click", undo);
  document.getElementById("we-redo")?.addEventListener("click", redo);

  // Deselect all
  document.getElementById("we-deselect")?.addEventListener("click", clearSelection);

  // Save
  document.getElementById("we-save")?.addEventListener("click", saveToServer);

  // Panel close
  document.getElementById("we-panel-close")?.addEventListener("click", clearSelection);

  // Apply delta offset
  document.getElementById("we-apply-offset")?.addEventListener("click", () => {
    const dx = parseFloat(document.getElementById("we-dx")?.value || "0") || 0;
    const dy = parseFloat(document.getElementById("we-dy")?.value || "0") || 0;
    const dz = parseFloat(document.getElementById("we-dz")?.value || "0") || 0;
    applyOffset(dx, dy, dz, false);
  });

  // Apply absolute offset
  document.getElementById("we-apply-abs")?.addEventListener("click", () => {
    const axEl = document.getElementById("we-ax");
    const ayEl = document.getElementById("we-ay");
    const azEl = document.getElementById("we-az");
    const ax = axEl?.value !== "" ? parseFloat(axEl.value) : null;
    const ay = ayEl?.value !== "" ? parseFloat(ayEl.value) : null;
    const az = azEl?.value !== "" ? parseFloat(azEl.value) : null;
    if (ax !== null || ay !== null || az !== null) {
      applyOffset(ax ?? 0, ay ?? 0, az ?? 0, true);
    }
  });

  // Reset selection offsets
  document.getElementById("we-reset-sel")?.addEventListener("click", resetSelectionOffsets);

  // Canvas click
  const canvas = document.getElementById("we-canvas");
  canvas?.addEventListener("click", onCanvasClick);

  // Box select
  const wrap = document.getElementById("we-canvas-wrap");
  wrap?.addEventListener("pointerdown", onBoxPointerDown);
  wrap?.addEventListener("pointermove", onBoxPointerMove);
  wrap?.addEventListener("pointerup",   onBoxPointerUp);

  // Search
  document.getElementById("we-search")?.addEventListener("input", e => {
    filterTree(e.target.value);
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", onKeyDown);
}

function onKeyDown(e) {
  // Don't fire shortcuts when typing in inputs
  const tag = document.activeElement?.tagName;
  const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

  if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (e.key === "z" && (e.ctrlKey || e.metaKey) &&  e.shiftKey) { e.preventDefault(); redo(); return; }
  if (e.key === "y" && (e.ctrlKey || e.metaKey))               { e.preventDefault(); redo(); return; }

  if (isInput) return;

  const mul = e.shiftKey ? 10 : 1;

  switch (e.key) {
    case "ArrowLeft":  e.preventDefault(); applyOffset(-0.1 * mul, 0, 0); break;
    case "ArrowRight": e.preventDefault(); applyOffset( 0.1 * mul, 0, 0); break;
    case "ArrowUp":    e.preventDefault(); applyOffset(0, 0, -0.1 * mul); break;
    case "ArrowDown":  e.preventDefault(); applyOffset(0, 0,  0.1 * mul); break;
    case "Escape":     clearSelection(); break;
    case "s": case "S": setMode("select"); break;
    case "b": case "B": setMode("box");    break;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  initScene();
  wireUI();

  const loadingText = document.getElementById("we-loading-text");
  if (loadingText) loadingText.textContent = "Loading warehouse data…";

  try {
    const [locsRes, ovrsRes] = await Promise.all([
      fetch("/api/admin/layout-locations"),
      fetch("/api/admin/layout-overrides"),
    ]);

    if (!locsRes.ok) throw new Error("Failed to load locations: " + locsRes.status);
    if (!ovrsRes.ok) throw new Error("Failed to load overrides: " + ovrsRes.status);

    const [locsData, ovrsData] = await Promise.all([locsRes.json(), ovrsRes.json()]);

    state.rawLocations = locsData.locations || [];
    const ovr = ovrsData.overrides || {};
    state.overrides = {
      zones:             ovr.zones             || {},
      aisles:            ovr.aisles            || {},
      bays:              ovr.bays              || {},
      locations:         ovr.locations         || {},
      bin_sizes:         ovr.bin_sizes         || {},
      virtual_locations: ovr.virtual_locations || [],
    };
    state.layout = ovrsData.layout || { zones: [], aisle_order: [] };

    state.allLocations = computeAllPositions(state.rawLocations, state.layout, state.overrides);
    state.locMap       = new Map(
      state.allLocations.map((l, i) => [l.location, { ...l, index: i }])
    );

    // Build Three.js mesh
    sc.locationMesh = buildLocationMesh(state.allLocations);
    sc.scene.add(sc.locationMesh);

    // Build hierarchy tree
    buildTree();

    updateStatusBar();
    updateDirtyState();
    updateUndoRedoButtons();

    // Snapshot initial state
    snapshotHistory();

  } catch (err) {
    if (loadingText) loadingText.textContent = "Error: " + err.message;
    console.error("Warehouse editor boot error:", err);
    return;
  }

  // Hide loading overlay
  const loadingOverlay = document.getElementById("we-loading");
  if (loadingOverlay) loadingOverlay.hidden = true;
}

boot();
