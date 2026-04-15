import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const boot     = window.LAYOUT_EDITOR_BOOTSTRAP || {};
const layout   = boot.layout   || { zones: [], aisle_order: [] };
const canvas   = document.getElementById("editorCanvas");

// ── DOM refs ─────────────────────────────────────────────────────────────────
const zoneChip         = document.getElementById("editorZoneChip");
const saveChip         = document.getElementById("editorSaveChip");
const saveButton       = document.getElementById("editorSaveButton");
const statusChip       = document.getElementById("editorStatusChip");
const resetViewButton  = document.getElementById("editorResetViewButton");
const zoneListWrap     = document.getElementById("editorZoneList");
const zoneControlsWrap = document.getElementById("editorZoneControls");
const noSelectionWrap  = document.getElementById("editorNoSelection");
const selectedZoneName = document.getElementById("editorSelectedZoneName");
const deselectButton   = document.getElementById("editorDeselectButton");
const aisleListWrap    = document.getElementById("editorAisleList");
const xOffsetInput     = document.getElementById("editorXOffset");
const zOffsetInput     = document.getElementById("editorZOffset");
const rotationYSelect  = document.getElementById("editorRotationY");
const zoneActiveToggle = document.getElementById("editorZoneActive");
const hint             = document.getElementById("editorHint");

// ── State ─────────────────────────────────────────────────────────────────────
// overrides structure: { zones: { zone_key: { x_offset, z_offset, rotation_y, active } }, aisles: { prefix: { active } } }
let overrides = structuredClone(boot.overrides || { zones: {}, aisles: {} });
if (!overrides.zones)  overrides.zones  = {};
if (!overrides.aisles) overrides.aisles = {};
let dirty          = false;
let selectedZone   = null; // zone object from layout.zones

const zoneColors = [
  "#1a4d8a", "#194d3a", "#4a2a6a", "#6a3a1a",
  "#1a6a6a", "#6a1a4a", "#3a4a1a", "#1a3a6a"
];
const selectedZoneColor = "#ffffff";

// ── Three.js ──────────────────────────────────────────────────────────────────
const sc = {
  renderer: null,
  scene:    null,
  camera:   null,
  controls: null,
  raycaster: new THREE.Raycaster(),
  pointer:   new THREE.Vector2(),
  zoneMeshes: new Map(), // zone_key → Mesh
};

function escapeHtml(v) {
  return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Compute zone positions (same logic as heatmap.js buildAisleCoords) ────────
function computeZoneLayouts() {
  let zoneOffsetX = 0;
  const aisleSpacing = 5.2;
  const zoneGap      = 16;
  const result = [];

  for (const zone of layout.zones || []) {
    const key  = zone.zone_key || "";
    const ovr  = overrides.zones[key] || {};
    const active = ovr.active !== false;
    const aisles = (zone.aisles || []).filter(
      (a) => (overrides.aisles[a.prefix] || {}).active !== false
    );
    const xOffset = Number(ovr.x_offset  || 0);
    const zOffset = Number(ovr.z_offset  || 0);
    const rotY    = Number(ovr.rotation_y || 0);

    const startX    = zoneOffsetX + xOffset;
    const width     = Math.max(aisles.length - 1, 0) * aisleSpacing + 4;
    const depth     = 28;
    const centerX   = startX + width / 2 - 2;
    const centerZ   = zOffset - depth / 2 + 4;

    result.push({ zone, key, active, width, depth, centerX, centerZ, rotY });
    zoneOffsetX += aisles.length * aisleSpacing + zoneGap;
  }
  return result;
}

// ── Build / rebuild the 3D zone blocks ───────────────────────────────────────
function buildEditorScene() {
  // Clear existing zone meshes
  sc.zoneMeshes.forEach((mesh) => sc.scene.remove(mesh));
  sc.zoneMeshes.clear();

  const zoneLayouts = computeZoneLayouts();

  zoneLayouts.forEach((z, colorIndex) => {
    const isSelected = selectedZone?.zone_key === z.key;
    const hexColor   = isSelected ? selectedZoneColor : zoneColors[colorIndex % zoneColors.length];
    const opacity    = z.active ? 0.72 : 0.28;

    const geo = new THREE.BoxGeometry(z.width, 1.2, z.depth);
    const mat = new THREE.MeshStandardMaterial({
      color: hexColor,
      transparent: true,
      opacity,
      roughness: 0.55,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(z.centerX, 0, z.centerZ);
    mesh.rotation.y = (z.rotY * Math.PI) / 180;
    mesh.userData.zoneKey = z.key;

    // Wireframe outline
    const edges = new THREE.EdgesGeometry(geo);
    const line  = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: isSelected ? "#88aaff" : "#4a7aaa",
        transparent: true,
        opacity: 0.85,
      })
    );
    mesh.add(line);

    // Text label sprite
    const sprite = makeTextSprite(z.zone.zone_label || z.key);
    sprite.position.set(0, 2.5, 0);
    mesh.add(sprite);

    sc.scene.add(mesh);
    sc.zoneMeshes.set(z.key, mesh);
  });

  if (zoneChip) {
    zoneChip.textContent = zoneLayouts.length + " zone" + (zoneLayouts.length === 1 ? "" : "s");
  }
}

function makeTextSprite(label) {
  const c   = document.createElement("canvas");
  c.width   = 384; c.height = 96;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(8,16,32,0.78)";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "rgba(136,173,255,0.8)";
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, c.width - 6, c.height - 6);
  ctx.fillStyle = "#f4f7ff";
  ctx.font = "700 40px Georgia";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, c.width / 2, c.height / 2);
  const tex  = new THREE.CanvasTexture(c);
  const mat  = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const spr  = new THREE.Sprite(mat);
  spr.scale.set(8, 2, 1);
  return spr;
}

// ── Init Three.js ─────────────────────────────────────────────────────────────
function initScene() {
  if (!canvas) return;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth || 900, canvas.clientHeight || 500, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b1523");
  scene.fog = new THREE.Fog("#0b1523", 80, 350);

  const w = canvas.clientWidth || 900, h = canvas.clientHeight || 500;
  const camera = new THREE.PerspectiveCamera(52, w / h, 0.1, 1000);
  camera.position.set(60, 70, 90);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping  = true;
  controls.dampingFactor  = 0.08;
  controls.maxPolarAngle  = Math.PI / 2.05;
  controls.minDistance    = 10;
  controls.maxDistance    = 400;

  scene.add(new THREE.AmbientLight("#dce6ff", 1.2));
  const kl = new THREE.DirectionalLight("#ffffff", 1.1);
  kl.position.set(50, 100, 50);
  scene.add(kl);
  const fl = new THREE.DirectionalLight("#7ab4ff", 0.5);
  fl.position.set(-50, 40, -30);
  scene.add(fl);

  const grid = new THREE.GridHelper(400, 100, "#24405d", "#162536");
  grid.position.y = -0.7;
  scene.add(grid);

  sc.renderer = renderer;
  sc.scene    = scene;
  sc.camera   = camera;
  sc.controls = controls;

  renderer.domElement.addEventListener("click", handleCanvasClick);
  window.addEventListener("resize", resizeScene);

  buildEditorScene();
  fitCamera();

  (function animate() {
    requestAnimationFrame(animate);
    sc.controls.update();
    sc.renderer.render(sc.scene, sc.camera);
  })();
}

function resizeScene() {
  if (!sc.renderer || !sc.camera || !canvas) return;
  const w = canvas.clientWidth || 900, h = canvas.clientHeight || 500;
  sc.renderer.setSize(w, h, false);
  sc.camera.aspect = w / h;
  sc.camera.updateProjectionMatrix();
}

function fitCamera() {
  if (!sc.camera || !sc.controls) return;
  const zoneLayouts = computeZoneLayouts();
  if (!zoneLayouts.length) return;
  const xs = zoneLayouts.map((z) => z.centerX);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const cx = (minX + maxX) / 2;
  sc.camera.position.set(cx + 60, 70, 90);
  sc.controls.target.set(cx, 0, -14);
  sc.controls.update();
}

// ── Click to select a zone ────────────────────────────────────────────────────
function handleCanvasClick(event) {
  if (!canvas || !sc.scene) return;
  const rect = canvas.getBoundingClientRect();
  sc.pointer.x =  ((event.clientX - rect.left)  / rect.width)  * 2 - 1;
  sc.pointer.y = -((event.clientY - rect.top)   / rect.height) * 2 + 1;
  sc.raycaster.setFromCamera(sc.pointer, sc.camera);

  const meshes = Array.from(sc.zoneMeshes.values());
  const hits   = sc.raycaster.intersectObjects(meshes, false);
  if (!hits.length) return;

  const zoneKey = hits[0].object.userData.zoneKey;
  const zone    = (layout.zones || []).find((z) => z.zone_key === zoneKey);
  if (zone) selectZone(zone);
}

// ── Zone selection ────────────────────────────────────────────────────────────
function selectZone(zone) {
  selectedZone = zone;
  const key = zone.zone_key || "";
  const ovr = overrides.zones[key] || {};

  if (selectedZoneName) selectedZoneName.textContent = zone.zone_label || key;
  if (xOffsetInput)     xOffsetInput.value     = String(ovr.x_offset   || 0);
  if (zOffsetInput)     zOffsetInput.value      = String(ovr.z_offset   || 0);
  if (rotationYSelect)  rotationYSelect.value   = String(ovr.rotation_y || 0);
  if (zoneActiveToggle) zoneActiveToggle.checked = ovr.active !== false;

  renderAisleList(zone);
  showZoneControls(true);
  buildEditorScene();

  if (statusChip) {
    statusChip.textContent = "Selected: " + (zone.zone_label || key);
    statusChip.classList.remove("chip--inactive");
  }
  if (hint) hint.hidden = true;
}

function deselectZone() {
  selectedZone = null;
  showZoneControls(false);
  buildEditorScene();
  if (statusChip) {
    statusChip.textContent = "No zone selected";
    statusChip.classList.add("chip--inactive");
  }
  if (hint) hint.hidden = false;
}

function showZoneControls(show) {
  if (zoneControlsWrap) zoneControlsWrap.hidden = !show;
  if (noSelectionWrap)  noSelectionWrap.hidden  =  show;
}

// ── Aisle toggle list ─────────────────────────────────────────────────────────
function renderAisleList(zone) {
  if (!aisleListWrap) return;
  const aisles = zone.aisles || [];
  if (!aisles.length) {
    aisleListWrap.innerHTML = '<p class="admin-empty">No aisles in this zone.</p>';
    return;
  }
  aisleListWrap.innerHTML = aisles.map((aisle) => {
    const ovr     = overrides.aisles[aisle.prefix] || {};
    const active  = ovr.active !== false;
    return `<label class="toggle-pill editor-aisle-toggle">
      <input type="checkbox" class="aisle-active-toggle" data-prefix="${escapeHtml(aisle.prefix)}" ${active ? "checked" : ""}>
      <span>${escapeHtml(aisle.prefix)}</span>
    </label>`;
  }).join("");

  aisleListWrap.querySelectorAll(".aisle-active-toggle").forEach((cb) => {
    cb.addEventListener("change", () => {
      const prefix = cb.dataset.prefix;
      if (!overrides.aisles[prefix]) overrides.aisles[prefix] = {};
      overrides.aisles[prefix].active = cb.checked;
      markDirty();
      buildEditorScene();
    });
  });
}

// ── Zone list sidebar ─────────────────────────────────────────────────────────
function renderZoneList() {
  if (!zoneListWrap) return;
  const zones = layout.zones || [];
  if (!zones.length) {
    zoneListWrap.innerHTML = '<p class="admin-empty">No zones in layout manifest.</p>';
    return;
  }
  zoneListWrap.innerHTML = zones.map((zone) => {
    const key    = zone.zone_key || "";
    const ovr    = overrides.zones[key] || {};
    const active = ovr.active !== false;
    return `<button type="button" class="editor-zone-btn" data-key="${escapeHtml(key)}">
      <span class="editor-zone-btn__label">${escapeHtml(zone.zone_label || key)}</span>
      <span class="editor-zone-btn__meta">${(zone.aisles || []).length} aisles${active ? "" : " · hidden"}</span>
    </button>`;
  }).join("");

  zoneListWrap.querySelectorAll(".editor-zone-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const zone = zones.find((z) => z.zone_key === btn.dataset.key);
      if (zone) selectZone(zone);
    });
  });
}

// ── Wire zone controls inputs ─────────────────────────────────────────────────
function wireControls() {
  function applyZoneOverride(key, value) {
    if (!selectedZone) return;
    const zoneKey = selectedZone.zone_key || "";
    if (!overrides.zones[zoneKey]) overrides.zones[zoneKey] = {};
    overrides.zones[zoneKey][key] = value;
    markDirty();
    buildEditorScene();
  }

  xOffsetInput?.addEventListener("input", () => {
    applyZoneOverride("x_offset", Number(xOffsetInput.value) || 0);
  });
  zOffsetInput?.addEventListener("input", () => {
    applyZoneOverride("z_offset", Number(zOffsetInput.value) || 0);
  });
  rotationYSelect?.addEventListener("change", () => {
    applyZoneOverride("rotation_y", Number(rotationYSelect.value) || 0);
  });
  zoneActiveToggle?.addEventListener("change", () => {
    applyZoneOverride("active", zoneActiveToggle.checked);
    renderZoneList();
  });

  deselectButton?.addEventListener("click", deselectZone);
  resetViewButton?.addEventListener("click", fitCamera);

  saveButton?.addEventListener("click", async () => {
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    try {
      const response = await fetch("/api/admin/layout-overrides", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(overrides)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save");
      overrides = data.overrides || overrides;
      dirty = false;
      if (saveChip)   saveChip.hidden = true;
      if (saveButton) saveButton.textContent = "Saved ✓";
      setTimeout(() => { if (saveButton) saveButton.textContent = "Save layout"; }, 2000);
      window.ItemTracker?.toast("Layout overrides saved", "success");
      renderZoneList();
    } catch (err) {
      window.ItemTracker?.toast(err.message || "Could not save layout", "error");
      saveButton.textContent = "Save layout";
    } finally {
      saveButton.disabled = false;
    }
  });
}

function markDirty() {
  dirty = true;
  if (saveChip)   { saveChip.hidden = false; }
  if (saveButton) { saveButton.disabled = false; }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
if (canvas) {
  renderZoneList();
  showZoneControls(false);
  wireControls();
  initScene();

  if (statusChip) {
    statusChip.textContent = "Click a zone to select";
    statusChip.classList.add("chip--inactive");
  }
}
