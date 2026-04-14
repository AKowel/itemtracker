const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("zlib");
const ExcelJS = require("exceljs");

const { cleanText, normalizeSku, safeFilename } = require("./helpers");
const { PocketBaseClient, PocketBaseError } = require("./pocketbaseClient");

const USERS_COLLECTION = "users";
const SNAPSHOT_COLLECTION = "item_catalog_snapshots";
const IMAGE_COLLECTION = "item_catalog_images";
const BARCODE_SNAPSHOT_COLLECTION = "item_catalog_barcode_snapshots";
const WAREHOUSE_SNAPSHOT_COLLECTION = "warehouse_binloc_snapshots";
const DEFAULT_CLIENT_CODE = "FANDMKET";
const MAX_RESULTS = 60;
const IMAGE_CACHE_TTL_MS = 60 * 1000;
const BARCODE_CACHE_TTL_MS = 60 * 1000;
const WAREHOUSE_CACHE_TTL_MS = 60 * 1000;

function pbFilterLiteral(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function cleanValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return cleanText(value);
}

function normalizeExcelCellValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeExcelCellValue).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || "").join("");
    }
    if (value.text !== undefined) {
      return value.text;
    }
    if (value.result !== undefined) {
      return value.result;
    }
    if (value.hyperlink && value.text) {
      return value.text;
    }
  }
  return value;
}

function recordFileName(record, fieldName) {
  const value = record?.[fieldName];
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return String(value || "").trim();
}

function normalizeFilterPhrases(query = "", filters = []) {
  const phrases = [];
  const seen = new Set();
  for (const rawValue of [query, ...(filters || [])]) {
    const value = cleanText(rawValue).toUpperCase();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    phrases.push(value);
  }
  return phrases;
}

function splitFilterTerms(phrases) {
  const terms = [];
  const seen = new Set();
  for (const phrase of phrases || []) {
    for (const part of String(phrase || "").split(/\s+/).filter(Boolean)) {
      if (seen.has(part)) {
        continue;
      }
      seen.add(part);
      terms.push(part);
    }
  }
  return terms;
}

function fieldScore(value, phrase, exactScore, prefixScore, containsScore) {
  const text = String(value || "").toUpperCase();
  if (!text || !phrase) {
    return 0;
  }
  if (text === phrase) {
    return exactScore;
  }
  if (text.startsWith(phrase)) {
    return prefixScore;
  }
  if (text.includes(phrase)) {
    return containsScore;
  }
  return 0;
}

function normalizeBarcodeValue(value) {
  const text = cleanValue(value);
  return /\d/.test(text) ? text : "";
}

function mergeBarcodeValues(...values) {
  const merged = [];
  const seen = new Set();

  const consume = (rawValue) => {
    if (Array.isArray(rawValue)) {
      rawValue.forEach(consume);
      return;
    }
    const value = normalizeBarcodeValue(rawValue);
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    merged.push(value);
  };

  values.forEach(consume);
  return merged;
}

function itemBarcodeList(item) {
  if (!item || typeof item !== "object") {
    return [];
  }
  return mergeBarcodeValues(item.barcode, item.barcodes || []);
}

function buildCatalogSearchText(item, barcodes = null) {
  const barcodeList = Array.isArray(barcodes) ? mergeBarcodeValues(barcodes) : itemBarcodeList(item);
  return [
    cleanValue(item?.sku),
    barcodeList.join(" "),
    cleanValue(item?.description),
    cleanValue(item?.description_short),
    cleanValue(item?.size),
    cleanValue(item?.color)
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

function barcodeSnapshotMeta(record, source = "pocketbase") {
  if (!record) {
    return {
      available: false,
      source,
      client_code: DEFAULT_CLIENT_CODE,
      snapshot_date: "",
      row_count: 0,
      source_row_count: 0,
      barcode_count: 0,
      duplicate_barcode_count: 0,
      uploaded_at: ""
    };
  }
  return {
    available: true,
    source,
    client_code: record.client_code || DEFAULT_CLIENT_CODE,
    snapshot_date: record.snapshot_date || "",
    row_count: Number(record.row_count || 0),
    source_row_count: Number(record.source_row_count || 0),
    barcode_count: Number(record.barcode_count || 0),
    duplicate_barcode_count: Number(record.duplicate_barcode_count || 0),
    uploaded_at: record.uploaded_at || "",
    source_name: record.source_name || ""
  };
}

function warehouseSnapshotMeta(record, source = "pocketbase") {
  if (!record) {
    return {
      available: false,
      source,
      warehouse_code: "",
      snapshot_date: "",
      row_count: 0,
      active_sku_count: 0,
      uploaded_at: ""
    };
  }
  return {
    available: true,
    source,
    warehouse_code: record.warehouse_code || "",
    snapshot_date: record.snapshot_date || "",
    row_count: Number(record.row_count || 0),
    active_sku_count: Number(record.active_sku_count || 0),
    uploaded_at: record.uploaded_at || ""
  };
}

class ItemTrackerService {
  constructor(config) {
    this.config = config;
    this.pb = new PocketBaseClient({
      baseUrl: config.pocketbaseUrl,
      adminEmail: config.pocketbaseAdminEmail,
      adminPassword: config.pocketbaseAdminPassword
    });
    this.snapshotCache = new Map();
    this.imageCache = new Map();
    this.barcodeSnapshotCache = new Map();
    this.warehouseSnapshotCache = null;
  }

  isAdminUser(user) {
    if (!user) {
      return false;
    }
    const role = String(user.role || "").trim().toLowerCase();
    if (role === "admin") {
      return true;
    }
    return this.config.adminEmails.includes(String(user.email || "").trim().toLowerCase());
  }

  serializeUser(record) {
    return {
      id: record.id,
      email: record.email || "",
      name: record.name || record.email || "User",
      role: record.role || "standard",
      isAdmin: this.isAdminUser(record)
    };
  }

  async authenticateUser(email, password) {
    const auth = await this.pb.authWithPassword(USERS_COLLECTION, email, password);
    if (!auth?.record) {
      throw new PocketBaseError("Login failed.", 401);
    }
    return this.serializeUser(auth.record);
  }

  async getUser(userId) {
    const record = await this.pb.getRecord(USERS_COLLECTION, userId);
    return this.serializeUser(record);
  }

  async bootstrap() {
    const report = [];
    await this.ensureCollection(SNAPSHOT_COLLECTION, [
      { name: "client_code", type: "text", required: true, max: 64 },
      { name: "sheet_name", type: "text", required: false, max: 120 },
      { name: "source_name", type: "text", required: false, max: 255 },
      { name: "row_count", type: "number", required: false, min: 0, onlyInt: true },
      { name: "source_row_count", type: "number", required: false, min: 0, onlyInt: true },
      { name: "duplicate_sku_count", type: "number", required: false, min: 0, onlyInt: true },
      { name: "generated_at", type: "text", required: false, max: 64 },
      { name: "imported_at", type: "text", required: false, max: 64 },
      { name: "imported_by_user_id", type: "text", required: false, max: 64 },
      { name: "imported_by_email", type: "text", required: false, max: 255 },
      { name: "catalog_file", type: "file", required: true, maxSelect: 1, maxSize: 52428800 }
    ]);
    report.push(`${SNAPSHOT_COLLECTION} ready`);

    await this.ensureCollection(IMAGE_COLLECTION, [
      { name: "client_code", type: "text", required: true, max: 64 },
      { name: "sku", type: "text", required: true, max: 64 },
      { name: "caption", type: "text", required: false, max: 1000 },
      { name: "uploaded_at", type: "text", required: false, max: 64 },
      { name: "uploaded_by_user_id", type: "text", required: false, max: 64 },
      { name: "uploaded_by_email", type: "text", required: false, max: 255 },
      { name: "image", type: "file", required: true, maxSelect: 1, maxSize: 15728640 }
    ]);
    report.push(`${IMAGE_COLLECTION} ready`);

    await this.ensureCollection(BARCODE_SNAPSHOT_COLLECTION, [
      { name: "client_code", type: "text", required: true, max: 64 },
      { name: "snapshot_date", type: "text", required: true, max: 32 },
      { name: "row_count", type: "number", required: false, min: 0, onlyInt: true },
      { name: "source_row_count", type: "number", required: false, min: 0, onlyInt: true },
      { name: "barcode_count", type: "number", required: false, min: 0, onlyInt: true },
      { name: "duplicate_barcode_count", type: "number", required: false, min: 0, onlyInt: true },
      { name: "uploaded_at", type: "text", required: false, max: 64 },
      { name: "source_synced_at", type: "text", required: false, max: 64 },
      { name: "source_name", type: "text", required: false, max: 255 },
      { name: "snapshot_file", type: "file", required: true, maxSelect: 1, maxSize: 52428800 }
    ]);
    report.push(`${BARCODE_SNAPSHOT_COLLECTION} ready`);

    await this.ensureCollection(WAREHOUSE_SNAPSHOT_COLLECTION, [
      { name: "warehouse_code", type: "text", required: true, max: 64 },
      { name: "snapshot_date", type: "text", required: true, max: 32 },
      { name: "row_count", type: "number", required: false, min: 0, onlyInt: true },
      { name: "active_sku_count", type: "number", required: false, min: 0, onlyInt: true },
      { name: "uploaded_at", type: "text", required: false, max: 64 },
      { name: "source_synced_at", type: "text", required: false, max: 64 },
      { name: "client_summary_json", type: "json", required: false },
      { name: "snapshot_file", type: "file", required: true, maxSelect: 1, maxSize: 104857600 }
    ]);
    report.push(`${WAREHOUSE_SNAPSHOT_COLLECTION} ready`);

    return report;
  }

  async ensureCollection(collectionName, fieldSpecs) {
    let existing = null;
    try {
      existing = await this.pb.getCollection(collectionName);
    } catch (error) {
      existing = null;
    }

    if (!existing) {
      await this.pb.createCollection({
        name: collectionName,
        type: "base",
        fields: fieldSpecs
      });
      return true;
    }

    const existingFields = Array.isArray(existing.fields) ? existing.fields : [];
    const existingNames = new Set(existingFields.map((field) => String(field?.name || "").trim()));
    let changed = false;
    for (const spec of fieldSpecs) {
      if (existingNames.has(spec.name)) {
        continue;
      }
      existingFields.push(spec);
      changed = true;
    }
    if (!changed) {
      return false;
    }

    await this.pb.updateCollection(existing.id || existing.name || collectionName, {
      name: existing.name || collectionName,
      fields: existingFields
    });
    return true;
  }

  async getLatestSnapshotRecord(clientCode = DEFAULT_CLIENT_CODE) {
    const response = await this.pb.listRecords(SNAPSHOT_COLLECTION, {
      filterExpr: `client_code=${pbFilterLiteral(clientCode)}`,
      sort: "-imported_at",
      page: 1,
      perPage: 1
    });
    return response.items?.[0] || null;
  }

  snapshotMeta(record, source = "pocketbase") {
    if (!record) {
      return {
        available: false,
        source,
        client_code: DEFAULT_CLIENT_CODE,
        row_count: 0,
        imported_at: ""
      };
    }
    return {
      available: true,
      source,
      client_code: record.client_code || DEFAULT_CLIENT_CODE,
      row_count: Number(record.row_count || 0),
      source_row_count: Number(record.source_row_count || 0),
      duplicate_sku_count: Number(record.duplicate_sku_count || 0),
      imported_at: record.imported_at || "",
      generated_at: record.generated_at || "",
      source_name: record.source_name || "",
      sheet_name: record.sheet_name || "",
      record_id: record.id || ""
    };
  }

  async loadSnapshot(clientCode = DEFAULT_CLIENT_CODE, forceRefresh = false) {
    const record = await this.getLatestSnapshotRecord(clientCode);
    if (!record) {
      return { snapshot: null, meta: this.snapshotMeta(null, "none") };
    }

    const recordId = String(record.id || "");
    const cached = this.snapshotCache.get(clientCode);
    if (!forceRefresh && cached && cached.recordId === recordId) {
      return { snapshot: cached.snapshot, meta: cached.meta };
    }

    const fileName = recordFileName(record, "catalog_file");
    if (!fileName) {
      throw new PocketBaseError("Shared item catalogue file is missing.", 500);
    }

    const fileResponse = await this.pb.proxyFile(
      record.collectionId || record.collectionName || SNAPSHOT_COLLECTION,
      record.id,
      fileName
    );
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const jsonBuffer = fileName.toLowerCase().endsWith(".gz") ? zlib.gunzipSync(buffer) : buffer;
    const snapshot = JSON.parse(jsonBuffer.toString("utf-8"));
    const meta = this.snapshotMeta(record, "pocketbase");
    this.snapshotCache.set(clientCode, { recordId, snapshot, meta });
    return { snapshot, meta };
  }

  scoreItem(item, primaryPhrase, phrases, terms) {
    const sku = String(item.sku || "").toUpperCase();
    const barcodes = itemBarcodeList(item).map((value) => String(value || "").toUpperCase());
    const description = String(item.description || "").toUpperCase();
    const searchText = String(item.search_text || buildCatalogSearchText(item)).toUpperCase();

    if (!terms.length) {
      return 0;
    }
    if (terms.some((term) => !searchText.includes(term))) {
      return 0;
    }

    let score = 0;
    for (const phrase of phrases) {
      const weight = phrase === primaryPhrase ? 1 : 0.58;
      score += fieldScore(sku, phrase, Math.round(12000 * weight), Math.round(9000 * weight), Math.round(7000 * weight));
      score += Math.max(
        ...[0, ...barcodes.map((barcode) => fieldScore(barcode, phrase, Math.round(10500 * weight), Math.round(7600 * weight), Math.round(6100 * weight)))]
      );
      score += fieldScore(description, phrase, Math.round(8600 * weight), Math.round(5200 * weight), Math.round(3600 * weight));
    }

    if (phrases.length > 1 && phrases.every((phrase) => description.includes(phrase))) {
      score += Math.min(1500, 320 * phrases.length);
    }

    if (item.active) score += 60;
    score += Math.min(1200, terms.length * 180 + phrases.length * 120);
    return score;
  }

  async loadImageIndex(clientCode = DEFAULT_CLIENT_CODE, forceRefresh = false) {
    const cacheKey = String(clientCode || DEFAULT_CLIENT_CODE);
    const cached = this.imageCache.get(cacheKey);
    const now = Date.now();
    if (!forceRefresh && cached && now - cached.loadedAt < IMAGE_CACHE_TTL_MS) {
      return cached;
    }

    const items = await this.pb.listAllRecords(IMAGE_COLLECTION, {
      filterExpr: `client_code=${pbFilterLiteral(clientCode)}`,
      sort: "-uploaded_at",
      perPage: 200
    });
    const imageMap = new Map();
    const imageSkuSet = new Set();
    let imageRecordCount = 0;
    for (const row of items || []) {
      const sku = normalizeSku(row.sku);
      if (!sku) {
        continue;
      }
      const fileName = recordFileName(row, "image");
      if (!fileName) {
        continue;
      }
      if (!imageMap.has(sku)) {
        imageMap.set(sku, []);
      }
      imageMap.get(sku).push({
        id: row.id,
        caption: row.caption || "",
        uploaded_at: row.uploaded_at || "",
        url: `/files/${encodeURIComponent(row.id)}?collection=${encodeURIComponent(
          row.collectionId || row.collectionName || IMAGE_COLLECTION
        )}&name=${encodeURIComponent(fileName)}`
      });
      imageSkuSet.add(sku);
      imageRecordCount += 1;
    }

    const payload = {
      loadedAt: now,
      imageMap,
      imageSkuSet,
      imageRecordCount
    };
    this.imageCache.set(cacheKey, payload);
    return payload;
  }

  async getLatestBarcodeSnapshotRecord(clientCode = DEFAULT_CLIENT_CODE) {
    const response = await this.pb.listRecords(BARCODE_SNAPSHOT_COLLECTION, {
      filterExpr: `client_code=${pbFilterLiteral(clientCode)}`,
      sort: "-snapshot_date,-uploaded_at",
      page: 1,
      perPage: 1
    });
    return response.items?.[0] || null;
  }

  async loadBarcodeSnapshot(clientCode = DEFAULT_CLIENT_CODE, forceRefresh = false) {
    const cacheKey = String(clientCode || DEFAULT_CLIENT_CODE);
    const cached = this.barcodeSnapshotCache.get(cacheKey);
    const now = Date.now();
    if (!forceRefresh && cached && now - cached.loadedAt < BARCODE_CACHE_TTL_MS) {
      return cached;
    }

    const record = await this.getLatestBarcodeSnapshotRecord(clientCode);
    if (!record) {
      const payload = {
        loadedAt: now,
        snapshot: null,
        meta: barcodeSnapshotMeta(null, "none")
      };
      this.barcodeSnapshotCache.set(cacheKey, payload);
      return payload;
    }

    const fileName = recordFileName(record, "snapshot_file");
    if (!fileName) {
      throw new PocketBaseError("Barcode snapshot file is missing.", 500);
    }

    const response = await this.pb.proxyFile(
      record.collectionId || record.collectionName || BARCODE_SNAPSHOT_COLLECTION,
      record.id,
      fileName
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    const jsonBuffer = fileName.toLowerCase().endsWith(".gz") ? zlib.gunzipSync(buffer) : buffer;
    const snapshot = JSON.parse(jsonBuffer.toString("utf-8"));
    const payload = {
      loadedAt: now,
      snapshot,
      meta: barcodeSnapshotMeta(record, "pocketbase")
    };
    this.barcodeSnapshotCache.set(cacheKey, payload);
    return payload;
  }

  buildBarcodeMap(barcodeSnapshot) {
    const barcodeMap = new Map();
    const rows = barcodeSnapshot?.mappings || barcodeSnapshot?.items || [];
    for (const row of rows) {
      const sku = normalizeSku(row?.sku || row?.item_sku || row?.BIITEM || row?.ITITEM);
      const barcodes = mergeBarcodeValues(row?.barcode, row?.barcodes || []);
      if (!sku || !barcodes.length) {
        continue;
      }
      barcodeMap.set(sku, mergeBarcodeValues(barcodeMap.get(sku) || [], barcodes));
    }
    return barcodeMap;
  }

  applyBarcodeSnapshot(snapshot, barcodeSnapshot = null) {
    if (!snapshot || typeof snapshot !== "object") {
      return snapshot;
    }

    const signature = barcodeSnapshot
      ? [
          cleanValue(barcodeSnapshot.client_code),
          cleanValue(barcodeSnapshot.snapshot_date),
          cleanValue(barcodeSnapshot.generated_at),
          cleanValue(barcodeSnapshot.source_synced_at),
          String(barcodeSnapshot.row_count || "")
        ].join("::")
      : "";
    if (snapshot._barcode_signature === signature) {
      return snapshot;
    }

    const barcodeMap = this.buildBarcodeMap(barcodeSnapshot);
    for (const item of snapshot.items || []) {
      const sku = normalizeSku(item?.sku);
      const barcodes = mergeBarcodeValues(item?.barcode, item?.barcodes || [], barcodeMap.get(sku) || []);
      item.barcodes = barcodes;
      item.barcode = barcodes[0] || "";
      item.search_text = buildCatalogSearchText(item, barcodes);
    }
    snapshot._barcode_signature = signature;
    return snapshot;
  }

  async getLatestWarehouseSnapshotRecord() {
    const response = await this.pb.listRecords(WAREHOUSE_SNAPSHOT_COLLECTION, {
      sort: "-snapshot_date,-uploaded_at",
      page: 1,
      perPage: 1
    });
    return response.items?.[0] || null;
  }

  async loadWarehouseSnapshot(forceRefresh = false) {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.warehouseSnapshotCache &&
      now - this.warehouseSnapshotCache.loadedAt < WAREHOUSE_CACHE_TTL_MS
    ) {
      return this.warehouseSnapshotCache;
    }

    const record = await this.getLatestWarehouseSnapshotRecord();
    if (!record) {
      const payload = {
        loadedAt: now,
        snapshot: null,
        meta: warehouseSnapshotMeta(null, "none")
      };
      this.warehouseSnapshotCache = payload;
      return payload;
    }

    const fileName = recordFileName(record, "snapshot_file");
    if (!fileName) {
      throw new PocketBaseError("Warehouse snapshot file is missing.", 500);
    }

    const response = await this.pb.proxyFile(
      record.collectionId || record.collectionName || WAREHOUSE_SNAPSHOT_COLLECTION,
      record.id,
      fileName
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    const jsonBuffer = fileName.toLowerCase().endsWith(".gz") ? zlib.gunzipSync(buffer) : buffer;
    const snapshot = JSON.parse(jsonBuffer.toString("utf-8"));
    const payload = {
      loadedAt: now,
      snapshot,
      meta: warehouseSnapshotMeta(record, "pocketbase")
    };
    this.warehouseSnapshotCache = payload;
    return payload;
  }

  buildWarehouseSkuSet(snapshot, clientCode = DEFAULT_CLIENT_CODE) {
    const skuSet = new Set();
    const targetClient = String(clientCode || DEFAULT_CLIENT_CODE).trim().toUpperCase();
    for (const row of snapshot?.rows || []) {
      const client = String(row?.Client || row?.client_code || "").trim().toUpperCase();
      const sku = normalizeSku(row?.["Item SKU"] || row?.sku || row?.BLITEM);
      const status = String(row?.Status || row?.status || row?.BLSTS || "").trim().toUpperCase();
      if (!sku) {
        continue;
      }
      if (targetClient && client && client !== targetClient) {
        continue;
      }
      if (status && status !== "Y") {
        continue;
      }
      skuSet.add(sku);
    }
    return skuSet;
  }

  async getCatalogSummary(clientCode = DEFAULT_CLIENT_CODE) {
    const { snapshot, meta } = await this.loadSnapshot(clientCode);
    const imageState = await this.loadImageIndex(clientCode);
    let warehouseState = { snapshot: null, meta: warehouseSnapshotMeta(null, "none") };
    try {
      warehouseState = await this.loadWarehouseSnapshot();
    } catch (error) {
      warehouseState = { snapshot: null, meta: warehouseSnapshotMeta(null, "error") };
    }

    const itemSkus = new Set((snapshot?.items || []).map((item) => normalizeSku(item?.sku)).filter(Boolean));
    const imageSkus = imageState.imageSkuSet || new Set();
    const warehouseSkus = this.buildWarehouseSkuSet(warehouseState.snapshot, clientCode);

    let capturedInItemfile = 0;
    let capturedInWarehouse = 0;
    for (const sku of imageSkus) {
      if (itemSkus.has(sku)) {
        capturedInItemfile += 1;
      }
      if (warehouseSkus.has(sku)) {
        capturedInWarehouse += 1;
      }
    }

    const itemfileSkuCount = itemSkus.size;
    const warehouseActiveSkuCount = warehouseSkus.size;
    return {
      itemfile_sku_count: itemfileSkuCount,
      captured_sku_count: imageSkus.size,
      image_record_count: Number(imageState.imageRecordCount || 0),
      captured_itemfile_sku_count: capturedInItemfile,
      captured_vs_itemfile_percent: itemfileSkuCount ? Math.round((capturedInItemfile / itemfileSkuCount) * 1000) / 10 : 0,
      warehouse_active_sku_count: warehouseActiveSkuCount,
      captured_active_sku_count: capturedInWarehouse,
      captured_vs_warehouse_percent: warehouseActiveSkuCount ? Math.round((capturedInWarehouse / warehouseActiveSkuCount) * 1000) / 10 : 0,
      warehouse_snapshot_date: warehouseState.meta.snapshot_date || "",
      warehouse_uploaded_at: warehouseState.meta.uploaded_at || "",
      item_catalog_meta: meta,
      warehouse_meta: warehouseState.meta
    };
  }

  async searchCatalog(query = "", clientCode = DEFAULT_CLIENT_CODE, limit = MAX_RESULTS, filters = [], options = {}) {
    const { snapshot, meta } = await this.loadSnapshot(clientCode);
    const phrases = normalizeFilterPhrases(query, filters);
    const hasImagesOnly = Boolean(options?.hasImagesOnly);
    const warehouseActiveOnly = Boolean(options?.warehouseActiveOnly);
    if (!snapshot || (!phrases.length && !hasImagesOnly && !warehouseActiveOnly)) {
      return { rows: [], meta };
    }

    try {
      const barcodeState = await this.loadBarcodeSnapshot(clientCode);
      this.applyBarcodeSnapshot(snapshot, barcodeState.snapshot);
    } catch (error) {
      this.applyBarcodeSnapshot(snapshot, null);
    }

    const primaryPhrase = cleanText(query).toUpperCase() || phrases[0] || "";
    const terms = splitFilterTerms(phrases);
    const imageState = await this.loadImageIndex(clientCode);
    const imageMap = imageState.imageMap || new Map();
    let warehouseSkuSet = new Set();
    try {
      const warehouseState = await this.loadWarehouseSnapshot();
      warehouseSkuSet = this.buildWarehouseSkuSet(warehouseState.snapshot, clientCode);
    } catch (error) {
      warehouseSkuSet = new Set();
    }
    const scored = [];
    for (const item of snapshot.items || []) {
      const sku = normalizeSku(item?.sku);
      const hasImages = imageMap.has(sku);
      const warehouseActive = warehouseSkuSet.has(sku);
      if (hasImagesOnly && !hasImages) {
        continue;
      }
      if (warehouseActiveOnly && !warehouseActive) {
        continue;
      }
      let score = phrases.length ? this.scoreItem(item, primaryPhrase, phrases, terms) : 100;
      if (hasImages) {
        score += 220 + Math.min(180, (imageMap.get(sku)?.length || 0) * 18);
      }
      if (warehouseActive) {
        score += 180;
      }
      if (score > 0) {
        scored.push([score, item.sku || "", item, hasImages, warehouseActive]);
      }
    }
    scored.sort((a, b) => (b[0] - a[0]) || String(a[1]).localeCompare(String(b[1])));

    const rows = scored.slice(0, limit).map((entry) => {
      const { search_text: searchText, ...rest } = entry[2];
      const barcodes = mergeBarcodeValues(rest.barcode, rest.barcodes || []);
      const matchedBarcodes = barcodes.filter((barcode) =>
        phrases.some((phrase) => phrase && String(barcode || "").toUpperCase().includes(phrase))
      );
      return {
        ...rest,
        barcodes,
        barcode: barcodes[0] || "",
        matched_barcodes: matchedBarcodes,
        has_images: Boolean(entry[3]),
        warehouse_active: Boolean(entry[4])
      };
    });

    for (const row of rows) {
      row.images = imageMap.get(row.sku) || [];
      row.image_count = row.images.length;
    }

    return { rows, meta };
  }

  async searchByLocation(location, clientCode = DEFAULT_CLIENT_CODE) {
    const query = String(location || "").trim().toUpperCase();
    if (!query) {
      return { rows: [], meta: null };
    }

    const warehouseState = await this.loadWarehouseSnapshot();
    const snapshot = warehouseState.snapshot;

    if (!snapshot?.rows?.length) {
      return { rows: [], meta: warehouseState.meta };
    }

    const targetClient = String(clientCode || DEFAULT_CLIENT_CODE).trim().toUpperCase();

    // Find every row in the snapshot that belongs to this bin location
    const matchingRows = [];
    for (const row of snapshot.rows) {
      const loc = String(row?.BLBINL || row?.["Bin Location"] || row?.bin_location || "").trim().toUpperCase();
      if (loc !== query) continue;
      const client = String(row?.BLCCOD || row?.Client || row?.client_code || "").trim().toUpperCase();
      if (targetClient && client && client !== targetClient) continue;
      matchingRows.push(row);
    }

    if (!matchingRows.length) {
      return { rows: [], meta: warehouseState.meta };
    }

    // Collect unique SKUs while preserving the order they appear
    const skusSeen = new Set();
    const skus = [];
    for (const row of matchingRows) {
      const sku = normalizeSku(row?.BLITEM || row?.["Item SKU"] || row?.sku);
      if (sku && !skusSeen.has(sku)) {
        skusSeen.add(sku);
        skus.push(sku);
      }
    }

    // Pull descriptions from the catalogue snapshot when available
    let catalogMap = new Map();
    try {
      const { snapshot: catSnapshot } = await this.loadSnapshot(clientCode);
      for (const item of catSnapshot?.items || []) {
        const sku = normalizeSku(item?.sku);
        if (sku) catalogMap.set(sku, item);
      }
    } catch (_) {
      // Catalogue snapshot unavailable — descriptions will fall back to ITDSC1
    }

    // Load images
    const imageState = await this.loadImageIndex(clientCode);
    const imageMap = imageState.imageMap || new Map();

    const rows = skus.map((sku) => {
      const catItem = catalogMap.get(sku) || null;
      const images = imageMap.get(sku) || [];
      const binRow = matchingRows.find(
        (r) => normalizeSku(r?.BLITEM || r?.["Item SKU"] || r?.sku) === sku
      );
      return {
        sku,
        description: catItem?.description || String(binRow?.ITDSC1 || ""),
        description_short: catItem?.description_short || "",
        barcode: catItem?.barcode || "",
        barcodes: catItem?.barcodes || [],
        size: catItem?.size || "",
        color: catItem?.color || "",
        active: catItem?.active !== false,
        images,
        image_count: images.length,
        has_images: images.length > 0,
        warehouse_active: true,
        matched_barcodes: [],
        bin_location: String(binRow?.BLBINL || "").trim().toUpperCase(),
        bin_qty: String(binRow?.BLQTY || "").trim() || null,
        bin_status: String(binRow?.BLSTS || "").trim().toUpperCase()
      };
    });

    return { rows, meta: warehouseState.meta };
  }

  async listImagesForSkus(skus, clientCode = DEFAULT_CLIENT_CODE) {
    const imageState = await this.loadImageIndex(clientCode);
    const sourceMap = imageState.imageMap || new Map();
    const normalized = [...new Set((skus || []).map((sku) => normalizeSku(sku)).filter(Boolean))];
    const imageMap = new Map();
    if (!normalized.length) {
      return imageMap;
    }

    for (const sku of normalized) {
      if (sourceMap.has(sku)) {
        imageMap.set(sku, sourceMap.get(sku));
      }
    }

    return imageMap;
  }

  async parseWorkbook(buffer, sourceName, clientCode = DEFAULT_CLIENT_CODE) {
    const tempFile = path.join(os.tmpdir(), `itemtracker-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
    await fs.writeFile(tempFile, buffer);

    const itemsBySku = new Map();
    let sourceRowCount = 0;
    let duplicateSkuCount = 0;
    let sheetName = "Sheet1";
    const headers = [];

    try {
      const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(tempFile, {
        entries: "ignore",
        sharedStrings: "cache",
        hyperlinks: "ignore",
        styles: "ignore",
        worksheets: "emit"
      });

      for await (const worksheetReader of workbookReader) {
        sheetName = worksheetReader.name || sheetName;
        let headerLoaded = false;
        for await (const rowBatch of worksheetReader) {
          const rows = Array.isArray(rowBatch) ? rowBatch : [rowBatch];
          for (const excelRow of rows) {
            const values = Array.isArray(excelRow.values) ? excelRow.values : [];
            if (!headerLoaded) {
              for (let index = 1; index < values.length; index += 1) {
                headers[index - 1] = cleanValue(normalizeExcelCellValue(values[index]));
              }
              headerLoaded = true;
              continue;
            }

            const row = {};
            for (let index = 1; index < values.length; index += 1) {
              const header = headers[index - 1];
              if (!header) {
                continue;
              }
              row[header] = normalizeExcelCellValue(values[index]);
            }

            const sku = normalizeSku(row.ITITEM);
            if (!sku) {
              continue;
            }
            sourceRowCount += 1;
            const description =
              cleanValue(row.ITDESC) ||
              cleanValue(`${cleanValue(row.ITDSC1)} ${cleanValue(row.ITDSC2)}`) ||
              sku;
            const descriptionShort =
              cleanValue(`${cleanValue(row.ITDSC1)} ${cleanValue(row.ITDSC2)}`) || description;
            const barcode = normalizeBarcodeValue(row.ITBARC);
            const barcodes = barcode ? [barcode] : [];
            const item = {
              sku,
              description,
              description_short: descriptionShort,
              barcode,
              barcodes,
              size: cleanValue(row.ITSIZE),
              color: cleanValue(row.ITCOLR),
              active: cleanValue(row.ITACT).toUpperCase() === "Y",
              created_at: cleanValue(row.CREATE_TIMESTAMP),
              changed_at: cleanValue(row.CHANGE_TIMESTAMP),
              search_text: buildCatalogSearchText({
                sku,
                description,
                description_short: descriptionShort,
                barcodes,
                size: cleanValue(row.ITSIZE),
                color: cleanValue(row.ITCOLR)
              }, barcodes)
            };

            const existing = itemsBySku.get(sku);
            if (existing) {
              duplicateSkuCount += 1;
              const shouldReplace =
                (item.active && !existing.active) ||
                String(item.changed_at || "") > String(existing.changed_at || "") ||
                String(item.description || "").length > String(existing.description || "").length;
              if (shouldReplace) {
                itemsBySku.set(sku, item);
              }
            } else {
              itemsBySku.set(sku, item);
            }
          }
        }
        break;
      }
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }

    const items = Array.from(itemsBySku.values()).sort((a, b) =>
      String(a.sku || "").localeCompare(String(b.sku || ""))
    );

    return {
      client_code: clientCode,
      sheet_name: sheetName,
      source_name: sourceName,
      generated_at: new Date().toISOString(),
      source_row_count: sourceRowCount,
      row_count: items.length,
      duplicate_sku_count: duplicateSkuCount,
      items
    };
  }

  async importWorkbook({ buffer, originalName, user, clientCode = DEFAULT_CLIENT_CODE }) {
    const snapshot = await this.parseWorkbook(buffer, originalName, clientCode);
    const payload = Buffer.from(JSON.stringify(snapshot));
    const compressed = zlib.gzipSync(payload);
    const importedAt = new Date().toISOString();

    const record = await this.pb.createMultipartRecord(
      SNAPSHOT_COLLECTION,
      {
        client_code: clientCode,
        sheet_name: snapshot.sheet_name,
        source_name: snapshot.source_name,
        row_count: snapshot.row_count,
        source_row_count: snapshot.source_row_count,
        duplicate_sku_count: snapshot.duplicate_sku_count,
        generated_at: snapshot.generated_at,
        imported_at: importedAt,
        imported_by_user_id: user.id,
        imported_by_email: user.email
      },
      [
        {
          fieldName: "catalog_file",
          filename: safeFilename(`${clientCode}_catalog_${Date.now()}.json.gz`, "catalog.json.gz"),
          buffer: compressed,
          contentType: "application/gzip"
        }
      ]
    );

    const meta = this.snapshotMeta(record, "pocketbase");
    this.snapshotCache.set(clientCode, {
      recordId: record.id,
      snapshot,
      meta
    });
    return meta;
  }

  async uploadImages({ sku, caption, files, user, clientCode = DEFAULT_CLIENT_CODE }) {
    const normalizedSku = normalizeSku(sku);
    if (!normalizedSku) {
      throw new PocketBaseError("SKU is required.", 400);
    }
    const uploadedIds = [];
    for (const file of files || []) {
      if (!file?.buffer?.length) {
        continue;
      }
      const record = await this.pb.createMultipartRecord(
        IMAGE_COLLECTION,
        {
          client_code: clientCode,
          sku: normalizedSku,
          caption: cleanText(caption),
          uploaded_at: new Date().toISOString(),
          uploaded_by_user_id: user.id,
          uploaded_by_email: user.email
        },
        [
          {
            fieldName: "image",
            filename: safeFilename(file.originalname, "photo.jpg"),
            buffer: file.buffer,
            contentType: file.mimetype || "application/octet-stream"
          }
        ]
      );
      uploadedIds.push(record.id);
    }

    this.imageCache.delete(String(clientCode || DEFAULT_CLIENT_CODE));
    const imageMap = await this.listImagesForSkus([normalizedSku], clientCode);
    return {
      sku: normalizedSku,
      uploadedIds,
      images: imageMap.get(normalizedSku) || []
    };
  }

  async proxyImage({ imageId, collectionKey, fileName }) {
    return this.pb.proxyFile(collectionKey, imageId, fileName);
  }
}

module.exports = {
  DEFAULT_CLIENT_CODE,
  IMAGE_COLLECTION,
  ItemTrackerService,
  MAX_RESULTS,
  PocketBaseError,
  SNAPSHOT_COLLECTION
};
