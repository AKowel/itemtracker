# Warehouse Editor

A standalone Electron desktop application for building, calibrating, and publishing
the 3D warehouse layout that powers the picking heatmap on the hosted itemtracker site.

Repository: `warehouse-editor` (sibling to this repo)

---

## What It Does

The editor lets you visually position every bin location in 3D space, adjust their
sizes, fix layout errors, and push the resulting overrides file directly to the live
server — all without touching code.

It reads the same layout manifest JSON and PocketBase location snapshot that the
heatmap viewer uses, so what you see in the editor is exactly what appears on the site.

---

## Setup

### Prerequisites

- Node.js 20+
- Electron (installed via `npm install` inside the repo)

### Install and run

```powershell
cd C:\path\to\warehouse-editor
npm install
npm start
```

### Load data

1. **File → Open Layout JSON…** (`Ctrl+O`)  
   Open the `F&M Layout V4.7.json` manifest (or the latest version).

2. **File → Open Locations Data…** (`Ctrl+L`)  
   Download a fresh export from the hosted site:
   ```
   GET /api/admin/export-locations-json
   ```
   This contains all bin locations with their real `BLSCOD` bin size codes from
   `SMARTDATA.BINLOC`, so the editor renders every box at the correct physical size.

3. The editor auto-loads `layout-overrides.json` from the same folder as the layout
   file if one exists.

---

## Publishing to the Server

### One-time setup

1. Add an API key to the server's `.env`:
   ```
   ADMIN_API_KEY=your-strong-random-key
   ```
   Generate one with: `openssl rand -hex 32`

2. Restart itemtracker so it picks up the new key.

3. In the editor, click **☁ Publish** in the toolbar, enter the server URL and key,
   and click **Save connection settings**.

### Publishing

Click **☁ Publish → Publish now**.

The editor gzip-compresses the overrides JSON (~92% size reduction) before sending it
to `POST /api/admin/layout-overrides` with the `x-api-key` header. The server decompresses
it automatically and stores it in PocketBase.

The heatmap viewer on the site reads these overrides live, so the next page load reflects
the new positions.

---

## Overrides System

All edits are stored in `layout-overrides.json` alongside the layout file. Nothing in
the source layout JSON is ever modified. The overrides file is what gets published.

```json
{
  "bays":      { "WF51": { "x_offset": 1.2, "z_offset": 0.0 } },
  "aisles":    { "WF": { "active": true, "x_offset": 0.0 } },
  "zones":     { "wf": { "reverse_bay_dir": false } },
  "locations": { "WF515002": { "x_offset": 0.0, "y_offset": 0.0, "z_offset": 0.1, "bin_size_override": "XL" } },
  "walls":     [],
  "bin_sizes": { "SM": { "height": 300, "width": 500, "depth": 400 } },
  "label_offsets": {},
  "level_heights": {}
}
```

Overrides cascade: zone → aisle → bay → location. A location offset adds on top of
whatever its bay or aisle has been given.

---

## Full Feature List

### Cameras

| Mode | How to enter | Controls |
|------|-------------|----------|
| **3D Perspective** | Toolbar or `Alt+4` | Middle-drag = orbit · Scroll = zoom · WASD = pan |
| **Top-Down** | Toolbar or `Alt+5` | Scroll = zoom · WASD = pan · Bay labels visible |
| **First Person** | Toolbar or `Alt+F` | WASD = walk · Mouse = look · E/C = up/down |

Right-click anywhere on the canvas for the **radial wheel menu** (hold 120 ms, move
to item, release):

```
FPS  · Select · Box Select · Wall
3D   · Top    · Undo       · Redo
```

### Tools

| Tool | Shortcut | Purpose |
|------|----------|---------|
| Select | `Alt+S` | Click a location, wall, aisle, or bay to inspect/edit |
| Box Select | `Alt+B` | Drag to rubber-band select a region |
| Wall | `Alt+W` | Click two points in top-down view to draw a wall |
| Ruler | `Alt+R` | Click two points to measure distance (tooltip shows 3D + XZ + deltas) |

### Selection

- **Click** a location → opens Location panel with full code, bin size, world position
- **Shift+click** → add/remove from selection
- **Ctrl+A** → select all visible locations
- **Escape** → deselect all
- **Z** → zoom camera to fit current selection
- **Ctrl+F** → search / jump-to by location code (e.g. `WF515002`)

### Moving things

**Arrow keys** — nudge selected locations (amount = current snap size or 0.1 m).  
Hold **Shift** for 1 m steps.

**Transform gizmo** — when one or more locations are selected, three coloured
axis handles appear. Drag an axis to move all selected locations along it.

**Speed slider** (toolbar) — controls how many world-units each pixel of gizmo drag
produces. Range 0.02× (sub-mm precision) to 4× (coarse).

**Snap dropdown** (toolbar) — snaps gizmo drag and arrow-key nudge to a grid:
`Off / 0.05 m / 0.1 m / 0.25 m / 0.5 m / 1.0 m`

**Delta move panel** (multi-selection) — enter exact ΔX / ΔY / ΔZ and click Apply.

**Batch offset by formula** (`ƒ Batch` button) — apply a JavaScript expression to
every selected location. Available variables:

| Variable | Meaning |
|----------|---------|
| `x, y, z` | Current world position (metres) |
| `bay` | Bay number (integer) |
| `level` | Level number (integer) |
| `slot` | Slot number (integer) |
| `i` | Index within current selection (0-based) |
| `aisle_i` | Aisle index within current selection (0-based) |

Example — fix a 2 cm drift per bay: `bay * 0.02`

### Property panels

**Location panel** — shown when a single location is selected:
- Full location code (e.g. `WF515002`), parsed aisle / bay / level / slot
- System bin size and **per-location bin size override** (dropdown)
- Per-location X/Y/Z offset inputs
- World position readout
- "↑ Edit Bay properties" link

**Bay panel**:
- X/Z offset
- Floor elevation (lifts the whole bay above ground, e.g. over a transfer aisle)
- **Per-level height editor** — set a custom height (mm) for each level independently,
  overriding the uniform bin size height; levels restack automatically
- Copy / Paste bay overrides to selection (`Ctrl+C / Ctrl+V`)

**Aisle panel**:
- X/Z offset
- Show/hide toggle
- **Bay spacing wizard** — enter an interval (metres) and click Auto-space to
  distribute all bays evenly along the Z axis

**Zone panel**:
- X/Z offset
- Reverse bay direction checkbox
- Flip X / Flip Z mirror buttons

**Multi-selection panel**:
- Delta move (ΔX / ΔY / ΔZ)
- Mirror on X / Y / Z
- Paste copied bay overrides to all bays in selection

### Visualisation

**Colour modes** (toolbar dropdown):

| Mode | Colours by |
|------|-----------|
| Default | Uniform blue (selected = purple) |
| Bin Size | Distinct hue per bin size code |
| Zone | Distinct hue per zone |
| Level | Blue→red gradient from lowest to highest level |

**Level filter** (toolbar) — enter a min and max level number and click Filter.
Locations outside the range become invisible (mesh scaled to zero, no performance cost).
Click ✕ to restore all.

**3D aisle labels** — floating text labels above each aisle:
- Visible in perspective and FPS modes (fade with distance)
- Visible and **draggable** in top-down mode; positions saved to overrides
- Bay-level labels visible in top-down mode only

**Floor** — grey concrete floor plane with darker aisle corridor strips rendered
beneath all locations.

### Diagnostics

**📊 Stats panel** — summary of total locations, zones, hidden aisles, override counts,
walls, and a bin size distribution bar chart.

**Overlap detection** (inside Stats) — spatial-bucket algorithm scans all locations and
reports pairs within 0.6 m of each other. Click any pair to select them and fly the
camera to that position.

**📋 BS Report** — lists every location that has a bin size override, with columns:

| Column | Source |
|--------|--------|
| Location | Location code |
| System Bin Size | Value from PocketBase `SMARTDATA.BINLOC` |
| Override Bin Size | Value set in the editor |

Individual overrides can be cleared from the report. The full list exports to CSV.

### Other tools

**Undo / Redo** — full history (`Ctrl+Z / Ctrl+Shift+Z`), also in the Edit menu and
radial wheel.

**Bin Sizes editor** (⚙ Bin Sizes button) — edit the height / width / depth (mm) for
each bin size code. These dimensions drive the physical size of every rendered box.

**Wall tool** — draw walls in top-down view by clicking two points. Walls have
configurable height and thickness and are raycasted for selection.

**Search / jump-to** (`Ctrl+F`) — type a partial location code, arrow-key through
results, Enter or click to fly the camera to that location and select it.

**FPS edit mode** — press `Tab` while in FPS to toggle between:
- **Look mode** — pointer locked, WASD moves, mouse looks around
- **Edit mode** — pointer free, can click/select/drag gizmo while still walking with WASD

---

## Server-Side API Endpoints

All endpoints require either a logged-in admin session or the `x-api-key` header.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/admin/layout-overrides` | Download current overrides from PocketBase |
| `POST` | `/api/admin/layout-overrides` | Upload new overrides (gzip body supported) |
| `GET` | `/api/admin/export-locations-json` | Download all bin locations as JSON for the editor |
| `GET` | `/api/admin/layout-locations` | Bin locations + known bin size codes (used by heatmap) |

---

## Planned: 3D Heatmap Viewer Integration

The goal is to bring the core 3D viewport capabilities from the desktop editor into
the browser-based heatmap page at `/heatmap`, so warehouse managers can explore
pick activity in full 3D without needing the Electron app.

### What to port

The heatmap page already has a Three.js 3D rack scene. The plan is to extend it with
the following capabilities from the editor:

| Feature | Priority | Notes |
|---------|----------|-------|
| Perspective / top-down / FPS cameras | High | Orbit with middle-drag; WASD pan/walk |
| Zoom to selection | High | Z key or button |
| Level visibility filter | High | Show only levels 1–5 etc. for a cleaner view |
| Colour modes | High | Add "Bin Size" and "Zone" alongside existing heatmap mode |
| Search / jump-to location | High | Already useful for heatmap click; expose as Ctrl+F |
| Bay and aisle labels | Medium | Top-down labels already known to work well |
| Location detail popover | Medium | Already partially implemented on click |
| Bin size override indicator | Medium | Visual flag on locations where override ≠ system |
| FPS walk-through | Low | Nice for walkthroughs / presentations |
| Measurement ruler | Low | Useful for checking aisle widths on screen |

### Shared code candidates

The following modules from the editor can be used directly or adapted for the browser:

- `js/coords.js` — coordinate computation (pure JS, no Electron dependencies)
- `js/viewport.js` — Three.js scene setup, cameras, gizmo, labels (needs
  deelectronification: remove `ipcRenderer` references, adapt to browser fetch)
- The `overrides` JSON structure is already stored in PocketBase and served via
  `/api/admin/layout-overrides`, so the web page can load it with a single fetch

### Implementation sketch

```javascript
// In heatmap.ejs / heatmap.js — replace current scene with editor viewport

const [overridesRes, locationsRes] = await Promise.all([
  fetch('/api/admin/layout-overrides'),
  fetch('/api/admin/layout-locations'),
]);
const { overrides, layout } = await overridesRes.json();
const { locations }          = await locationsRes.json();

const allLocs = computeAllPositions(locations, layout, overrides);
rebuildMesh(allLocs);
applyHeatmapColors(allLocs, pickActivityData);  // existing heatmap logic
```

The colour mode can be toggled between heatmap (existing) and the new bin-size /
zone / level modes without any data re-fetch.

---

## Environment Variables (server)

| Variable | Purpose |
|----------|---------|
| `ADMIN_API_KEY` | Static API key for warehouse editor publish; leave empty to disable |

All other variables are documented in `.env.example`.
