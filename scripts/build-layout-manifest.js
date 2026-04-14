const fs = require("node:fs/promises");
const path = require("node:path");
const ExcelJS = require("exceljs");

function textValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(" ").trim();
  }
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || "").join("").trim();
    }
    if (value.text !== undefined) {
      return String(value.text || "").trim();
    }
    if (value.result !== undefined) {
      return String(value.result || "").trim();
    }
    if (value.hyperlink && value.text) {
      return String(value.text || "").trim();
    }
    return "";
  }
  return String(value).trim();
}

function zoneLabel(firstPrefix = "", fallbackIndex = 0) {
  if (firstPrefix.startsWith("N") || firstPrefix.startsWith("Y")) {
    return "North / Yard";
  }
  if (firstPrefix.startsWith("W") || firstPrefix.startsWith("X")) {
    return "West / Cross";
  }
  return `Zone ${fallbackIndex + 1}`;
}

async function buildManifest(sourcePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const schematic = workbook.getWorksheet("Schematic");
  if (!schematic) {
    throw new Error('Worksheet "Schematic" was not found in the workbook.');
  }

  const zones = [];
  for (let rowIndex = 1; rowIndex < schematic.rowCount; rowIndex += 1) {
    const marker = textValue(schematic.getCell(`B${rowIndex}`).value).toUpperCase();
    const nextMarker = textValue(schematic.getCell(`B${rowIndex + 1}`).value).toUpperCase();
    if (marker !== "BLOCK" || nextMarker !== "AISLE") {
      continue;
    }

    const aisles = [];
    for (let colIndex = 1; colIndex <= schematic.columnCount; colIndex += 1) {
      const block = textValue(schematic.getRow(rowIndex).getCell(colIndex).value).toUpperCase();
      const aisle = textValue(schematic.getRow(rowIndex + 1).getCell(colIndex).value).toUpperCase();
      if (!/^[NWXY]$/.test(block) || !/^[A-Z]$/.test(aisle)) {
        continue;
      }
      const prefix = `${block}${aisle}`;
      aisles.push({
        prefix,
        block,
        aisle,
        workbook_column: colIndex
      });
    }

    if (!aisles.length) {
      continue;
    }

    zones.push({
      zone_key: `zone_${zones.length + 1}`,
      zone_label: zoneLabel(aisles[0].prefix, zones.length),
      header_row: rowIndex,
      aisle_row: rowIndex + 1,
      aisles
    });
  }

  return {
    version: 1,
    source_name: path.basename(sourcePath),
    generated_at: new Date().toISOString(),
    workbook: {
      sheet_names: workbook.worksheets.map((sheet) => sheet.name)
    },
    aisle_order: zones.flatMap((zone) => zone.aisles.map((aisle) => aisle.prefix)),
    zones
  };
}

async function main() {
  const sourcePath =
    process.argv[2] ||
    "C:/Users/Axel/OneDrive - Culina Group Ltd/Documents/F&M Layout V4.7.xlsx";
  const outputPath =
    process.argv[3] ||
    path.join(process.cwd(), "server", "data", "fandm-layout-v4.7.json");

  const manifest = await buildManifest(sourcePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Wrote layout manifest to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
