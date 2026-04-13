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
const DEFAULT_CLIENT_CODE = "FANDMKET";
const MAX_RESULTS = 60;

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

class ItemTrackerService {
  constructor(config) {
    this.config = config;
    this.pb = new PocketBaseClient({
      baseUrl: config.pocketbaseUrl,
      adminEmail: config.pocketbaseAdminEmail,
      adminPassword: config.pocketbaseAdminPassword
    });
    this.snapshotCache = new Map();
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

  scoreItem(item, queryUpper, terms) {
    const sku = String(item.sku || "").toUpperCase();
    const barcode = String(item.barcode || "").toUpperCase();
    const description = String(item.description || "").toUpperCase();
    const searchText = String(item.search_text || "").toUpperCase();

    if (!queryUpper) {
      return 0;
    }
    if (terms.some((term) => !searchText.includes(term))) {
      return 0;
    }

    let score = 0;
    if (sku === queryUpper) score += 12000;
    else if (sku.startsWith(queryUpper)) score += 9000;
    else if (sku.includes(queryUpper)) score += 7000;

    if (barcode) {
      if (barcode === queryUpper) score += 10500;
      else if (barcode.startsWith(queryUpper)) score += 7600;
      else if (barcode.includes(queryUpper)) score += 6100;
    }

    if (description === queryUpper) score += 8600;
    else if (description.startsWith(queryUpper)) score += 5200;
    else if (description.includes(queryUpper)) score += 3600;

    if (item.active) score += 60;
    score += Math.min(900, terms.length * 180);
    return score;
  }

  async searchCatalog(query, clientCode = DEFAULT_CLIENT_CODE, limit = MAX_RESULTS) {
    const { snapshot, meta } = await this.loadSnapshot(clientCode);
    const queryUpper = cleanText(query).toUpperCase();
    if (!snapshot || !queryUpper) {
      return { rows: [], meta };
    }

    const terms = queryUpper.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const item of snapshot.items || []) {
      const score = this.scoreItem(item, queryUpper, terms);
      if (score > 0) {
        scored.push([score, item.sku || "", item]);
      }
    }
    scored.sort((a, b) => (b[0] - a[0]) || String(a[1]).localeCompare(String(b[1])));

    const rows = scored.slice(0, limit).map((entry) => {
      const { search_text: searchText, ...rest } = entry[2];
      return { ...rest };
    });

    const imageMap = await this.listImagesForSkus(rows.map((row) => row.sku), clientCode);
    for (const row of rows) {
      row.images = imageMap.get(row.sku) || [];
      row.image_count = row.images.length;
    }

    return { rows, meta };
  }

  async listImagesForSkus(skus, clientCode = DEFAULT_CLIENT_CODE) {
    const normalized = [...new Set((skus || []).map((sku) => normalizeSku(sku)).filter(Boolean))];
    const imageMap = new Map();
    if (!normalized.length) {
      return imageMap;
    }

    for (let index = 0; index < normalized.length; index += 25) {
      const chunk = normalized.slice(index, index + 25);
      const skuFilter = chunk.map((sku) => `sku=${pbFilterLiteral(sku)}`).join(" || ");
      const response = await this.pb.listRecords(IMAGE_COLLECTION, {
        filterExpr: `client_code=${pbFilterLiteral(clientCode)} && (${skuFilter})`,
        sort: "-uploaded_at",
        page: 1,
        perPage: 200
      });
      for (const row of response.items || []) {
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
            const barcodeRaw = cleanValue(row.ITBARC);
            const barcode = /\d/.test(barcodeRaw) ? barcodeRaw : "";
            const item = {
              sku,
              description,
              description_short: descriptionShort,
              barcode,
              size: cleanValue(row.ITSIZE),
              color: cleanValue(row.ITCOLR),
              active: cleanValue(row.ITACT).toUpperCase() === "Y",
              created_at: cleanValue(row.CREATE_TIMESTAMP),
              changed_at: cleanValue(row.CHANGE_TIMESTAMP),
              search_text: [sku, barcode, description, descriptionShort, cleanValue(row.ITSIZE), cleanValue(row.ITCOLR)]
                .filter(Boolean)
                .join(" ")
                .toUpperCase()
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
