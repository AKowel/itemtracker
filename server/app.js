const path = require("path");
const express = require("express");
const session = require("express-session");
const multer = require("multer");

const { config } = require("./config");
const { safeJson } = require("./helpers");
const { ItemTrackerService, MAX_RESULTS, PocketBaseError } = require("./itemTrackerService");

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function setFlash(req, category, message) {
  req.session.flash = { category, message };
}

function getFlash(req) {
  const flash = req.session.flash || null;
  delete req.session.flash;
  return flash;
}

function cleanSearchFilters(...values) {
  const cleaned = [];
  const seen = new Set();
  for (const value of values) {
    const items = Array.isArray(value) ? value : [value];
    for (const raw of items) {
      const text = String(raw || "").trim();
      const key = text.toUpperCase();
      if (!text || seen.has(key)) {
        continue;
      }
      seen.add(key);
      cleaned.push(text);
    }
  }
  return cleaned;
}

async function createApp() {
  const app = express();
  const service = new ItemTrackerService(config);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  const assetVersion = Date.now().toString(36);

  // ── Session tracking ─────────────────────────────────────────────────────
  // activeSessions: Map<sessionId, { userId, email, name, loginAt, lastSeenAt, ip, userAgent }>
  // invalidatedSessions: Set<sessionId> — sessions to kill on next request
  const activeSessions = new Map();
  const invalidatedSessions = new Set();

  let bootstrapError = "";
  try {
    await service.bootstrap();
  } catch (error) {
    bootstrapError = error.message || "PocketBase bootstrap failed.";
  }

  if (config.trustProxy) {
    app.set("trust proxy", 1);
  }

  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "views"));

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(
    session({
      name: "itemtracker.sid",
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: config.sessionCookieSameSite,
        secure: config.sessionCookieSecure,
        maxAge: 1000 * 60 * 60 * 24 * 14
      }
    })
  );
  app.use("/static", express.static(path.join(process.cwd(), "static")));

  app.get("/sw.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Service-Worker-Allowed", "/");
    res.sendFile(path.join(process.cwd(), "static", "sw.js"));
  });

  app.get("/manifest.json", (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.sendFile(path.join(process.cwd(), "static", "manifest.json"));
  });

  app.locals.assetVersion = assetVersion;
  app.locals.safeJson = safeJson;

  app.use(
    asyncHandler(async (req, res, next) => {
      res.locals.appName = config.appName;
      res.locals.appBaseUrl = config.appBaseUrl;
      res.locals.flash = getFlash(req);
      res.locals.bootstrapError = bootstrapError;
      res.locals.currentUser = null;
      res.locals.assetVersion = assetVersion;

      const sid = req.sessionID;
      const userId = req.session.userId;

      // Honour forced logouts
      if (sid && invalidatedSessions.has(sid)) {
        invalidatedSessions.delete(sid);
        activeSessions.delete(sid);
        req.session.userId = null;
        if (req.path.startsWith("/api/")) {
          return res.status(401).json({ ok: false, error: "You have been signed out by an administrator." });
        }
        setFlash(req, "error", "You have been signed out by an administrator.");
        return res.redirect("/login");
      }

      if (!userId) {
        return next();
      }

      try {
        const user = await service.getUser(userId);
        req.currentUser = user;
        res.locals.currentUser = user;

        // Update active session record
        const existing = activeSessions.get(sid) || {};
        activeSessions.set(sid, {
          sessionId: sid,
          userId: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.isAdmin,
          loginAt: existing.loginAt || new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          ip: req.ip || "",
          userAgent: String(req.headers["user-agent"] || "").slice(0, 160)
        });
      } catch (error) {
        activeSessions.delete(sid);
        req.session.userId = null;
      }

      return next();
    })
  );

  function requireLoginPage(req, res, next) {
    if (!req.currentUser) {
      return res.redirect("/login");
    }
    return next();
  }

  function requireAdminPage(req, res, next) {
    if (!req.currentUser) {
      return res.redirect("/login");
    }
    if (!req.currentUser.isAdmin) {
      setFlash(req, "error", "Admin access required.");
      return res.redirect("/catalogue");
    }
    return next();
  }

  function requireLoginApi(req, res, next) {
    if (!req.currentUser) {
      return res.status(401).json({ ok: false, error: "You need to log in first." });
    }
    return next();
  }

  function requireAdminApi(req, res, next) {
    if (!req.currentUser) {
      return res.status(401).json({ ok: false, error: "You need to log in first." });
    }
    if (!req.currentUser.isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin access required." });
    }
    return next();
  }

  function jsonError(res, error, fallbackStatus = 400) {
    const status =
      error instanceof PocketBaseError ? error.statusCode || fallbackStatus : fallbackStatus;
    return res.status(status).json({
      ok: false,
      error: error.message || "Something went wrong."
    });
  }

  app.get("/", (req, res) => {
    if (req.currentUser) {
      return res.redirect("/catalogue");
    }
    return res.redirect("/login");
  });

  app.get("/login", (req, res) => {
    if (req.currentUser) {
      return res.redirect("/catalogue");
    }
    return res.render("login", {
      pageTitle: `Login | ${config.appName}`
    });
  });

  app.post(
    "/login",
    asyncHandler(async (req, res) => {
      try {
        const user = await service.authenticateUser(req.body.email, req.body.password);
        req.session.userId = user.id;
        // Track session
        activeSessions.set(req.sessionID, {
          sessionId: req.sessionID,
          userId: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.isAdmin,
          loginAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          ip: req.ip || "",
          userAgent: String(req.headers["user-agent"] || "").slice(0, 160)
        });
        service.logActivity(user, "login", {}, req.ip || "");
        setFlash(req, "success", "Welcome back.");
        return res.redirect("/catalogue");
      } catch (error) {
        setFlash(req, "error", error.message || "Login failed.");
        return res.redirect("/login");
      }
    })
  );

  app.post("/logout", requireLoginPage, (req, res) => {
    service.logActivity(req.currentUser, "logout", {}, req.ip || "");
    activeSessions.delete(req.sessionID);
    req.session.userId = null;
    setFlash(req, "success", "You have signed out.");
    return res.redirect("/login");
  });

  app.get(
    "/catalogue",
    requireLoginPage,
    asyncHandler(async (req, res) => {
      let meta = { available: false, source: "none", row_count: 0 };
      try {
        const loaded = await service.loadSnapshot();
        meta = loaded.meta;
      } catch (error) {
        meta = { available: false, source: "error", row_count: 0 };
      }
      return res.render("catalogue", {
        pageTitle: `Shared Item Catalogue | ${config.appName}`,
        catalogMeta: meta,
        maxResults: MAX_RESULTS
      });
    })
  );

  app.get(
    "/api/catalog/search",
    requireLoginApi,
    asyncHandler(async (req, res) => {
      const parsedLimit = Number.parseInt(req.query.limit || `${MAX_RESULTS}`, 10);
      const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(120, parsedLimit)) : MAX_RESULTS;
      const query = String(req.query.q || "").trim();
      const filters = cleanSearchFilters(
        req.query.sku,
        req.query.term,
        req.query.desc1,
        req.query.desc2,
        req.query.desc3
      );
      const result = await service.searchCatalog(query, undefined, limit, filters, {
        hasImagesOnly: String(req.query.has_images || "").trim().toLowerCase() === "true",
        warehouseActiveOnly: String(req.query.warehouse_active || "").trim().toLowerCase() === "true"
      });
      return res.json({
        ok: true,
        query,
        filters,
        total: result.rows.length,
        rows: result.rows,
        meta: result.meta
      });
    })
  );

  app.get(
    "/api/catalog/summary",
    requireAdminApi,
    asyncHandler(async (req, res) => {
      const summary = await service.getCatalogSummary();
      return res.json({
        ok: true,
        summary
      });
    })
  );

  app.get(
    "/sku/:sku",
    requireLoginPage,
    asyncHandler(async (req, res) => {
      const skuParam = String(req.params.sku || "").trim();
      const detail = await service.getSkuDetail(skuParam);
      if (!detail) {
        setFlash(req, "error", `SKU "${skuParam}" was not found in the shared catalogue.`);
        return res.redirect("/catalogue");
      }
      return res.render("sku", {
        pageTitle: `${detail.sku} | ${config.appName}`,
        sku: detail
      });
    })
  );

  app.get(
    "/api/catalog/sku/:sku",
    requireLoginApi,
    asyncHandler(async (req, res) => {
      const skuParam = String(req.params.sku || "").trim();
      const detail = await service.getSkuDetail(skuParam);
      if (!detail) {
        return res.status(404).json({ ok: false, error: "SKU not found." });
      }
      return res.json({ ok: true, sku: detail });
    })
  );

  app.get(
    "/api/catalog/location-search",
    requireAdminApi,
    asyncHandler(async (req, res) => {
      const location = String(req.query.location || "").trim();
      if (!location) {
        return res.status(400).json({ ok: false, error: "Provide a bin location to search." });
      }
      const result = await service.searchByLocation(location);
      return res.json({ ok: true, rows: result.rows || [], meta: result.meta || null, location });
    })
  );

  app.post(
    "/api/catalog/import",
    requireAdminApi,
    upload.single("catalog_file"),
    asyncHandler(async (req, res) => {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: "Upload a workbook first." });
      }
      try {
        const meta = await service.importWorkbook({
          buffer: req.file.buffer,
          originalName: req.file.originalname || "catalog.xlsx",
          user: req.currentUser
        });
        service.logActivity(req.currentUser, "import_workbook", { source_name: meta.source_name, row_count: meta.row_count }, req.ip || "");
        return res.json({ ok: true, meta });
      } catch (error) {
        return jsonError(res, error, 400);
      }
    })
  );

  app.post(
    "/api/catalog/images",
    requireLoginApi,
    upload.array("images", 6),
    asyncHandler(async (req, res) => {
      try {
        const result = await service.uploadImages({
          sku: req.body.sku,
          caption: req.body.caption,
          files: req.files || [],
          user: req.currentUser
        });
        service.logActivity(req.currentUser, "upload_images", { sku: req.body.sku, count: result.uploadedIds?.length || 0 }, req.ip || "");
        return res.json({ ok: true, ...result });
      } catch (error) {
        return jsonError(res, error, 400);
      }
    })
  );

  app.get(
    "/files/:imageId",
    requireLoginPage,
    asyncHandler(async (req, res) => {
      const collectionKey = String(req.query.collection || "").trim();
      const fileName = String(req.query.name || "").trim();
      if (!collectionKey || !fileName) {
        return res.status(400).send("Missing file parameters.");
      }
      const response = await service.proxyImage({
        imageId: req.params.imageId,
        collectionKey,
        fileName
      });
      res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
      res.setHeader("Cache-Control", "private, max-age=300");
      const buffer = Buffer.from(await response.arrayBuffer());
      return res.send(buffer);
    })
  );

  // ── Admin page ──────────────────────────────────────────────────────────

  app.get(
    "/admin",
    requireAdminPage,
    asyncHandler(async (req, res) => {
      return res.render("admin", {
        pageTitle: `Admin | ${config.appName}`
      });
    })
  );

  app.get(
    "/api/admin/sessions",
    requireAdminApi,
    (req, res) => {
      const sessions = Array.from(activeSessions.values())
        .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
      return res.json({ ok: true, sessions });
    }
  );

  app.get(
    "/api/admin/users",
    requireAdminApi,
    asyncHandler(async (req, res) => {
      const users = await service.listUsers();
      return res.json({ ok: true, users });
    })
  );

  app.get(
    "/api/admin/activity",
    requireAdminApi,
    asyncHandler(async (req, res) => {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
      const log = await service.getActivityLog(limit);
      return res.json({ ok: true, log });
    })
  );

  app.post(
    "/api/admin/logout-user",
    requireAdminApi,
    (req, res) => {
      const targetUserId = String(req.body.userId || "").trim();
      if (!targetUserId) {
        return res.status(400).json({ ok: false, error: "userId required." });
      }
      // Prevent admins locking themselves out
      if (targetUserId === req.currentUser.id) {
        return res.status(400).json({ ok: false, error: "You cannot force-logout yourself." });
      }
      let count = 0;
      for (const [sid, session] of activeSessions.entries()) {
        if (session.userId === targetUserId) {
          invalidatedSessions.add(sid);
          activeSessions.delete(sid);
          count++;
        }
      }
      service.logActivity(req.currentUser, "admin_force_logout", { target_user_id: targetUserId, sessions_ended: count }, req.ip || "");
      return res.json({ ok: true, sessionsEnded: count });
    }
  );

  app.post(
    "/api/admin/logout-all",
    requireAdminApi,
    (req, res) => {
      let count = 0;
      for (const [sid, session] of activeSessions.entries()) {
        if (session.userId !== req.currentUser.id) {
          invalidatedSessions.add(sid);
          activeSessions.delete(sid);
          count++;
        }
      }
      service.logActivity(req.currentUser, "admin_force_logout_all", { sessions_ended: count }, req.ip || "");
      return res.json({ ok: true, sessionsEnded: count });
    }
  );

  app.post(
    "/api/admin/reset-password",
    requireAdminApi,
    asyncHandler(async (req, res) => {
      const targetUserId = String(req.body.userId || "").trim();
      const newPassword = String(req.body.password || "").trim();
      if (!targetUserId || !newPassword) {
        return res.status(400).json({ ok: false, error: "userId and password are required." });
      }
      await service.resetUserPassword(targetUserId, newPassword);
      service.logActivity(req.currentUser, "admin_reset_password", { target_user_id: targetUserId }, req.ip || "");
      return res.json({ ok: true });
    })
  );

  app.get("/health", (req, res) => {
    res.json({ ok: true, app: config.appName });
  });

  app.use((error, req, res, next) => {
    console.error(error);
    if (req.path.startsWith("/api/")) {
      return jsonError(res, error, 500);
    }
    setFlash(req, "error", error.message || "Something went wrong.");
    return res.redirect(req.currentUser ? "/catalogue" : "/login");
  });

  return app;
}

async function startServer() {
  const app = await createApp();
  await new Promise((resolve) => {
    app.listen(config.port, config.host, () => {
      console.log(`${config.appName} listening on http://${config.host}:${config.port}`);
      resolve();
    });
  });
}

module.exports = {
  createApp,
  startServer
};
