const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

const config = {
  appName: process.env.APP_NAME || "Item Tracker",
  appBaseUrl: process.env.APP_BASE_URL || "https://cons.axephotography.co.uk",
  host: process.env.HOST || "127.0.0.1",
  port: Number.parseInt(process.env.PORT || "3100", 10),
  pocketbaseUrl: (process.env.POCKETBASE_URL || "").replace(/\/$/, ""),
  pocketbaseAdminEmail: process.env.POCKETBASE_ADMIN_EMAIL || "",
  pocketbaseAdminPassword: process.env.POCKETBASE_ADMIN_PASSWORD || "",
  sessionSecret: process.env.SESSION_SECRET || "change-me-before-production",
  sessionCookieSecure: asBool(process.env.SESSION_COOKIE_SECURE, false),
  sessionCookieSameSite: process.env.SESSION_COOKIE_SAMESITE || "lax",
  trustProxy: asBool(process.env.TRUST_PROXY, true),
  adminEmails: String(process.env.ADMIN_EMAILS || "")
    .split(/[,\n;]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
};

module.exports = { config };
