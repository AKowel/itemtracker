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
const PICK_ACTIVITY_SNAPSHOT_COLLECTION = "warehouse_pick_activity_snapshots";
const ACTIVITY_LOG_COLLECTION = "activity_log";
const NOTES_COLLECTION = "item_notes";
const DELETION_REQUESTS_COLLECTION = "deletion_requests";
const DEFAULT_CLIENT_CODE = "FANDMKET";
const MAX_RESULTS = 60;
const IMAGE_CACHE_TTL_MS = 60 * 1000;
const BARCODE_CACHE_TTL_MS = 60 * 1000;
const WAREHOUSE_CACHE_TTL_MS = 60 * 1000;
const PICK_ACTIVITY_CACHE_TTL_MS = 60 * 1000;
const LAYOUT_MANIFEST_PATH = path.join(__dirname, "data", "fandm-layout-v4.7.json");

function isMissingCollectionError(error) {
  if (!(error instanceof PocketBaseError)) {
    return false;
  }
  const message = String(error.message || "").toLowerCase();
  return error.statusCode === 404 || message.includes("not found");
}

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

function safeNumber(value) {
  const num = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(num)) {
    return 0;
  }
  return num;
}

function parseDateText(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function formatDateText(dateValue) {
  if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
    return "";
  }
  return dateValue.toISOString().slice(0, 10);
}

function addUtcDays(dateValue, offset) {
  const next = new Date(dateValue.getTime());
  next.setUTCDate(next.getUTCDate() + offset);
  return next;
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

function normalizeWorksheetName(value, fallback = "Sheet") {
  const text = String(value || "")
    .replace(/[\[\]*?:/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, 31);
}

function excelColumnLetter(index) {
  let current = Number(index || 0);
  let output = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    current = Math.floor((current - 1) / 26);
  }
  return output || "A";
}

function fitWorksheetColumns(worksheet, columnDefs = []) {
  worksheet.columns.forEach((column, index) => {
    const definition = columnDefs[index] || {};
    let width = Math.max(8, Number(definition.width || 0));
    column.eachCell({ includeEmpty: true }, (cell) => {
      const text = String(normalizeExcelCellValue(cell.value) || "");
      const longestLine = text.split(/\r?\n/).reduce((max, line) => Math.max(max, line.length), 0);
      width = Math.max(width, longestLine + 2);
    });
    column.width = Math.min(Number(definition.maxWidth || 42), Math.max(Number(definition.minWidth || 12), width || 12));
  });
}

function styleWorksheet(worksheet, columnDefs = []) {
  const columnCount = Math.max(1, columnDefs.length);
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: "A1",
    to: `${excelColumnLetter(columnCount)}1`
  };

  const headerRow = worksheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2E5B7A" }
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD6DEE6" } },
      left: { style: "thin", color: { argb: "FFD6DEE6" } },
      bottom: { style: "thin", color: { argb: "FFD6DEE6" } },
      right: { style: "thin", color: { argb: "FFD6DEE6" } }
    };
  });

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    row.eachCell((cell, columnNumber) => {
      const definition = columnDefs[columnNumber - 1] || {};
      cell.alignment = definition.alignment || { vertical: "top", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE7ECF1" } },
        left: { style: "thin", color: { argb: "FFE7ECF1" } },
        bottom: { style: "thin", color: { argb: "FFE7ECF1" } },
        right: { style: "thin", color: { argb: "FFE7ECF1" } }
      };
      if (rowNumber % 2 === 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" }
        };
      }
    });
  });

  columnDefs.forEach((definition, index) => {
    const column = worksheet.getColumn(index + 1);
    if (definition.numFmt) {
      column.numFmt = definition.numFmt;
    }
  });

  fitWorksheetColumns(worksheet, columnDefs);
}

function addWorksheetTable(workbook, sheetName, columns, rows, emptyMessage = "No rows to export.") {
  const worksheet = workbook.addWorksheet(normalizeWorksheetName(sheetName));
  worksheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key
  }));

  if (Array.isArray(rows) && rows.length) {
    rows.forEach((row, index) => {
      const values = {};
      columns.forEach((column) => {
        const rawValue = typeof column.value === "function"
          ? column.value(row, index)
          : row?.[column.key];
        values[column.key] = normalizeExcelCellValue(rawValue);
      });
      worksheet.addRow(values);
    });
  } else {
    const firstKey = columns[0]?.key || "value";
    const row = {};
    row[firstKey] = emptyMessage;
    worksheet.addRow(row);
    if (columns.length > 1) {
      worksheet.mergeCells(2, 1, 2, columns.length);
    }
    const emptyCell = worksheet.getCell(2, 1);
    emptyCell.font = { italic: true, color: { argb: "FF5C6B79" } };
    emptyCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }

  styleWorksheet(worksheet, columns);
  return worksheet;
}

const HIGH_LEVEL_THRESHOLD = 10;

function levelNumber(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePickBulkType(value) {
  const text = cleanValue(value).toUpperCase();
  if (!text) {
    return "Unknown";
  }
  if (text === "P" || text === "PICK" || text.startsWith("PICK")) {
    return "Pick";
  }
  if (text === "B" || text === "BULK" || text.startsWith("BULK")) {
    return "Bulk";
  }
  return text;
}

function warehouseBinType(row) {
  return normalizePickBulkType(
    row?.BLBKPK ??
    row?.["Pick / Bulk"] ??
    row?.["B/P"] ??
    row?.bin_type ??
    row?.pick_bulk
  );
}

function warehouseMaxBinQty(row) {
  return safeNumber(
    row?.BLMAXQ ??
    row?.["Max. Bin Qty"] ??
    row?.["Max Bin Qty"] ??
    row?.max_bin_qty
  );
}

function estimateReplenishments(totalPickQty, maxBinQty) {
  const pickQty = safeNumber(totalPickQty);
  const capacity = safeNumber(maxBinQty);
  if (pickQty <= 0 || capacity <= 0) {
    return 0;
  }
  return Math.max(0, Math.ceil(pickQty / capacity) - 1);
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

function pickActivitySnapshotMeta(record, source = "pocketbase") {
  if (!record) {
    return {
      available: false,
      source,
      warehouse_code: "",
      client_code: DEFAULT_CLIENT_CODE,
      snapshot_date: "",
      row_count: 0,
      total_pick_count: 0,
      total_pick_qty: 0,
      uploaded_at: ""
    };
  }
  return {
    available: true,
    source,
    warehouse_code: record.warehouse_code || "",
    client_code: record.client_code || DEFAULT_CLIENT_CODE,
    snapshot_date: record.snapshot_date || "",
    row_count: Number(record.row_count || 0),
    total_pick_count: Number(record.total_pick_count || 0),
    total_pick_qty: safeNumber(record.total_pick_qty || 0),
    uploaded_at: record.uploaded_at || "",
    source_synced_at: record.source_synced_at || ""
  };
}

function pickMetricValue(entry, metricKey = "pick_count") {
  return metricKey === "pick_qty"
    ? safeNumber(entry?.pick_qty || 0)
    : Number(entry?.pick_count || 0);
}

function sortPickReportRows(rows, metricKey = "pick_count", labelKey = "label") {
  return [...(rows || [])].sort((a, b) => {
    const metricDiff = pickMetricValue(b, metricKey) - pickMetricValue(a, metricKey);
    if (metricDiff !== 0) {
      return metricDiff;
    }
    const pickCountDiff = Number(b?.pick_count || 0) - Number(a?.pick_count || 0);
    if (pickCountDiff !== 0) {
      return pickCountDiff;
    }
    const pickQtyDiff = safeNumber(b?.pick_qty || 0) - safeNumber(a?.pick_qty || 0);
    if (pickQtyDiff !== 0) {
      return pickQtyDiff;
    }
    return String(a?.[labelKey] || "").localeCompare(String(b?.[labelKey] || ""));
  });
}

function buildOutlierRows(rows, metricKey = "pick_count", limit = 12) {
  const candidates = (rows || []).filter((row) => pickMetricValue(row, metricKey) > 0);
  if (candidates.length < 3) {
    return [];
  }

  const values = candidates.map((row) => pickMetricValue(row, metricKey));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  const standardDeviation = Math.sqrt(variance);
  if (!Number.isFinite(standardDeviation) || standardDeviation <= 0) {
    return [];
  }

  const threshold = mean + standardDeviation * 2;
  return candidates
    .filter((row) => pickMetricValue(row, metricKey) >= threshold)
    .map((row) => ({
      ...row,
      outlier_score: (pickMetricValue(row, metricKey) - mean) / standardDeviation,
      outlier_threshold: threshold
    }))
    .sort((a, b) => (b.outlier_score - a.outlier_score) || (pickMetricValue(b, metricKey) - pickMetricValue(a, metricKey)))
    .slice(0, Math.max(1, limit));
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
    this.pickActivitySnapshotCache = new Map();
    this.layoutManifestCache = null;
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

    await this.ensureCollection(PICK_ACTIVITY_SNAPSHOT_COLLECTION, [
      { name: "warehouse_code", type: "text", required: true, max: 64 },
      { name: "client_code", type: "text", required: true, max: 64 },
      { name: "snapshot_date", type: "text", required: true, max: 32 },
      { name: "row_count", type: "number", required: false, min: 0, onlyInt: true },
      { name: "total_pick_count", type: "number", required: false, min: 0, onlyInt: true },
      { name: "total_pick_qty", type: "number", required: false, min: 0 },
      { name: "uploaded_at", type: "text", required: false, max: 64 },
      { name: "source_synced_at", type: "text", required: false, max: 64 },
      { name: "snapshot_file", type: "file", required: true, maxSelect: 1, maxSize: 52428800 }
    ]);
    report.push(`${PICK_ACTIVITY_SNAPSHOT_COLLECTION} ready`);

    await this.ensureCollection(ACTIVITY_LOG_COLLECTION, [
      { name: "user_id", type: "text", required: false, max: 64 },
      { name: "user_email", type: "text", required: false, max: 255 },
      { name: "user_name", type: "text", required: false, max: 255 },
      { name: "action", type: "text", required: true, max: 64 },
      { name: "detail", type: "json", required: false },
      { name: "ip_address", type: "text", required: false, max: 64 }
    ]);
    report.push(`${ACTIVITY_LOG_COLLECTION} ready`);

    await this.ensureCollection(NOTES_COLLECTION, [
      { name: "client_code", type: "text", required: true, max: 64 },
      { name: "sku", type: "text", required: true, max: 64 },
      { name: "notes", type: "text", required: false, max: 10000 },
      { name: "updated_at", type: "text", required: false, max: 64 },
      { name: "updated_by_user_id", type: "text", required: false, max: 64 },
      { name: "updated_by_email", type: "text", required: false, max: 255 },
      { name: "updated_by_name", type: "text", required: false, max: 255 }
    ]);
    report.push(`${NOTES_COLLECTION} ready`);

    await this.ensureCollection(DELETION_REQUESTS_COLLECTION, [
      { name: "client_code", type: "text", required: true, max: 64 },
      { name: "sku", type: "text", required: true, max: 64 },
      { name: "image_id", type: "text", required: true, max: 64 },
      { name: "image_url", type: "text", required: false, max: 1000 },
      { name: "image_caption", type: "text", required: false, max: 1000 },
      { name: "status", type: "text", required: true, max: 16 },
      { name: "requested_at", type: "text", required: false, max: 64 },
      { name: "requested_by_user_id", type: "text", required: false, max: 64 },
      { name: "requested_by_email", type: "text", required: false, max: 255 },
      { name: "requested_by_name", type: "text", required: false, max: 255 },
      { name: "reviewed_at", type: "text", required: false, max: 64 },
      { name: "reviewed_by_user_id", type: "text", required: false, max: 64 },
      { name: "reviewed_by_email", type: "text", required: false, max: 255 }
    ]);
    report.push(`${DELETION_REQUESTS_COLLECTION} ready`);

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

  async listPickActivitySnapshotRecords(clientCode = DEFAULT_CLIENT_CODE, limit = 120) {
    const response = await this.pb.listRecords(PICK_ACTIVITY_SNAPSHOT_COLLECTION, {
      filterExpr: `client_code=${pbFilterLiteral(clientCode)}`,
      sort: "-snapshot_date,-uploaded_at",
      page: 1,
      perPage: Math.max(1, Math.min(90, limit))
    });
    return response.items || [];
  }

  async getPickActivitySnapshotRecord(clientCode = DEFAULT_CLIENT_CODE, snapshotDate = "") {
    const filterParts = [`client_code=${pbFilterLiteral(clientCode)}`];
    if (snapshotDate) {
      filterParts.push(`snapshot_date=${pbFilterLiteral(snapshotDate)}`);
    }
    const response = await this.pb.listRecords(PICK_ACTIVITY_SNAPSHOT_COLLECTION, {
      filterExpr: filterParts.join(" && "),
      sort: "-snapshot_date,-uploaded_at",
      page: 1,
      perPage: 1
    });
    return response.items?.[0] || null;
  }

  async loadPickActivitySnapshot(snapshotDate = "", clientCode = DEFAULT_CLIENT_CODE, forceRefresh = false) {
    const cacheKey = `${String(clientCode || DEFAULT_CLIENT_CODE)}::${String(snapshotDate || "latest")}`;
    const cached = this.pickActivitySnapshotCache.get(cacheKey);
    const now = Date.now();
    if (!forceRefresh && cached && now - cached.loadedAt < PICK_ACTIVITY_CACHE_TTL_MS) {
      return cached;
    }

    const record = await this.getPickActivitySnapshotRecord(clientCode, snapshotDate);
    if (!record) {
      const payload = {
        loadedAt: now,
        snapshot: null,
        meta: pickActivitySnapshotMeta(null, "none")
      };
      this.pickActivitySnapshotCache.set(cacheKey, payload);
      return payload;
    }

    const fileName = recordFileName(record, "snapshot_file");
    if (!fileName) {
      throw new PocketBaseError("Pick activity snapshot file is missing.", 500);
    }

    const response = await this.pb.proxyFile(
      record.collectionId || record.collectionName || PICK_ACTIVITY_SNAPSHOT_COLLECTION,
      record.id,
      fileName
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    const jsonBuffer = fileName.toLowerCase().endsWith(".gz") ? zlib.gunzipSync(buffer) : buffer;
    const snapshot = JSON.parse(jsonBuffer.toString("utf-8"));
    const payload = {
      loadedAt: now,
      snapshot,
      meta: pickActivitySnapshotMeta(record, "pocketbase")
    };
    this.pickActivitySnapshotCache.set(cacheKey, payload);
    return payload;
  }

  async loadLayoutManifest(forceRefresh = false) {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.layoutManifestCache &&
      now - this.layoutManifestCache.loadedAt < PICK_ACTIVITY_CACHE_TTL_MS
    ) {
      return this.layoutManifestCache.manifest;
    }
    const raw = await fs.readFile(LAYOUT_MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(raw);
    this.layoutManifestCache = {
      loadedAt: now,
      manifest
    };
    return manifest;
  }

  async getLayoutOverrides() {
    const overridePath = path.join(__dirname, "data", "layout-overrides.json");

    // Default bin size dimensions (mm). Seeded on first run; user edits are persisted.
    const DEFAULT_BIN_SIZES = {
      F2: { height: 310,  width: 650,  depth: 600  },
      F4: { height: 310,  width: 325,  depth: 600  },
      F8: { height: 310,  width: 160,  depth: 300  },
      CG: { height: 1650, width: 1200, depth: 1000 },
      CF: { height: 2200, width: 1200, depth: 1000 },
      CP: { height: 800,  width: 425,  depth: 900  },
      CU: { height: 350,  width: 433,  depth: 900  },
      CL: { height: 350,  width: 1200, depth: 900  },
      CB: { height: 1150, width: 1200, depth: 1000 },
      CR: { height: 510,  width: 675,  depth: 900  },
    };

    let parsed = {};
    try {
      const raw = await fs.readFile(overridePath, "utf8");
      parsed = JSON.parse(raw);
    } catch (_) {
      // File missing or corrupt — will be created below with defaults
    }

    // Merge defaults into bin_sizes so known codes are always present,
    // but any user-customised entry takes precedence.
    const bin_sizes = { ...DEFAULT_BIN_SIZES, ...(parsed.bin_sizes || {}) };

    const result = {
      zones:             parsed.zones             || {},
      aisles:            parsed.aisles            || {},
      bays:              parsed.bays              || {},
      locations:         parsed.locations         || {},
      virtual_locations: parsed.virtual_locations || [],
      bin_sizes,
    };

    // If the file was missing, write it out now so it persists
    if (!parsed.bin_sizes) {
      try {
        await fs.writeFile(overridePath, JSON.stringify(result, null, 2), "utf8");
      } catch (_) { /* non-fatal */ }
    }

    return result;
  }

  async saveLayoutOverrides(overrides) {
    const overridePath = path.join(__dirname, "data", "layout-overrides.json");
    const safe = {
      zones:             overrides?.zones             && typeof overrides.zones  === "object" ? overrides.zones  : {},
      aisles:            overrides?.aisles            && typeof overrides.aisles === "object" ? overrides.aisles : {},
      bays:              overrides?.bays              && typeof overrides.bays   === "object" ? overrides.bays   : {},
      locations:         overrides?.locations         && typeof overrides.locations === "object" ? overrides.locations : {},
      virtual_locations: Array.isArray(overrides?.virtual_locations) ? overrides.virtual_locations : [],
      bin_sizes:         overrides?.bin_sizes         && typeof overrides.bin_sizes === "object" ? overrides.bin_sizes : {}
    };
    await fs.writeFile(overridePath, JSON.stringify(safe, null, 2), "utf8");
    return safe;
  }

  parseHeatmapLocation(locationCode = "") {
    const text = String(locationCode || "").trim().toUpperCase();
    const digits = text.slice(2).replace(/\D+/g, "");
    return {
      location: text,
      aisle_prefix: text.slice(0, 2),
      bay: digits.slice(0, 2),
      level: digits.slice(2, 4),
      slot: digits.slice(4, 6)
    };
  }

  // Lightweight read of all location codes from the snapshot (no pick/catalog data).
  // Used by the layout editor to render every block.
  async getSnapshotLocations() {
    const [layoutManifest, layoutOverrides, warehouseState] = await Promise.all([
      this.loadLayoutManifest().catch(() => ({ zones: [] })),
      this.getLayoutOverrides().catch(() => ({ virtual_locations: [] })),
      this.loadWarehouseSnapshot()
    ]);

    const zoneIndex = new Map();
    for (const zone of layoutManifest?.zones || []) {
      for (const aisle of zone?.aisles || []) {
        zoneIndex.set(aisle.prefix, zone.zone_key || "");
      }
    }

    const seen = new Set();
    const locations = [];

    for (const row of warehouseState?.snapshot?.rows || []) {
      const locationCode = String(row?.BLBINL || row?.["Bin Location"] || row?.bin_location || "").trim().toUpperCase();
      if (!locationCode || seen.has(locationCode)) continue;
      const status = String(row?.BLSTS || row?.status || "").trim().toUpperCase();
      if (status && status !== "Y") continue;
      seen.add(locationCode);

      const parts = this.parseHeatmapLocation(locationCode);
      const binSize = String(row?.BLSCOD || row?.["Bin Size"] || row?.bin_size || "").trim().toUpperCase();
      locations.push({
        location: locationCode,
        aisle_prefix: parts.aisle_prefix,
        bay: parts.bay,
        level: parts.level,
        slot: parts.slot,
        zone_key: zoneIndex.get(parts.aisle_prefix) || "",
        bin_size: binSize,
        is_virtual: false
      });
    }

    // Append virtual locations from overrides that aren't in the snapshot
    for (const vl of layoutOverrides.virtual_locations || []) {
      const loc = String(vl.location || "").trim().toUpperCase();
      if (!loc || seen.has(loc)) continue;
      const parts = this.parseHeatmapLocation(loc);
      locations.push({
        location: loc,
        aisle_prefix: parts.aisle_prefix,
        bay: parts.bay,
        level: parts.level,
        slot: parts.slot,
        zone_key: zoneIndex.get(parts.aisle_prefix) || "",
        bin_size: String(vl.bin_size || "").trim().toUpperCase(),
        is_virtual: true
      });
    }

    return locations;
  }

  resolvePickSnapshotRange(pickRecords, options = {}) {
    const availableDates = (pickRecords || [])
      .map((record) => String(record?.snapshot_date || "").trim())
      .filter(Boolean)
      .sort((a, b) => String(b).localeCompare(String(a)));
    const availableDateSet = new Set(availableDates);
    const latestAvailableDate = availableDates[0] || "";
    const mode = String(options.mode || "").trim().toLowerCase() || "latest";

    if (!latestAvailableDate) {
      return {
        mode,
        availableDates,
        latestAvailableDate: "",
        requestedDates: [],
        matchedDates: [],
        missingDates: [],
        requestedStartDate: "",
        requestedEndDate: "",
        resolvedStartDate: "",
        resolvedEndDate: ""
      };
    }

    let requestedStartDate = "";
    let requestedEndDate = "";
    if (mode === "date") {
      requestedStartDate = String(options.snapshotDate || "").trim() || latestAvailableDate;
      requestedEndDate = requestedStartDate;
    } else if (mode === "custom") {
      requestedStartDate = String(options.startDate || "").trim();
      requestedEndDate = String(options.endDate || "").trim();
      if (!requestedStartDate && requestedEndDate) {
        requestedStartDate = requestedEndDate;
      }
      if (!requestedEndDate && requestedStartDate) {
        requestedEndDate = requestedStartDate;
      }
      if (!requestedStartDate || !requestedEndDate) {
        requestedStartDate = latestAvailableDate;
        requestedEndDate = latestAvailableDate;
      }
    } else if (mode === "last_90") {
      requestedEndDate = latestAvailableDate;
      const end = parseDateText(latestAvailableDate) || new Date();
      requestedStartDate = formatDateText(addUtcDays(end, -89));
    } else if (mode === "last_60") {
      requestedEndDate = latestAvailableDate;
      const end = parseDateText(latestAvailableDate) || new Date();
      requestedStartDate = formatDateText(addUtcDays(end, -59));
    } else if (mode === "last_30") {
      requestedEndDate = latestAvailableDate;
      const end = parseDateText(latestAvailableDate) || new Date();
      requestedStartDate = formatDateText(addUtcDays(end, -29));
    } else if (mode === "last_7") {
      requestedEndDate = latestAvailableDate;
      const end = parseDateText(latestAvailableDate) || new Date();
      requestedStartDate = formatDateText(addUtcDays(end, -6));
    } else {
      requestedStartDate = latestAvailableDate;
      requestedEndDate = latestAvailableDate;
    }

    let startDate = parseDateText(requestedStartDate);
    let endDate = parseDateText(requestedEndDate);
    if (!startDate && endDate) {
      startDate = new Date(endDate.getTime());
    }
    if (!endDate && startDate) {
      endDate = new Date(startDate.getTime());
    }
    if (!startDate || !endDate) {
      startDate = parseDateText(latestAvailableDate) || new Date();
      endDate = new Date(startDate.getTime());
    }
    if (startDate > endDate) {
      const temp = startDate;
      startDate = endDate;
      endDate = temp;
    }

    const requestedDates = [];
    for (let cursor = new Date(startDate.getTime()); cursor <= endDate; cursor = addUtcDays(cursor, 1)) {
      requestedDates.push(formatDateText(cursor));
    }

    return {
      mode,
      availableDates,
      latestAvailableDate,
      requestedDates,
      matchedDates: requestedDates.filter((date) => availableDateSet.has(date)),
      missingDates: requestedDates.filter((date) => !availableDateSet.has(date)),
      requestedStartDate,
      requestedEndDate,
      resolvedStartDate: formatDateText(startDate),
      resolvedEndDate: formatDateText(endDate)
    };
  }

  async getPickingHeatmap(clientCode = DEFAULT_CLIENT_CODE, options = {}) {
    const targetClient = String(clientCode || DEFAULT_CLIENT_CODE).trim().toUpperCase();
    const [layoutManifest, layoutOverrides, warehouseState, pickRecords, catalogState, imageState] = await Promise.all([
      this.loadLayoutManifest(),
      this.getLayoutOverrides().catch(() => ({ zones: {}, aisles: {}, bays: {}, locations: {}, virtual_locations: [], bin_sizes: {} })),
      this.loadWarehouseSnapshot(),
      this.listPickActivitySnapshotRecords(targetClient, 120).catch(() => []),
      this.loadSnapshot(targetClient).catch(() => ({ snapshot: null, meta: this.snapshotMeta(null, "none") })),
      this.loadImageIndex(targetClient).catch(() => ({ imageMap: new Map(), imageSkuSet: new Set(), imageRecordCount: 0 }))
    ]);

    const range = this.resolvePickSnapshotRange(pickRecords, {
      mode: options.mode,
      snapshotDate: options.snapshotDate,
      startDate: options.startDate,
      endDate: options.endDate
    });

    let pickState = { snapshot: null, meta: pickActivitySnapshotMeta(null, "none") };
    let pickRows = [];
    let pickLoadedDates = [];
    if (range.matchedDates.length) {
      const snapshots = await Promise.all(
        range.matchedDates.map((date) => this.loadPickActivitySnapshot(date, targetClient))
      );
      const byLocation = new Map();
      let totalPickCount = 0;
      let totalPickQty = 0;
      for (const snapshotState of snapshots) {
        const snapshot = snapshotState?.snapshot || null;
        if (!snapshot) {
          continue;
        }
        pickLoadedDates.push(String(snapshot.snapshot_date || snapshotState?.meta?.snapshot_date || "").trim());
        totalPickCount += Number(snapshot.total_pick_count || 0);
        totalPickQty += safeNumber(snapshot.total_pick_qty || 0);
        for (const row of snapshot.rows || []) {
          const location = String(row?.location || "").trim().toUpperCase();
          if (!location) {
            continue;
          }
          const existing = byLocation.get(location) || {
            location,
            aisle_prefix: String(row?.aisle_prefix || "").trim().toUpperCase(),
            bay: String(row?.bay || "").trim(),
            level: String(row?.level || "").trim(),
            slot: String(row?.slot || "").trim(),
            pick_count: 0,
            pick_qty: 0,
            picker_count: 0,
            _topSkuMap: new Map()
          };
          existing.pick_count += Number(row?.pick_count || 0);
          existing.pick_qty += safeNumber(row?.pick_qty || 0);
          existing.picker_count = Math.max(existing.picker_count, Number(row?.picker_count || 0));
          for (const skuRow of row?.top_skus || []) {
            const sku = normalizeSku(skuRow?.sku);
            if (!sku) {
              continue;
            }
            const skuExisting = existing._topSkuMap.get(sku) || { sku, pick_count: 0, pick_qty: 0, picker_count: 0 };
            skuExisting.pick_count += Number(skuRow?.pick_count || 0);
            skuExisting.pick_qty += safeNumber(skuRow?.pick_qty || 0);
            skuExisting.picker_count = Math.max(skuExisting.picker_count, Number(skuRow?.picker_count || 0));
            existing._topSkuMap.set(sku, skuExisting);
          }
          byLocation.set(location, existing);
        }
      }
      pickRows = Array.from(byLocation.values()).map((row) => ({
        location: row.location,
        aisle_prefix: row.aisle_prefix,
        bay: row.bay,
        level: row.level,
        slot: row.slot,
        pick_count: row.pick_count,
        pick_qty: row.pick_qty,
        picker_count: row.picker_count,
        top_skus: Array.from(row._topSkuMap.values())
          .sort((a, b) => (b.pick_count - a.pick_count) || (b.pick_qty - a.pick_qty) || String(a.sku).localeCompare(String(b.sku)))
          .slice(0, 5)
      }));

      pickState = {
        snapshot: {
          warehouse_code: snapshots[0]?.snapshot?.warehouse_code || "",
          client_code: targetClient,
          snapshot_date: range.resolvedEndDate || range.latestAvailableDate,
          requested_start_date: range.resolvedStartDate,
          requested_end_date: range.resolvedEndDate,
          range_mode: range.mode,
          row_count: pickRows.length,
          total_pick_count: totalPickCount,
          total_pick_qty: totalPickQty,
          rows: pickRows
        },
        meta: {
          available: true,
          source: "pocketbase",
          warehouse_code: snapshots[0]?.meta?.warehouse_code || "",
          client_code: targetClient,
          snapshot_date: range.resolvedEndDate || range.latestAvailableDate,
          row_count: pickRows.length,
          total_pick_count: totalPickCount,
          total_pick_qty: totalPickQty,
          uploaded_at: snapshots[0]?.meta?.uploaded_at || "",
          source_synced_at: snapshots[0]?.meta?.source_synced_at || ""
        }
      };
    }

    let barcodeSnapshot = null;
    try {
      barcodeSnapshot = (await this.loadBarcodeSnapshot(targetClient)).snapshot;
    } catch (_) {
      barcodeSnapshot = null;
    }
    if (catalogState?.snapshot) {
      this.applyBarcodeSnapshot(catalogState.snapshot, barcodeSnapshot);
    }

    const catalogItems = new Map();
    for (const item of catalogState?.snapshot?.items || []) {
      const sku = normalizeSku(item?.sku);
      if (sku) {
        catalogItems.set(sku, item);
      }
    }

    const imageMap = imageState.imageMap || new Map();
    const pickMap = new Map();
    for (const row of pickRows) {
      const key = String(row?.location || "").trim().toUpperCase();
      if (key) {
        pickMap.set(key, row);
      }
    }

    const aisleOrder = Array.isArray(layoutManifest?.aisle_order) ? layoutManifest.aisle_order : [];
    const aisleIndex = new Map(aisleOrder.map((prefix, index) => [prefix, index]));
    const zoneIndex = new Map();
    for (const zone of layoutManifest?.zones || []) {
      for (const aisle of zone.aisles || []) {
        zoneIndex.set(aisle.prefix, zone.zone_key);
      }
    }

    const locationMap = new Map();
    for (const row of warehouseState?.snapshot?.rows || []) {
      const client = String(row?.BLCCOD || row?.Client || row?.client_code || "").trim().toUpperCase();
      if (targetClient && client && client !== targetClient) {
        continue;
      }
      const locationCode = String(row?.BLBINL || row?.["Bin Location"] || row?.bin_location || "").trim().toUpperCase();
      if (!locationCode) {
        continue;
      }
      const status = String(row?.BLSTS || row?.status || "").trim().toUpperCase();
      if (status && status !== "Y") {
        continue;
      }
      const parts = this.parseHeatmapLocation(locationCode);
      const sku = normalizeSku(row?.BLITEM || row?.["Item SKU"] || row?.sku);
      const catalogItem = catalogItems.get(sku) || null;
      const binSize = String(row?.BLSCOD || row?.["Bin Size"] || row?.bin_size || "").trim().toUpperCase();
      locationMap.set(locationCode, {
        location: locationCode,
        aisle_prefix: parts.aisle_prefix,
        bay: parts.bay,
        level: parts.level,
        slot: parts.slot,
        zone_key: zoneIndex.get(parts.aisle_prefix) || "",
        aisle_index: aisleIndex.has(parts.aisle_prefix) ? aisleIndex.get(parts.aisle_prefix) : 9999,
        sku,
        description: catalogItem?.description || catalogItem?.description_short || "",
        qty: safeNumber(row?.BLQTY || row?.qty || 0),
        status: status || "Y",
        bin_size: binSize,
        image_count: imageMap.get(sku)?.length || 0,
        has_images: imageMap.has(sku),
        pick_count: 0,
        pick_qty: 0,
        picker_count: 0,
        top_skus: []
      });
    }

    for (const row of pickRows) {
      const locationCode = String(row?.location || "").trim().toUpperCase();
      if (!locationCode) {
        continue;
      }
      const parts = this.parseHeatmapLocation(locationCode);
      const entry =
        locationMap.get(locationCode) ||
        {
          location: locationCode,
          aisle_prefix: parts.aisle_prefix,
          bay: parts.bay,
          level: parts.level,
          slot: parts.slot,
          zone_key: zoneIndex.get(parts.aisle_prefix) || "",
          aisle_index: aisleIndex.has(parts.aisle_prefix) ? aisleIndex.get(parts.aisle_prefix) : 9999,
          sku: "",
          description: "",
          qty: 0,
          status: "",
          bin_size: "",
          image_count: 0,
          has_images: false,
          top_skus: []
        };
      entry.pick_count = Number(row?.pick_count || 0);
      entry.pick_qty = safeNumber(row?.pick_qty || 0);
      entry.picker_count = Number(row?.picker_count || 0);
      entry.top_skus = Array.isArray(row?.top_skus) ? row.top_skus : [];
      locationMap.set(locationCode, entry);
    }

    // Merge virtual locations (admin-defined, don't exist in warehouse snapshot)
    for (const vl of layoutOverrides.virtual_locations || []) {
      const loc = String(vl.location || "").trim().toUpperCase();
      if (!loc || locationMap.has(loc)) continue;
      const parts = this.parseHeatmapLocation(loc);
      locationMap.set(loc, {
        location: loc,
        aisle_prefix: parts.aisle_prefix,
        bay: parts.bay,
        level: parts.level,
        slot: parts.slot,
        zone_key: zoneIndex.get(parts.aisle_prefix) || "",
        aisle_index: aisleIndex.has(parts.aisle_prefix) ? aisleIndex.get(parts.aisle_prefix) : 9999,
        sku: "",
        description: "",
        qty: 0,
        status: "Y",
        bin_size: String(vl.bin_size || "").trim().toUpperCase(),
        image_count: 0,
        has_images: false,
        pick_count: 0,
        pick_qty: 0,
        picker_count: 0,
        top_skus: [],
        is_virtual: true
      });
    }

    const rows = Array.from(locationMap.values()).sort((a, b) => {
      if (a.aisle_index !== b.aisle_index) {
        return a.aisle_index - b.aisle_index;
      }
      return (
        Number.parseInt(a.bay || "0", 10) - Number.parseInt(b.bay || "0", 10) ||
        Number.parseInt(a.level || "0", 10) - Number.parseInt(b.level || "0", 10) ||
        Number.parseInt(a.slot || "0", 10) - Number.parseInt(b.slot || "0", 10) ||
        String(a.location || "").localeCompare(String(b.location || ""))
      );
    });

    // Collect all known bin size codes from data
    const knownBinSizes = new Set();
    for (const row of rows) {
      if (row.bin_size) knownBinSizes.add(row.bin_size);
    }

    const hottestByAisle = new Map();
    let occupiedCount = 0;
    let pickedCount = 0;
    let totalPickCount = 0;
    let totalPickQty = 0;
    for (const row of rows) {
      if (row.sku) {
        occupiedCount += 1;
      }
      if (row.pick_count > 0) {
        pickedCount += 1;
      }
      totalPickCount += Number(row.pick_count || 0);
      totalPickQty += safeNumber(row.pick_qty || 0);
      const aisle = row.aisle_prefix || "__UNKNOWN__";
      const summary = hottestByAisle.get(aisle) || { aisle_prefix: aisle, pick_count: 0, pick_qty: 0, location_count: 0 };
      summary.pick_count += Number(row.pick_count || 0);
      summary.pick_qty += safeNumber(row.pick_qty || 0);
      summary.location_count += 1;
      hottestByAisle.set(aisle, summary);
    }

    return {
      layout: layoutManifest,
      overrides: layoutOverrides,
      bin_sizes: layoutOverrides.bin_sizes || {},
      known_bin_sizes: Array.from(knownBinSizes).sort(),
      rows,
      meta: {
        client_code: targetClient,
        warehouse_snapshot_date: warehouseState?.meta?.snapshot_date || "",
        pick_snapshot_date: pickState?.meta?.snapshot_date || "",
        available_pick_dates: range.availableDates,
        pick_loaded_dates: pickLoadedDates,
        pick_range_mode: range.mode,
        pick_requested_start_date: range.resolvedStartDate,
        pick_requested_end_date: range.resolvedEndDate,
        pick_requested_day_count: range.requestedDates.length,
        pick_available_day_count: range.matchedDates.length,
        pick_missing_dates: range.missingDates,
        latest_pick_snapshot_date: range.latestAvailableDate,
        pick_snapshot_meta: pickState?.meta || pickActivitySnapshotMeta(null, "none"),
        item_catalog_meta: catalogState?.meta || this.snapshotMeta(null, "none")
      },
      stats: {
        location_count: rows.length,
        occupied_location_count: occupiedCount,
        picked_location_count: pickedCount,
        total_pick_count: totalPickCount,
        total_pick_qty: totalPickQty,
        hottest_aisles: Array.from(hottestByAisle.values())
          .sort((a, b) => (b.pick_count - a.pick_count) || (b.pick_qty - a.pick_qty))
          .slice(0, 8)
      }
    };
  }

  async getPickingReports(clientCode = DEFAULT_CLIENT_CODE, options = {}) {
    const targetClient = String(clientCode || DEFAULT_CLIENT_CODE).trim().toUpperCase();
    const rankBy = String(options.rankBy || "").trim().toLowerCase() === "pick_qty" ? "pick_qty" : "pick_count";
    const limit = Math.max(10, Math.min(250, Number.parseInt(options.limit || "50", 10) || 50));

    const [pickRecords, catalogState, warehouseState] = await Promise.all([
      this.listPickActivitySnapshotRecords(targetClient, 90).catch(() => []),
      this.loadSnapshot(targetClient).catch(() => ({ snapshot: null, meta: this.snapshotMeta(null, "none") })),
      this.loadWarehouseSnapshot().catch(() => ({ snapshot: null, meta: warehouseSnapshotMeta(null, "none") }))
    ]);

    const range = this.resolvePickSnapshotRange(pickRecords, {
      mode: options.mode,
      snapshotDate: options.snapshotDate,
      startDate: options.startDate,
      endDate: options.endDate
    });

    const catalogItems = new Map();
    for (const item of catalogState?.snapshot?.items || []) {
      const sku = normalizeSku(item?.sku);
      if (sku) {
        catalogItems.set(sku, item);
      }
    }

    const warehouseLocationMap = new Map();
    for (const row of warehouseState?.snapshot?.rows || []) {
      const client = String(row?.BLCCOD || row?.Client || row?.client_code || "").trim().toUpperCase();
      if (targetClient && client && client !== targetClient) {
        continue;
      }
      const location = String(row?.BLBINL || row?.["Bin Location"] || row?.bin_location || "").trim().toUpperCase();
      if (!location) {
        continue;
      }
      const status = String(row?.BLSTS || row?.Status || row?.status || "").trim().toUpperCase();
      if (status && status !== "Y") {
        continue;
      }
      const parts = this.parseHeatmapLocation(location);
      warehouseLocationMap.set(location, {
        location,
        aisle_prefix: parts.aisle_prefix,
        bay: parts.bay,
        level: parts.level,
        slot: parts.slot,
        level_number: levelNumber(parts.level),
        sku: normalizeSku(row?.BLITEM || row?.["Item SKU"] || row?.sku),
        bin_size: String(row?.BLSCOD || row?.["Bin Size"] || row?.["Bin Size Code"] || row?.bin_size || "").trim().toUpperCase(),
        bin_type: warehouseBinType(row),
        max_bin_qty: warehouseMaxBinQty(row),
        bin_qty: safeNumber(row?.BLQTY || row?.qty || row?.["Quantity in Bin"] || 0)
      });
    }

    const skuMap = new Map();
    const locationMap = new Map();
    const aisleMap = new Map();
    const dailyMap = new Map();
    const levelMap = new Map();
    const binTypeMap = new Map();
    const binSizeMap = new Map();
    const skuLevelMap = new Map();
    const replenishmentMap = new Map();
    const pickLoadedDates = [];
    let totalPickCount = 0;
    let totalPickQty = 0;
    let pickBinPickCount = 0;
    let pickBinPickQty = 0;
    let bulkBinPickCount = 0;
    let bulkBinPickQty = 0;
    let unknownBinTypePickCount = 0;
    let unknownBinTypePickQty = 0;
    let highLevelPickCount = 0;
    let highLevelPickQty = 0;

    if (range.matchedDates.length) {
      const snapshots = await Promise.all(
        range.matchedDates.map((date) => this.loadPickActivitySnapshot(date, targetClient))
      );

      for (const snapshotState of snapshots) {
        const snapshot = snapshotState?.snapshot || null;
        if (!snapshot) {
          continue;
        }

        const snapshotDate = String(snapshot.snapshot_date || snapshotState?.meta?.snapshot_date || "").trim();
        if (snapshotDate) {
          pickLoadedDates.push(snapshotDate);
        }

        totalPickCount += Number(snapshot.total_pick_count || 0);
        totalPickQty += safeNumber(snapshot.total_pick_qty || 0);

        const dayEntry = dailyMap.get(snapshotDate) || {
          date: snapshotDate,
          pick_count: 0,
          pick_qty: 0,
          _skuSet: new Set(),
          _locationSet: new Set(),
          _aisleSet: new Set()
        };
        dayEntry.pick_count += Number(snapshot.total_pick_count || 0);
        dayEntry.pick_qty += safeNumber(snapshot.total_pick_qty || 0);

        for (const row of snapshot.rows || []) {
          const location = String(row?.location || "").trim().toUpperCase();
          const warehouseProfile = warehouseLocationMap.get(location) || null;
          const aislePrefix = String(warehouseProfile?.aisle_prefix || row?.aisle_prefix || "").trim().toUpperCase();
          const levelText = String(warehouseProfile?.level || row?.level || "").trim();
          const slotText = String(warehouseProfile?.slot || row?.slot || "").trim();
          const levelNum = warehouseProfile?.level_number || levelNumber(levelText);
          const binType = warehouseProfile?.bin_type || "Unknown";
          const binSize = String(warehouseProfile?.bin_size || "").trim().toUpperCase() || "Unknown";
          const maxBinQty = safeNumber(warehouseProfile?.max_bin_qty || 0);
          let locationEntry = null;
          let aisleEntry = null;
          let levelEntry = null;
          let binTypeEntry = null;
          let binSizeEntry = null;

          if (location) {
            locationEntry = locationMap.get(location) || {
              label: location,
              location,
              aisle_prefix: aislePrefix,
              bay: String(warehouseProfile?.bay || row?.bay || "").trim(),
              level: levelText,
              slot: slotText,
              bin_type: binType,
              bin_size: binSize,
              max_bin_qty: maxBinQty,
              current_sku: warehouseProfile?.sku || "",
              pick_count: 0,
              pick_qty: 0,
              _daySet: new Set(),
              _skuSet: new Set()
            };
            locationEntry.pick_count += Number(row?.pick_count || 0);
            locationEntry.pick_qty += safeNumber(row?.pick_qty || 0);
            if (snapshotDate) {
              locationEntry._daySet.add(snapshotDate);
            }
            locationMap.set(location, locationEntry);
            if (snapshotDate) {
              dayEntry._locationSet.add(location);
            }
          }

          if (aislePrefix) {
            aisleEntry = aisleMap.get(aislePrefix) || {
              label: aislePrefix,
              aisle_prefix: aislePrefix,
              pick_count: 0,
              pick_qty: 0,
              _daySet: new Set(),
              _locationSet: new Set(),
              _skuSet: new Set()
            };
            aisleEntry.pick_count += Number(row?.pick_count || 0);
            aisleEntry.pick_qty += safeNumber(row?.pick_qty || 0);
            if (snapshotDate) {
              aisleEntry._daySet.add(snapshotDate);
              dayEntry._aisleSet.add(aislePrefix);
            }
            if (location) {
              aisleEntry._locationSet.add(location);
            }
            aisleMap.set(aislePrefix, aisleEntry);
          }

          const levelKey = levelText || "Unknown";
          levelEntry = levelMap.get(levelKey) || {
            label: levelKey,
            level: levelKey,
            level_number: levelNum,
            pick_count: 0,
            pick_qty: 0,
            pick_bin_pick_count: 0,
            bulk_bin_pick_count: 0,
            unknown_bin_type_pick_count: 0,
            _daySet: new Set(),
            _locationSet: new Set(),
            _skuSet: new Set()
          };
          levelEntry.pick_count += Number(row?.pick_count || 0);
          levelEntry.pick_qty += safeNumber(row?.pick_qty || 0);
          if (binType === "Pick") {
            levelEntry.pick_bin_pick_count += Number(row?.pick_count || 0);
          } else if (binType === "Bulk") {
            levelEntry.bulk_bin_pick_count += Number(row?.pick_count || 0);
          } else {
            levelEntry.unknown_bin_type_pick_count += Number(row?.pick_count || 0);
          }
          if (snapshotDate) {
            levelEntry._daySet.add(snapshotDate);
          }
          if (location) {
            levelEntry._locationSet.add(location);
          }
          levelMap.set(levelKey, levelEntry);

          const binTypeKey = binType || "Unknown";
          binTypeEntry = binTypeMap.get(binTypeKey) || {
            label: binTypeKey,
            bin_type: binTypeKey,
            pick_count: 0,
            pick_qty: 0,
            _daySet: new Set(),
            _locationSet: new Set(),
            _skuSet: new Set(),
            _levelSet: new Set()
          };
          binTypeEntry.pick_count += Number(row?.pick_count || 0);
          binTypeEntry.pick_qty += safeNumber(row?.pick_qty || 0);
          if (snapshotDate) {
            binTypeEntry._daySet.add(snapshotDate);
          }
          if (location) {
            binTypeEntry._locationSet.add(location);
          }
          if (levelText) {
            binTypeEntry._levelSet.add(levelText);
          }
          binTypeMap.set(binTypeKey, binTypeEntry);

          const binSizeKey = binSize || "Unknown";
          binSizeEntry = binSizeMap.get(binSizeKey) || {
            label: binSizeKey,
            bin_size: binSizeKey,
            pick_count: 0,
            pick_qty: 0,
            _daySet: new Set(),
            _locationSet: new Set(),
            _skuSet: new Set(),
            _levelSet: new Set()
          };
          binSizeEntry.pick_count += Number(row?.pick_count || 0);
          binSizeEntry.pick_qty += safeNumber(row?.pick_qty || 0);
          if (snapshotDate) {
            binSizeEntry._daySet.add(snapshotDate);
          }
          if (location) {
            binSizeEntry._locationSet.add(location);
          }
          if (levelText) {
            binSizeEntry._levelSet.add(levelText);
          }
          binSizeMap.set(binSizeKey, binSizeEntry);

          if (binType === "Pick") {
            pickBinPickCount += Number(row?.pick_count || 0);
            pickBinPickQty += safeNumber(row?.pick_qty || 0);
          } else if (binType === "Bulk") {
            bulkBinPickCount += Number(row?.pick_count || 0);
            bulkBinPickQty += safeNumber(row?.pick_qty || 0);
          } else {
            unknownBinTypePickCount += Number(row?.pick_count || 0);
            unknownBinTypePickQty += safeNumber(row?.pick_qty || 0);
          }

          if (levelNum >= HIGH_LEVEL_THRESHOLD) {
            highLevelPickCount += Number(row?.pick_count || 0);
            highLevelPickQty += safeNumber(row?.pick_qty || 0);
          }

          for (const skuRow of row?.top_skus || []) {
            const sku = normalizeSku(skuRow?.sku);
            if (!sku) {
              continue;
            }

            const catalogItem = catalogItems.get(sku) || null;
            const skuEntry = skuMap.get(sku) || {
              label: sku,
              sku,
              description: catalogItem?.description || catalogItem?.description_short || "",
              pick_count: 0,
              pick_qty: 0,
              _daySet: new Set(),
              _locationSet: new Set(),
              _aisleSet: new Set()
            };
            skuEntry.pick_count += Number(skuRow?.pick_count || 0);
            skuEntry.pick_qty += safeNumber(skuRow?.pick_qty || 0);
            if (snapshotDate) {
              skuEntry._daySet.add(snapshotDate);
            }
            if (location) {
              skuEntry._locationSet.add(location);
              locationEntry?._skuSet.add(sku);
              levelEntry?._locationSet.add(location);
              binTypeEntry?._locationSet.add(location);
              binSizeEntry?._locationSet.add(location);
            }
            if (aislePrefix) {
              skuEntry._aisleSet.add(aislePrefix);
              aisleEntry?._skuSet.add(sku);
            }
            if (levelText) {
              levelEntry?._skuSet.add(sku);
              binTypeEntry?._levelSet.add(levelText);
              binSizeEntry?._levelSet.add(levelText);
            }
            binTypeEntry?._skuSet.add(sku);
            binSizeEntry?._skuSet.add(sku);
            if (snapshotDate) {
              dayEntry._skuSet.add(sku);
            }
            skuMap.set(sku, skuEntry);

            const skuLevelEntry = skuLevelMap.get(sku) || {
              label: sku,
              sku,
              description: catalogItem?.description || catalogItem?.description_short || "",
              pick_count: 0,
              pick_qty: 0,
              high_level_pick_count: 0,
              high_level_pick_qty: 0,
              low_level_pick_count: 0,
              low_level_pick_qty: 0,
              min_level: levelNum || 0,
              max_level: levelNum || 0,
              _levelSet: new Set(),
              _locationSet: new Set()
            };
            skuLevelEntry.pick_count += Number(skuRow?.pick_count || 0);
            skuLevelEntry.pick_qty += safeNumber(skuRow?.pick_qty || 0);
            if (levelNum > 0) {
              skuLevelEntry.min_level = skuLevelEntry.min_level > 0
                ? Math.min(skuLevelEntry.min_level, levelNum)
                : levelNum;
              skuLevelEntry.max_level = Math.max(skuLevelEntry.max_level || 0, levelNum);
            }
            if (levelText) {
              skuLevelEntry._levelSet.add(levelText);
            }
            if (location) {
              skuLevelEntry._locationSet.add(location);
            }
            if (levelNum >= HIGH_LEVEL_THRESHOLD) {
              skuLevelEntry.high_level_pick_count += Number(skuRow?.pick_count || 0);
              skuLevelEntry.high_level_pick_qty += safeNumber(skuRow?.pick_qty || 0);
            } else {
              skuLevelEntry.low_level_pick_count += Number(skuRow?.pick_count || 0);
              skuLevelEntry.low_level_pick_qty += safeNumber(skuRow?.pick_qty || 0);
            }
            skuLevelMap.set(sku, skuLevelEntry);

            if (binType === "Pick" && warehouseProfile?.sku && warehouseProfile.sku === sku) {
              const replenishmentKey = `${location}::${sku}`;
              const replenishmentEntry = replenishmentMap.get(replenishmentKey) || {
                label: `${location} ${sku}`,
                location,
                sku,
                description: catalogItem?.description || catalogItem?.description_short || "",
                aisle_prefix: aislePrefix,
                level: levelText,
                slot: slotText,
                bin_size: binSize,
                max_bin_qty: maxBinQty,
                current_bin_qty: safeNumber(warehouseProfile?.bin_qty || 0),
                pick_count: 0,
                pick_qty: 0,
                _daySet: new Set()
              };
              replenishmentEntry.pick_count += Number(skuRow?.pick_count || 0);
              replenishmentEntry.pick_qty += safeNumber(skuRow?.pick_qty || 0);
              if (snapshotDate) {
                replenishmentEntry._daySet.add(snapshotDate);
              }
              replenishmentMap.set(replenishmentKey, replenishmentEntry);
            }
          }
        }

        dailyMap.set(snapshotDate, dayEntry);
      }
    }

    const dailyBreakdown = Array.from(dailyMap.values())
      .map((entry) => ({
        date: entry.date,
        pick_count: entry.pick_count,
        pick_qty: entry.pick_qty,
        location_count: entry._locationSet.size,
        aisle_count: entry._aisleSet.size,
        sku_count: entry._skuSet.size,
        avg_qty_per_pick: entry.pick_count ? entry.pick_qty / entry.pick_count : 0
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const topSkus = Array.from(skuMap.values()).map((entry) => ({
      sku: entry.sku,
      label: entry.label,
      description: entry.description,
      pick_count: entry.pick_count,
      pick_qty: entry.pick_qty,
      day_count: entry._daySet.size,
      location_count: entry._locationSet.size,
      aisle_count: entry._aisleSet.size,
      avg_qty_per_pick: entry.pick_count ? entry.pick_qty / entry.pick_count : 0,
      share_of_picks: totalPickCount ? (entry.pick_count / totalPickCount) * 100 : 0
    }));

    const topLocations = Array.from(locationMap.values()).map((entry) => ({
      location: entry.location,
      label: entry.label,
      aisle_prefix: entry.aisle_prefix,
      bay: entry.bay,
      level: entry.level,
      slot: entry.slot,
      pick_count: entry.pick_count,
      pick_qty: entry.pick_qty,
      day_count: entry._daySet.size,
      sku_count: entry._skuSet.size,
      avg_qty_per_pick: entry.pick_count ? entry.pick_qty / entry.pick_count : 0
    }));

    const topAisles = Array.from(aisleMap.values()).map((entry) => ({
      aisle_prefix: entry.aisle_prefix,
      label: entry.label,
      pick_count: entry.pick_count,
      pick_qty: entry.pick_qty,
      day_count: entry._daySet.size,
      location_count: entry._locationSet.size,
      sku_count: entry._skuSet.size,
      avg_qty_per_pick: entry.pick_count ? entry.pick_qty / entry.pick_count : 0
    }));

    const levelBreakdown = Array.from(levelMap.values())
      .map((entry) => ({
        level: entry.level,
        label: entry.label,
        level_number: entry.level_number,
        pick_count: entry.pick_count,
        pick_qty: entry.pick_qty,
        day_count: entry._daySet.size,
        location_count: entry._locationSet.size,
        sku_count: entry._skuSet.size,
        pick_bin_pick_count: entry.pick_bin_pick_count,
        bulk_bin_pick_count: entry.bulk_bin_pick_count,
        unknown_bin_type_pick_count: entry.unknown_bin_type_pick_count,
        avg_qty_per_pick: entry.pick_count ? entry.pick_qty / entry.pick_count : 0,
        share_of_picks: totalPickCount ? (entry.pick_count / totalPickCount) * 100 : 0
      }))
      .sort((a, b) => {
        const aNumber = Number(a.level_number || 0);
        const bNumber = Number(b.level_number || 0);
        if (aNumber && bNumber) {
          return aNumber - bNumber;
        }
        if (aNumber) return -1;
        if (bNumber) return 1;
        return String(a.level || "").localeCompare(String(b.level || ""));
      });

    const binTypeBreakdown = Array.from(binTypeMap.values())
      .map((entry) => ({
        bin_type: entry.bin_type,
        label: entry.label,
        pick_count: entry.pick_count,
        pick_qty: entry.pick_qty,
        day_count: entry._daySet.size,
        location_count: entry._locationSet.size,
        sku_count: entry._skuSet.size,
        level_count: entry._levelSet.size,
        avg_qty_per_pick: entry.pick_count ? entry.pick_qty / entry.pick_count : 0,
        share_of_picks: totalPickCount ? (entry.pick_count / totalPickCount) * 100 : 0
      }))
      .sort((a, b) => {
        const order = { Pick: 0, Bulk: 1, Unknown: 2 };
        const orderDiff = (order[a.bin_type] ?? 99) - (order[b.bin_type] ?? 99);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        const metricDiff = rankBy === "pick_qty"
          ? safeNumber(b.pick_qty || 0) - safeNumber(a.pick_qty || 0)
          : Number(b.pick_count || 0) - Number(a.pick_count || 0);
        if (metricDiff !== 0) {
          return metricDiff;
        }
        return String(a.bin_type || "").localeCompare(String(b.bin_type || ""));
      });

    const binSizeBreakdown = sortPickReportRows(
      Array.from(binSizeMap.values()).map((entry) => ({
        bin_size: entry.bin_size,
        label: entry.label,
        pick_count: entry.pick_count,
        pick_qty: entry.pick_qty,
        day_count: entry._daySet.size,
        location_count: entry._locationSet.size,
        sku_count: entry._skuSet.size,
        level_count: entry._levelSet.size,
        avg_qty_per_pick: entry.pick_count ? entry.pick_qty / entry.pick_count : 0,
        share_of_picks: totalPickCount ? (entry.pick_count / totalPickCount) * 100 : 0
      })),
      rankBy,
      "bin_size"
    );

    const highLevelSkus = Array.from(skuLevelMap.values())
      .map((entry) => ({
        sku: entry.sku,
        label: entry.label,
        description: entry.description,
        pick_count: entry.pick_count,
        pick_qty: entry.pick_qty,
        high_level_pick_count: entry.high_level_pick_count,
        high_level_pick_qty: entry.high_level_pick_qty,
        low_level_pick_count: entry.low_level_pick_count,
        low_level_pick_qty: entry.low_level_pick_qty,
        location_count: entry._locationSet.size,
        level_count: entry._levelSet.size,
        lowest_level: entry.min_level || 0,
        highest_level: entry.max_level || 0,
        levels_seen: Array.from(entry._levelSet).sort((a, b) => levelNumber(a) - levelNumber(b)).join(", "),
        high_level_share_of_sku_picks: entry.pick_count ? (entry.high_level_pick_count / entry.pick_count) * 100 : 0
      }))
      .filter((entry) => entry.high_level_pick_count > 0 || entry.high_level_pick_qty > 0)
      .sort((a, b) => {
        const primaryDiff = rankBy === "pick_qty"
          ? b.high_level_pick_qty - a.high_level_pick_qty
          : b.high_level_pick_count - a.high_level_pick_count;
        if (primaryDiff !== 0) {
          return primaryDiff;
        }
        return (
          Number(b.pick_count || 0) - Number(a.pick_count || 0) ||
          safeNumber(b.pick_qty || 0) - safeNumber(a.pick_qty || 0) ||
          String(a.sku || "").localeCompare(String(b.sku || ""))
        );
      })
      .slice(0, limit);

    const replenishmentLocations = Array.from(replenishmentMap.values())
      .map((entry) => ({
        location: entry.location,
        label: entry.label,
        sku: entry.sku,
        description: entry.description,
        aisle_prefix: entry.aisle_prefix,
        level: entry.level,
        slot: entry.slot,
        bin_size: entry.bin_size,
        max_bin_qty: entry.max_bin_qty,
        current_bin_qty: entry.current_bin_qty,
        pick_count: entry.pick_count,
        pick_qty: entry.pick_qty,
        day_count: entry._daySet.size,
        avg_qty_per_pick: entry.pick_count ? entry.pick_qty / entry.pick_count : 0,
        estimated_replenishments: estimateReplenishments(entry.pick_qty, entry.max_bin_qty)
      }))
      .filter((entry) => entry.pick_count > 0 || entry.pick_qty > 0)
      .sort((a, b) => (
        Number(b.estimated_replenishments || 0) - Number(a.estimated_replenishments || 0) ||
        (rankBy === "pick_qty" ? safeNumber(b.pick_qty || 0) - safeNumber(a.pick_qty || 0) : Number(b.pick_count || 0) - Number(a.pick_count || 0)) ||
        String(a.location || "").localeCompare(String(b.location || "")) ||
        String(a.sku || "").localeCompare(String(b.sku || ""))
      ));

    const loadedDayCount = dailyBreakdown.length;
    const peakDay = sortPickReportRows(dailyBreakdown, rankBy, "date")[0] || null;
    const replenishmentWithMax = replenishmentLocations.filter((entry) => safeNumber(entry.max_bin_qty || 0) > 0);
    const replenishmentMissingMax = replenishmentLocations.filter((entry) => safeNumber(entry.max_bin_qty || 0) <= 0);
    const estimatedReplenishmentCount = replenishmentWithMax.reduce(
      (sum, entry) => sum + Number(entry.estimated_replenishments || 0),
      0
    );

    return {
      meta: {
        client_code: targetClient,
        report_type: "picking",
        sort_metric: rankBy,
        limit,
        available_pick_dates: range.availableDates,
        pick_loaded_dates: pickLoadedDates,
        pick_range_mode: range.mode,
        pick_requested_start_date: range.resolvedStartDate,
        pick_requested_end_date: range.resolvedEndDate,
        pick_requested_day_count: range.requestedDates.length,
        pick_available_day_count: range.matchedDates.length,
        pick_missing_dates: range.missingDates,
        latest_pick_snapshot_date: range.latestAvailableDate,
        warehouse_snapshot_date: warehouseState?.meta?.snapshot_date || "",
        item_catalog_meta: catalogState?.meta || this.snapshotMeta(null, "none"),
        high_level_threshold: HIGH_LEVEL_THRESHOLD,
        sku_detail_source: "Published snapshot SKU detail",
        sku_detail_note: "SKU rankings are aggregated from the SKU detail stored inside each published pick snapshot.",
        structure_note: "Pick/bulk uses BLBKPK (B/P), bin size uses BLSCOD, and replenishment estimates use BLMAXQ when that field exists in the warehouse snapshot.",
        replenishment_note: "Replenishment estimates are based on current pick-bin locations where the current warehouse SKU still matches the picked SKU and Max. Bin Qty is available."
      },
      summary: {
        loaded_day_count: loadedDayCount,
        total_pick_count: totalPickCount,
        total_pick_qty: totalPickQty,
        active_sku_count: topSkus.length,
        active_location_count: topLocations.length,
        active_aisle_count: topAisles.length,
        active_level_count: levelBreakdown.length,
        active_bin_size_count: binSizeBreakdown.filter((entry) => entry.bin_size && entry.bin_size !== "Unknown").length,
        avg_qty_per_pick: totalPickCount ? totalPickQty / totalPickCount : 0,
        avg_picks_per_day: loadedDayCount ? totalPickCount / loadedDayCount : 0,
        avg_qty_per_day: loadedDayCount ? totalPickQty / loadedDayCount : 0,
        avg_picks_per_active_sku: topSkus.length ? totalPickCount / topSkus.length : 0,
        avg_picks_per_active_location: topLocations.length ? totalPickCount / topLocations.length : 0,
        peak_day_date: peakDay?.date || "",
        peak_day_pick_count: Number(peakDay?.pick_count || 0),
        peak_day_pick_qty: safeNumber(peakDay?.pick_qty || 0),
        pick_bin_pick_count: pickBinPickCount,
        pick_bin_pick_qty: pickBinPickQty,
        bulk_bin_pick_count: bulkBinPickCount,
        bulk_bin_pick_qty: bulkBinPickQty,
        unknown_bin_type_pick_count: unknownBinTypePickCount,
        unknown_bin_type_pick_qty: unknownBinTypePickQty,
        high_level_pick_count: highLevelPickCount,
        high_level_pick_qty: highLevelPickQty,
        high_level_share_of_picks: totalPickCount ? (highLevelPickCount / totalPickCount) * 100 : 0,
        estimated_replenishment_count: estimatedReplenishmentCount,
        replenishment_location_count: replenishmentLocations.length,
        replenishment_locations_with_max: replenishmentWithMax.length,
        replenishment_locations_missing_max: replenishmentMissingMax.length
      },
      top_skus: sortPickReportRows(topSkus, rankBy, "sku").slice(0, limit),
      top_locations: sortPickReportRows(topLocations, rankBy, "location").slice(0, 25),
      top_aisles: sortPickReportRows(topAisles, rankBy, "aisle_prefix").slice(0, 20),
      sku_outliers: buildOutlierRows(topSkus, rankBy, 16),
      location_outliers: buildOutlierRows(topLocations, rankBy, 16),
      daily_breakdown: dailyBreakdown,
      level_breakdown: levelBreakdown,
      bin_type_breakdown: binTypeBreakdown,
      bin_size_breakdown: binSizeBreakdown,
      high_level_skus: highLevelSkus,
      replenishment: {
        summary: {
          estimated_replenishment_count: estimatedReplenishmentCount,
          location_count: replenishmentLocations.length,
          locations_with_max: replenishmentWithMax.length,
          locations_missing_max: replenishmentMissingMax.length
        },
        locations: replenishmentLocations.slice(0, 50)
      }
    };
  }

  async exportPickingReportsWorkbook(clientCode = DEFAULT_CLIENT_CODE, options = {}) {
    const reports = await this.getPickingReports(clientCode, options);
    const workbook = new ExcelJS.Workbook();
    const meta = reports?.meta || {};
    const summary = reports?.summary || {};
    const requestedStart = String(meta.pick_requested_start_date || meta.latest_pick_snapshot_date || "no-start").trim() || "no-start";
    const requestedEnd = String(meta.pick_requested_end_date || requestedStart || "no-end").trim() || "no-end";
    const sortMetric = String(meta.sort_metric || "pick_count").trim() || "pick_count";
    const missingDates = Array.isArray(meta.pick_missing_dates) ? meta.pick_missing_dates.filter(Boolean) : [];
    const loadedDates = Array.isArray(meta.pick_loaded_dates) ? meta.pick_loaded_dates.filter(Boolean) : [];
    const availableDates = Array.isArray(meta.available_pick_dates) ? meta.available_pick_dates.filter(Boolean) : [];

    workbook.creator = this.config.appName || "ItemTracker";
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.subject = "Picking reports export";
    workbook.title = "Picking reports";
    workbook.company = this.config.appName || "ItemTracker";

    addWorksheetTable(
      workbook,
      "Metrics",
      [
        { header: "Metric", key: "metric", width: 30 },
        { header: "Value", key: "value", width: 22, minWidth: 16 }
      ],
      [
        { metric: "Client code", value: meta.client_code || "" },
        { metric: "Loaded day count", value: Number(summary.loaded_day_count || 0) },
        { metric: "Total picks", value: Number(summary.total_pick_count || 0) },
        { metric: "Total quantity", value: safeNumber(summary.total_pick_qty || 0) },
        { metric: "Active SKUs", value: Number(summary.active_sku_count || 0) },
        { metric: "Active locations", value: Number(summary.active_location_count || 0) },
        { metric: "Active aisles", value: Number(summary.active_aisle_count || 0) },
        { metric: "Average qty per pick", value: safeNumber(summary.avg_qty_per_pick || 0) },
        { metric: "Average picks per day", value: safeNumber(summary.avg_picks_per_day || 0) },
        { metric: "Average qty per day", value: safeNumber(summary.avg_qty_per_day || 0) },
        { metric: "Average picks per active SKU", value: safeNumber(summary.avg_picks_per_active_sku || 0) },
        { metric: "Average picks per active location", value: safeNumber(summary.avg_picks_per_active_location || 0) },
        { metric: "Peak day", value: summary.peak_day_date || "" },
        { metric: "Peak day pick count", value: Number(summary.peak_day_pick_count || 0) },
        { metric: "Peak day pick quantity", value: safeNumber(summary.peak_day_pick_qty || 0) },
        { metric: "Picks from pick bins", value: Number(summary.pick_bin_pick_count || 0) },
        { metric: "Quantity from pick bins", value: safeNumber(summary.pick_bin_pick_qty || 0) },
        { metric: "Picks from bulk bins", value: Number(summary.bulk_bin_pick_count || 0) },
        { metric: "Quantity from bulk bins", value: safeNumber(summary.bulk_bin_pick_qty || 0) },
        { metric: `Picks from level ${meta.high_level_threshold || HIGH_LEVEL_THRESHOLD}+`, value: Number(summary.high_level_pick_count || 0) },
        { metric: `Quantity from level ${meta.high_level_threshold || HIGH_LEVEL_THRESHOLD}+`, value: safeNumber(summary.high_level_pick_qty || 0) },
        { metric: "Estimated replenishments", value: Number(summary.estimated_replenishment_count || 0) },
        { metric: "Replenishment locations", value: Number(summary.replenishment_location_count || 0) }
      ]
    );

    addWorksheetTable(
      workbook,
      "Coverage",
      [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 40, maxWidth: 80 }
      ],
      [
        { metric: "Report type", value: meta.report_type || "picking" },
        { metric: "Sort metric", value: sortMetric },
        { metric: "Top SKU limit", value: Number(meta.limit || 0) },
        { metric: "Range mode", value: meta.pick_range_mode || "" },
        { metric: "Requested start date", value: meta.pick_requested_start_date || "" },
        { metric: "Requested end date", value: meta.pick_requested_end_date || "" },
        { metric: "Requested day count", value: Number(meta.pick_requested_day_count || 0) },
        { metric: "Loaded day count", value: Number(meta.pick_available_day_count || 0) },
        { metric: "Latest available snapshot", value: meta.latest_pick_snapshot_date || "" },
        { metric: "Warehouse snapshot date", value: meta.warehouse_snapshot_date || "" },
        { metric: "Missing day count", value: missingDates.length },
        { metric: "Missing days", value: missingDates.join(", ") || "None" },
        { metric: "Loaded dates", value: loadedDates.join(", ") || "None" },
        { metric: "Available dates", value: availableDates.join(", ") || "None" },
        { metric: "High-level threshold", value: Number(meta.high_level_threshold || HIGH_LEVEL_THRESHOLD) },
        { metric: "SKU detail source", value: meta.sku_detail_source || "" },
        { metric: "SKU detail note", value: meta.sku_detail_note || "" },
        { metric: "Structure note", value: meta.structure_note || "" },
        { metric: "Replenishment note", value: meta.replenishment_note || "" },
        { metric: "Item catalog snapshot date", value: meta.item_catalog_meta?.snapshot_date || "" },
        { metric: "Item catalog uploaded at", value: meta.item_catalog_meta?.uploaded_at || "" }
      ]
    );

    addWorksheetTable(
      workbook,
      "Level Breakdown",
      [
        { header: "Level", key: "level", width: 12 },
        { header: "Pick count", key: "pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Pick quantity", key: "pick_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Day count", key: "day_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Location count", key: "location_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "SKU count", key: "sku_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Pick-bin picks", key: "pick_bin_pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Bulk-bin picks", key: "bulk_bin_pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Unknown-type picks", key: "unknown_bin_type_pick_count", width: 16, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Avg qty per pick", key: "avg_qty_per_pick", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Share of picks (%)", key: "share_of_picks", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.0" }
      ],
      reports?.level_breakdown || [],
      "No level activity matches the selected range."
    );

    addWorksheetTable(
      workbook,
      "Bin Types",
      [
        { header: "Bin type", key: "bin_type", width: 14 },
        { header: "Pick count", key: "pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Pick quantity", key: "pick_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Day count", key: "day_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Location count", key: "location_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "SKU count", key: "sku_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Level count", key: "level_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Avg qty per pick", key: "avg_qty_per_pick", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Share of picks (%)", key: "share_of_picks", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.0" }
      ],
      reports?.bin_type_breakdown || [],
      "No pick-vs-bulk activity matches the selected range."
    );

    addWorksheetTable(
      workbook,
      "Bin Sizes",
      [
        { header: "Bin size", key: "bin_size", width: 14 },
        { header: "Pick count", key: "pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Pick quantity", key: "pick_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Day count", key: "day_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Location count", key: "location_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "SKU count", key: "sku_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Level count", key: "level_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Avg qty per pick", key: "avg_qty_per_pick", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Share of picks (%)", key: "share_of_picks", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.0" }
      ],
      reports?.bin_size_breakdown || [],
      "No bin-size activity matches the selected range."
    );

    addWorksheetTable(
      workbook,
      "Level 10+ SKUs",
      [
        { header: "Rank", key: "rank", width: 10, value: (_row, index) => index + 1, alignment: { horizontal: "right", vertical: "top" } },
        { header: "SKU", key: "sku", width: 18 },
        { header: "Description", key: "description", width: 36, maxWidth: 60 },
        { header: "All picks", key: "pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "All quantity", key: "pick_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: `Level ${meta.high_level_threshold || HIGH_LEVEL_THRESHOLD}+ picks`, key: "high_level_pick_count", width: 18, alignment: { horizontal: "right", vertical: "top" } },
        { header: `Level ${meta.high_level_threshold || HIGH_LEVEL_THRESHOLD}+ qty`, key: "high_level_pick_qty", width: 18, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Lower-level picks", key: "low_level_pick_count", width: 16, alignment: { horizontal: "right", vertical: "top" } },
        { header: "High-level share (%)", key: "high_level_share_of_sku_picks", width: 18, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.0" },
        { header: "Lowest level", key: "lowest_level", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Highest level", key: "highest_level", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Location count", key: "location_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Levels seen", key: "levels_seen", width: 22, maxWidth: 36 }
      ],
      reports?.high_level_skus || [],
      `No SKU activity was found on level ${meta.high_level_threshold || HIGH_LEVEL_THRESHOLD}+ for the selected range.`
    );

    addWorksheetTable(
      workbook,
      "Replenishment",
      [
        { header: "Rank", key: "rank", width: 10, value: (_row, index) => index + 1, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Location", key: "location", width: 18 },
        { header: "SKU", key: "sku", width: 18 },
        { header: "Description", key: "description", width: 32, maxWidth: 56 },
        { header: "Aisle", key: "aisle_prefix", width: 10 },
        { header: "Level", key: "level", width: 10 },
        { header: "Slot", key: "slot", width: 10 },
        { header: "Bin size", key: "bin_size", width: 12 },
        { header: "Max bin qty", key: "max_bin_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Current bin qty", key: "current_bin_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Pick count", key: "pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Pick quantity", key: "pick_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Day count", key: "day_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Avg qty per pick", key: "avg_qty_per_pick", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Estimated replenishments", key: "estimated_replenishments", width: 20, alignment: { horizontal: "right", vertical: "top" } }
      ],
      reports?.replenishment?.locations || [],
      "No replenishment estimate rows are available for the selected range."
    );

    addWorksheetTable(
      workbook,
      "Top SKUs",
      [
        { header: "Rank", key: "rank", width: 10, value: (_row, index) => index + 1, alignment: { horizontal: "right", vertical: "top" } },
        { header: "SKU", key: "sku", width: 18 },
        { header: "Description", key: "description", width: 36, maxWidth: 60 },
        { header: "Pick count", key: "pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Pick quantity", key: "pick_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Day count", key: "day_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Location count", key: "location_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Aisle count", key: "aisle_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Avg qty per pick", key: "avg_qty_per_pick", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Share of picks (%)", key: "share_of_picks", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.0" }
      ],
      reports?.top_skus || [],
      "No SKU activity matches the selected range."
    );

    addWorksheetTable(
      workbook,
      "SKU Outliers",
      [
        { header: "Rank", key: "rank", width: 10, value: (_row, index) => index + 1, alignment: { horizontal: "right", vertical: "top" } },
        { header: "SKU", key: "sku", width: 18 },
        { header: "Description", key: "description", width: 36, maxWidth: 60 },
        { header: "Pick count", key: "pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Pick quantity", key: "pick_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Day count", key: "day_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Location count", key: "location_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Aisle count", key: "aisle_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Avg qty per pick", key: "avg_qty_per_pick", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Outlier score", key: "outlier_score", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Outlier threshold", key: "outlier_threshold", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" }
      ],
      reports?.sku_outliers || [],
      "No SKU outliers were found for the selected range."
    );

    addWorksheetTable(
      workbook,
      "Location Outliers",
      [
        { header: "Rank", key: "rank", width: 10, value: (_row, index) => index + 1, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Location", key: "location", width: 18 },
        { header: "Aisle", key: "aisle_prefix", width: 10 },
        { header: "Bay", key: "bay", width: 10 },
        { header: "Level", key: "level", width: 10 },
        { header: "Slot", key: "slot", width: 10 },
        { header: "Pick count", key: "pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Pick quantity", key: "pick_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Day count", key: "day_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "SKU count", key: "sku_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Avg qty per pick", key: "avg_qty_per_pick", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Outlier score", key: "outlier_score", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Outlier threshold", key: "outlier_threshold", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" }
      ],
      reports?.location_outliers || [],
      "No location outliers were found for the selected range."
    );

    addWorksheetTable(
      workbook,
      "Top Locations",
      [
        { header: "Rank", key: "rank", width: 10, value: (_row, index) => index + 1, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Location", key: "location", width: 18 },
        { header: "Aisle", key: "aisle_prefix", width: 10 },
        { header: "Bay", key: "bay", width: 10 },
        { header: "Level", key: "level", width: 10 },
        { header: "Slot", key: "slot", width: 10 },
        { header: "Pick count", key: "pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Pick quantity", key: "pick_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Day count", key: "day_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "SKU count", key: "sku_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Avg qty per pick", key: "avg_qty_per_pick", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" }
      ],
      reports?.top_locations || [],
      "No location activity matches the selected range."
    );

    addWorksheetTable(
      workbook,
      "Top Aisles",
      [
        { header: "Rank", key: "rank", width: 10, value: (_row, index) => index + 1, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Aisle", key: "aisle_prefix", width: 12 },
        { header: "Pick count", key: "pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Pick quantity", key: "pick_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Day count", key: "day_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Location count", key: "location_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "SKU count", key: "sku_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Avg qty per pick", key: "avg_qty_per_pick", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" }
      ],
      reports?.top_aisles || [],
      "No aisle activity matches the selected range."
    );

    addWorksheetTable(
      workbook,
      "Daily Breakdown",
      [
        { header: "Date", key: "date", width: 14 },
        { header: "Pick count", key: "pick_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Pick quantity", key: "pick_qty", width: 14, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" },
        { header: "Location count", key: "location_count", width: 14, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Aisle count", key: "aisle_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "SKU count", key: "sku_count", width: 12, alignment: { horizontal: "right", vertical: "top" } },
        { header: "Avg qty per pick", key: "avg_qty_per_pick", width: 16, alignment: { horizontal: "right", vertical: "top" }, numFmt: "0.00" }
      ],
      reports?.daily_breakdown || [],
      "No daily snapshot rows are available for the selected range."
    );

    const filename = safeFilename(
      `picking-reports-${requestedStart}-to-${requestedEnd}-${sortMetric}.xlsx`,
      "picking-reports.xlsx"
    );

    return {
      filename,
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      reports
    };
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

  async getSkuDetail(sku, clientCode = DEFAULT_CLIENT_CODE) {
    const normalizedSku = normalizeSku(sku);
    if (!normalizedSku) return null;

    const { snapshot, meta } = await this.loadSnapshot(clientCode);
    if (!snapshot) return null;

    try {
      const barcodeState = await this.loadBarcodeSnapshot(clientCode);
      this.applyBarcodeSnapshot(snapshot, barcodeState.snapshot);
    } catch (_) {}

    const item = (snapshot.items || []).find((i) => normalizeSku(i?.sku) === normalizedSku);
    if (!item) return null;

    const imageState = await this.loadImageIndex(clientCode);
    const rawImages = (imageState.imageMap || new Map()).get(normalizedSku) || [];

    // Tag images that have a pending deletion request
    let pendingDeletionIds = new Set();
    try {
      const pendingReqs = await this.pb.listAllRecords(DELETION_REQUESTS_COLLECTION, {
        filterExpr: `sku=${pbFilterLiteral(normalizedSku)} && status=${pbFilterLiteral("pending")}`,
        sort: "-requested_at",
        perPage: 200
      });
      pendingDeletionIds = new Set((pendingReqs || []).map((r) => r.image_id).filter(Boolean));
    } catch (_) {}

    const images = rawImages.map((img) => ({
      ...img,
      pending_deletion: pendingDeletionIds.has(img.id)
    }));

    let warehouseActive = false;
    const binLocations = [];
    try {
      const warehouseState = await this.loadWarehouseSnapshot();
      const skuSet = this.buildWarehouseSkuSet(warehouseState.snapshot, clientCode);
      warehouseActive = skuSet.has(normalizedSku);
      const targetClient = String(clientCode || DEFAULT_CLIENT_CODE).trim().toUpperCase();
      for (const row of warehouseState.snapshot?.rows || []) {
        const rowSku = normalizeSku(row?.BLITEM || row?.["Item SKU"] || row?.sku);
        if (rowSku !== normalizedSku) continue;
        const client = String(row?.BLCCOD || row?.Client || row?.client_code || "").trim().toUpperCase();
        if (targetClient && client && client !== targetClient) continue;
        const loc = String(row?.BLBINL || row?.["Bin Location"] || row?.bin_location || "").trim().toUpperCase();
        if (!loc) continue;
        const status = String(row?.BLSTS || "").trim().toUpperCase();
        if (status && status !== "Y") continue;
        const qty = row?.BLQTY !== undefined && row?.BLQTY !== null ? String(row.BLQTY) : null;
        binLocations.push({ location: loc, qty });
      }
    } catch (_) {}

    const barcodes = mergeBarcodeValues(item?.barcode, item?.barcodes || []);
    return {
      sku: normalizedSku,
      description: item.description || item.description_short || "",
      description_short: item.description_short || "",
      barcode: barcodes[0] || "",
      barcodes,
      size: item.size || "",
      color: item.color || "",
      active: item.active !== false,
      images,
      image_count: images.length,
      has_images: images.length > 0,
      warehouse_active: warehouseActive,
      bin_locations: binLocations,
      catalog_meta: meta
    };
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

  // ── Admin methods ────────────────────────────────────────────────────────

  async listUsers() {
    const response = await this.pb.listAllRecords(USERS_COLLECTION, { sort: "email" });
    return (response || []).map((record) => this.serializeUser(record));
  }

  logActivity(user, action, detail = {}, ip = "") {
    // Fire-and-forget — never let logging block or break a request
    this.pb.createRecord(ACTIVITY_LOG_COLLECTION, {
      user_id: user?.id || "",
      user_email: user?.email || "",
      user_name: user?.name || "",
      action: String(action || ""),
      detail,
      ip_address: String(ip || "").slice(0, 64)
    }).catch(() => {});
  }

  async getActivityLog(limit = 200) {
    try {
      const response = await this.pb.listRecords(ACTIVITY_LOG_COLLECTION, {
        sort: "-created",
        page: 1,
        perPage: Math.min(500, limit)
      });
      return (response.items || []).map((r) => ({
        id: r.id,
        user_id: r.user_id || "",
        user_email: r.user_email || "",
        user_name: r.user_name || "",
        action: r.action || "",
        detail: r.detail || {},
        ip_address: r.ip_address || "",
        created: r.created || ""
      }));
    } catch (error) {
      if (isMissingCollectionError(error)) {
        return [];
      }
      throw error;
    }
  }

  async resetUserPassword(userId, newPassword) {
    if (!userId || !newPassword || newPassword.length < 8) {
      throw new PocketBaseError("Password must be at least 8 characters.", 400);
    }
    await this.pb.updateRecord(USERS_COLLECTION, userId, {
      password: newPassword,
      passwordConfirm: newPassword
    });
  }

  // ── Notes ────────────────────────────────────────────────────────────────

  async getSkuNotes(sku, clientCode = DEFAULT_CLIENT_CODE) {
    const normalizedSku = normalizeSku(sku);
    if (!normalizedSku) return null;
    const response = await this.pb.listRecords(NOTES_COLLECTION, {
      filterExpr: `sku=${pbFilterLiteral(normalizedSku)} && client_code=${pbFilterLiteral(clientCode)}`,
      sort: "-updated_at",
      page: 1,
      perPage: 1
    });
    const record = response.items?.[0] || null;
    if (!record) return null;
    return {
      id: record.id,
      notes: record.notes || "",
      updated_at: record.updated_at || "",
      updated_by_email: record.updated_by_email || "",
      updated_by_name: record.updated_by_name || ""
    };
  }

  async saveSkuNotes(sku, notes, user, clientCode = DEFAULT_CLIENT_CODE) {
    const normalizedSku = normalizeSku(sku);
    if (!normalizedSku) throw new PocketBaseError("SKU is required.", 400);
    const updatedAt = new Date().toISOString();
    const payload = {
      client_code: clientCode,
      sku: normalizedSku,
      notes: String(notes || "").slice(0, 10000),
      updated_at: updatedAt,
      updated_by_user_id: user?.id || "",
      updated_by_email: user?.email || "",
      updated_by_name: user?.name || ""
    };
    // Check for existing record
    const response = await this.pb.listRecords(NOTES_COLLECTION, {
      filterExpr: `sku=${pbFilterLiteral(normalizedSku)} && client_code=${pbFilterLiteral(clientCode)}`,
      page: 1,
      perPage: 1
    });
    const existing = response.items?.[0] || null;
    if (existing) {
      await this.pb.updateRecord(NOTES_COLLECTION, existing.id, payload);
    } else {
      await this.pb.createRecord(NOTES_COLLECTION, payload);
    }
    return { notes: payload.notes, updated_at: updatedAt, updated_by_name: user?.name || "", updated_by_email: user?.email || "" };
  }

  // ── Deletion requests ─────────────────────────────────────────────────────

  async requestImageDeletion(imageId, sku, imageUrl, imageCaption, user, clientCode = DEFAULT_CLIENT_CODE) {
    if (!imageId) throw new PocketBaseError("Image ID is required.", 400);
    // Check no existing pending request for this image
    const existing = await this.pb.listRecords(DELETION_REQUESTS_COLLECTION, {
      filterExpr: `image_id=${pbFilterLiteral(imageId)} && status=${pbFilterLiteral("pending")}`,
      page: 1,
      perPage: 1
    });
    if (existing.items?.length) {
      throw new PocketBaseError("A deletion request for this photo is already pending.", 400);
    }
    await this.pb.createRecord(DELETION_REQUESTS_COLLECTION, {
      client_code: clientCode,
      sku: normalizeSku(sku) || String(sku || ""),
      image_id: imageId,
      image_url: String(imageUrl || "").slice(0, 1000),
      image_caption: String(imageCaption || "").slice(0, 1000),
      status: "pending",
      requested_at: new Date().toISOString(),
      requested_by_user_id: user?.id || "",
      requested_by_email: user?.email || "",
      requested_by_name: user?.name || ""
    });
  }

  async getDeletionQueue(clientCode = DEFAULT_CLIENT_CODE) {
    try {
      const response = await this.pb.listRecords(DELETION_REQUESTS_COLLECTION, {
        filterExpr: `status=${pbFilterLiteral("pending")}`,
        sort: "-requested_at",
        page: 1,
        perPage: 200
      });
      return (response.items || []).map((r) => ({
        id: r.id,
        sku: r.sku || "",
        image_id: r.image_id || "",
        image_url: r.image_url || "",
        image_caption: r.image_caption || "",
        status: r.status || "pending",
        requested_at: r.requested_at || "",
        requested_by_email: r.requested_by_email || "",
        requested_by_name: r.requested_by_name || ""
      }));
    } catch (error) {
      if (isMissingCollectionError(error)) {
        return [];
      }
      throw error;
    }
  }

  async approveDeletion(requestId, adminUser, clientCode = DEFAULT_CLIENT_CODE) {
    const request = await this.pb.getRecord(DELETION_REQUESTS_COLLECTION, requestId);
    if (!request) throw new PocketBaseError("Deletion request not found.", 404);
    if (request.status !== "pending") throw new PocketBaseError("This request is no longer pending.", 400);
    // Delete the actual image record
    try {
      await this.pb.deleteRecord(IMAGE_COLLECTION, request.image_id);
    } catch (err) {
      // If already gone, still mark approved
      if (!(err instanceof PocketBaseError) || err.statusCode !== 404) throw err;
    }
    await this.pb.updateRecord(DELETION_REQUESTS_COLLECTION, requestId, {
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by_user_id: adminUser?.id || "",
      reviewed_by_email: adminUser?.email || ""
    });
    // Bust image cache so the deleted photo disappears immediately
    this.imageCache.delete(String(clientCode || DEFAULT_CLIENT_CODE));
  }

  async rejectDeletion(requestId, adminUser) {
    const request = await this.pb.getRecord(DELETION_REQUESTS_COLLECTION, requestId);
    if (!request) throw new PocketBaseError("Deletion request not found.", 404);
    if (request.status !== "pending") throw new PocketBaseError("This request is no longer pending.", 400);
    await this.pb.updateRecord(DELETION_REQUESTS_COLLECTION, requestId, {
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by_user_id: adminUser?.id || "",
      reviewed_by_email: adminUser?.email || ""
    });
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
