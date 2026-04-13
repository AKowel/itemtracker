function safeJson(value) {
  return JSON.stringify(value || {});
}

function normalizeSku(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text || ["NONE", "NULL", "0", "00000000"].includes(text)) {
    return "";
  }
  return text;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeFilename(name, fallback = "upload.bin") {
  const raw = String(name || "").trim();
  const base = raw ? raw.split(/[\\/]/).pop() : fallback;
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_");
  return cleaned || fallback;
}

module.exports = {
  cleanText,
  normalizeSku,
  safeFilename,
  safeJson
};
