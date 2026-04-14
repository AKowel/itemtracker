(function () {
  // ── DOM refs ─────────────────────────────────────────────────────────────
  var activeSessionsChip  = document.getElementById("activeSessionsChip");
  var totalUsersChip      = document.getElementById("totalUsersChip");
  var sessionsTableWrap   = document.getElementById("sessionsTableWrap");
  var usersTableWrap      = document.getElementById("usersTableWrap");
  var activityTableWrap   = document.getElementById("activityTableWrap");
  var activityCountChip   = document.getElementById("activityCountChip");
  var logoutAllButton     = document.getElementById("logoutAllButton");
  var deletionQueueWrap   = document.getElementById("deletionQueueWrap");
  var deletionQueueChip   = document.getElementById("deletionQueueChip");
  var deletionCountChip   = document.getElementById("deletionCountChip");

  var resetModal          = document.getElementById("resetModal");
  var resetModalTitle     = document.getElementById("resetModalTitle");
  var resetUserId         = document.getElementById("resetUserId");
  var resetPasswordInput  = document.getElementById("resetPasswordInput");
  var resetPasswordConfirm = document.getElementById("resetPasswordConfirm");
  var resetPasswordForm   = document.getElementById("resetPasswordForm");
  var resetModalError     = document.getElementById("resetModalError");
  var resetSubmitButton   = document.getElementById("resetSubmitButton");

  // ── Helpers ───────────────────────────────────────────────────────────────

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function timeAgo(iso) {
    if (!iso) return "—";
    var ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return String(iso);
    if (ms < 60000)  return "just now";
    if (ms < 3600000) return Math.floor(ms / 60000) + "m ago";
    if (ms < 86400000) return Math.floor(ms / 3600000) + "h ago";
    return Math.floor(ms / 86400000) + "d ago";
  }

  function actionLabel(action) {
    var map = {
      login:                    "Signed in",
      logout:                   "Signed out",
      upload_images:            "Uploaded photos",
      import_workbook:          "Imported workbook",
      admin_force_logout:       "Force-logged out user",
      admin_force_logout_all:   "Force-logged out all",
      admin_reset_password:     "Reset password",
      edit_notes:               "Edited notes",
      request_image_deletion:   "Requested deletion",
      approve_deletion:         "Approved deletion",
      reject_deletion:          "Rejected deletion"
    };
    return map[action] || String(action || "");
  }

  function actionBadgeClass(action) {
    if (action === "login")  return "activity-badge activity-badge--login";
    if (action === "logout") return "activity-badge activity-badge--logout";
    if (action.startsWith("upload")) return "activity-badge activity-badge--upload";
    if (action.startsWith("import")) return "activity-badge activity-badge--import";
    if (action.startsWith("admin"))  return "activity-badge activity-badge--admin";
    if (action === "approve_deletion") return "activity-badge activity-badge--admin";
    if (action === "reject_deletion")  return "activity-badge activity-badge--admin";
    if (action === "request_image_deletion") return "activity-badge activity-badge--upload";
    if (action === "edit_notes") return "activity-badge activity-badge--import";
    return "activity-badge";
  }

  function detailSummary(action, detail) {
    if (!detail || typeof detail !== "object") return "";
    if (action === "upload_images")   return detail.sku ? detail.sku + (detail.count ? " · " + detail.count + " photo" + (detail.count === 1 ? "" : "s") : "") : "";
    if (action === "import_workbook") return detail.row_count ? detail.row_count.toLocaleString() + " rows" : "";
    if (action === "admin_force_logout") return detail.target_user_id ? "User " + String(detail.target_user_id).slice(0, 8) + "…" : "";
    if (action === "admin_reset_password") return detail.target_user_id ? "User " + String(detail.target_user_id).slice(0, 8) + "…" : "";
    if (action === "admin_force_logout_all") return detail.sessions_ended != null ? detail.sessions_ended + " session" + (detail.sessions_ended === 1 ? "" : "s") + " ended" : "";
    if (action === "edit_notes") return detail.sku || "";
    if (action === "request_image_deletion") return detail.sku || "";
    if (action === "approve_deletion" || action === "reject_deletion") return detail.sku || "";
    return "";
  }

  // ── API helpers ───────────────────────────────────────────────────────────

  async function apiFetch(url, options) {
    var response = await fetch(url, options);
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function renderLoadError(wrapper, message) {
    if (!wrapper) return;
    wrapper.innerHTML = '<p class="admin-empty">' + escapeHtml(message || "Could not load this section.") + "</p>";
  }

  // ── Render sessions ───────────────────────────────────────────────────────

  function renderSessions(sessions) {
    if (activeSessionsChip) {
      activeSessionsChip.textContent = sessions.length + " active session" + (sessions.length === 1 ? "" : "s");
    }
    if (!sessions.length) {
      sessionsTableWrap.innerHTML = '<p class="admin-empty">No active sessions right now.</p>';
      return;
    }
    var rows = sessions.map(function (s) {
      return '<tr>' +
        '<td><strong>' + escapeHtml(s.name || s.email) + '</strong><br><span class="admin-sub">' + escapeHtml(s.email) + '</span></td>' +
        '<td>' + (s.isAdmin ? '<span class="result-badge">Admin</span>' : '<span class="result-badge" style="opacity:0.5">User</span>') + '</td>' +
        '<td>' + escapeHtml(formatDate(s.loginAt)) + '</td>' +
        '<td>' + escapeHtml(timeAgo(s.lastSeenAt)) + '</td>' +
        '<td>' + escapeHtml(s.ip || "—") + '</td>' +
        '<td>' +
          '<button type="button" class="admin-action-button admin-danger-button logout-one-btn" data-userid="' + escapeHtml(s.userId) + '" data-name="' + escapeHtml(s.name || s.email) + '">Log off</button>' +
        '</td>' +
      '</tr>';
    }).join("");
    sessionsTableWrap.innerHTML =
      '<table class="admin-table">' +
        '<thead><tr><th>User</th><th>Role</th><th>Logged in</th><th>Last seen</th><th>IP</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
    sessionsTableWrap.querySelectorAll(".logout-one-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { handleLogoutOne(btn.dataset.userid, btn.dataset.name); });
    });
  }

  // ── Render users ──────────────────────────────────────────────────────────

  function renderUsers(users, sessions) {
    if (totalUsersChip) {
      totalUsersChip.textContent = users.length + " user" + (users.length === 1 ? "" : "s");
    }
    if (!users.length) {
      usersTableWrap.innerHTML = '<p class="admin-empty">No users found.</p>';
      return;
    }
    var activeUserIds = new Set((sessions || []).map(function (s) { return s.userId; }));
    var rows = users.map(function (u) {
      var online = activeUserIds.has(u.id);
      return '<tr>' +
        '<td>' +
          '<strong>' + escapeHtml(u.name || u.email) + '</strong>' +
          (online ? ' <span class="admin-online-dot" title="Currently online"></span>' : '') +
          '<br><span class="admin-sub">' + escapeHtml(u.email) + '</span>' +
        '</td>' +
        '<td>' + (u.isAdmin ? '<span class="result-badge">Admin</span>' : '<span class="result-badge" style="opacity:0.5">User</span>') + '</td>' +
        '<td>' +
          '<button type="button" class="admin-action-button reset-pw-btn" data-userid="' + escapeHtml(u.id) + '" data-name="' + escapeHtml(u.name || u.email) + '">Reset password</button>' +
          (online ? ' <button type="button" class="admin-action-button admin-danger-button logout-one-btn" data-userid="' + escapeHtml(u.id) + '" data-name="' + escapeHtml(u.name || u.email) + '">Log off</button>' : '') +
        '</td>' +
      '</tr>';
    }).join("");
    usersTableWrap.innerHTML =
      '<table class="admin-table">' +
        '<thead><tr><th>User</th><th>Role</th><th>Actions</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
    usersTableWrap.querySelectorAll(".reset-pw-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { openResetModal(btn.dataset.userid, btn.dataset.name); });
    });
    usersTableWrap.querySelectorAll(".logout-one-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { handleLogoutOne(btn.dataset.userid, btn.dataset.name); });
    });
  }

  // ── Render activity log ───────────────────────────────────────────────────

  function renderActivity(log) {
    if (activityCountChip) {
      activityCountChip.textContent = log.length + " event" + (log.length === 1 ? "" : "s");
    }
    if (!log.length) {
      activityTableWrap.innerHTML = '<p class="admin-empty">No activity recorded yet.</p>';
      return;
    }
    var rows = log.map(function (entry) {
      var extra = detailSummary(entry.action, entry.detail);
      return '<tr>' +
        '<td>' + escapeHtml(formatDate(entry.created)) + '</td>' +
        '<td><strong>' + escapeHtml(entry.user_name || entry.user_email || "—") + '</strong><br><span class="admin-sub">' + escapeHtml(entry.user_email || "") + '</span></td>' +
        '<td><span class="' + actionBadgeClass(entry.action) + '">' + escapeHtml(actionLabel(entry.action)) + '</span></td>' +
        '<td class="admin-sub">' + escapeHtml(extra) + '</td>' +
        '<td class="admin-sub">' + escapeHtml(entry.ip_address || "—") + '</td>' +
      '</tr>';
    }).join("");
    activityTableWrap.innerHTML =
      '<div class="admin-table-scroll">' +
        '<table class="admin-table">' +
          '<thead><tr><th>When</th><th>User</th><th>Action</th><th>Detail</th><th>IP</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';
  }

  // ── Render deletion queue ─────────────────────────────────────────────────

  function renderDeletionQueue(requests) {
    var count = requests.length;
    if (deletionQueueChip) {
      deletionQueueChip.textContent = count + " pending deletion" + (count === 1 ? "" : "s");
    }
    if (deletionCountChip) {
      deletionCountChip.textContent = count + " pending";
      deletionCountChip.hidden = count === 0;
    }
    if (!deletionQueueWrap) return;
    if (!count) {
      deletionQueueWrap.innerHTML = '<p class="admin-empty">No pending deletion requests — the queue is clear.</p>';
      return;
    }
    var cards = requests.map(function (req) {
      var thumb = req.image_url
        ? '<img class="deletion-thumb" src="' + escapeHtml(req.image_url) + '" alt="Photo to delete" loading="lazy">'
        : '<div class="deletion-thumb deletion-thumb--placeholder">No preview</div>';
      var caption = req.image_caption ? '<p class="admin-sub">"' + escapeHtml(req.image_caption) + '"</p>' : '';
      var requestedBy = req.requested_by_name || req.requested_by || "Unknown";
      var requestedAt = formatDate(req.created);
      return (
        '<div class="deletion-card">' +
          '<div class="deletion-card__thumb">' + thumb + '</div>' +
          '<div class="deletion-card__info">' +
            '<strong>' + escapeHtml(req.sku || "—") + '</strong>' +
            caption +
            '<p class="admin-sub">Requested by <strong>' + escapeHtml(requestedBy) + '</strong> · ' + escapeHtml(requestedAt) + '</p>' +
          '</div>' +
          '<div class="deletion-card__actions">' +
            '<button type="button" class="admin-danger-button deletion-approve-btn" data-id="' + escapeHtml(req.id) + '" data-sku="' + escapeHtml(req.sku || "") + '">Delete photo</button>' +
            '<button type="button" class="ghost-button deletion-reject-btn" data-id="' + escapeHtml(req.id) + '" data-sku="' + escapeHtml(req.sku || "") + '">Reject</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");
    deletionQueueWrap.innerHTML = '<div class="deletion-queue">' + cards + '</div>';

    deletionQueueWrap.querySelectorAll(".deletion-approve-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { handleApproveDeletion(btn.dataset.id, btn.dataset.sku); });
    });
    deletionQueueWrap.querySelectorAll(".deletion-reject-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { handleRejectDeletion(btn.dataset.id, btn.dataset.sku); });
    });
  }

  async function handleApproveDeletion(requestId, sku) {
    if (!requestId) return;
    if (!confirm("Permanently delete this photo for " + (sku || "this SKU") + "? This cannot be undone.")) return;
    try {
      await apiFetch("/api/admin/deletion-queue/" + encodeURIComponent(requestId) + "/approve", { method: "POST" });
      window.ItemTracker?.toast("Photo deleted successfully", "success");
      await loadDeletionQueue();
    } catch (err) {
      window.ItemTracker?.toast(err.message || "Could not delete photo", "error");
    }
  }

  async function handleRejectDeletion(requestId, sku) {
    if (!requestId) return;
    if (!confirm("Reject this deletion request? The photo will remain visible.")) return;
    try {
      await apiFetch("/api/admin/deletion-queue/" + encodeURIComponent(requestId) + "/reject", { method: "POST" });
      window.ItemTracker?.toast("Deletion request rejected — photo reinstated", "info");
      await loadDeletionQueue();
    } catch (err) {
      window.ItemTracker?.toast(err.message || "Could not reject request", "error");
    }
  }

  async function loadDeletionQueue() {
    try {
      var data = await apiFetch("/api/admin/deletion-queue");
      renderDeletionQueue(data.requests || []);
    } catch (err) {
      renderLoadError(deletionQueueWrap, err.message || "Could not load deletion queue.");
    }
  }

  // ── Load all data ─────────────────────────────────────────────────────────

  var cachedSessions = [];

  async function loadAll() {
    var results = await Promise.allSettled([
      apiFetch("/api/admin/sessions"),
      apiFetch("/api/admin/users"),
      apiFetch("/api/admin/activity?limit=200")
    ]);

    var sessionResult = results[0];
    var usersResult = results[1];
    var activityResult = results[2];
    var loadErrors = [];

    if (sessionResult.status === "fulfilled") {
      cachedSessions = sessionResult.value.sessions || [];
      renderSessions(cachedSessions);
    } else {
      cachedSessions = [];
      renderLoadError(sessionsTableWrap, sessionResult.reason?.message || "Could not load active sessions.");
      loadErrors.push(sessionResult.reason?.message || "Could not load active sessions.");
    }

    if (usersResult.status === "fulfilled") {
      renderUsers(usersResult.value.users || [], cachedSessions);
    } else {
      renderLoadError(usersTableWrap, usersResult.reason?.message || "Could not load users.");
      loadErrors.push(usersResult.reason?.message || "Could not load users.");
    }

    if (activityResult.status === "fulfilled") {
      renderActivity(activityResult.value.log || []);
    } else {
      renderLoadError(activityTableWrap, activityResult.reason?.message || "Could not load activity.");
      loadErrors.push(activityResult.reason?.message || "Could not load activity.");
    }

    if (loadErrors.length) {
      window.ItemTracker?.toast(loadErrors[0], "error");
    }

    await loadDeletionQueue();
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleLogoutOne(userId, name) {
    if (!confirm("Sign out " + (name || userId) + "? Their next page request will end their session.")) return;
    try {
      var data = await apiFetch("/api/admin/logout-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId })
      });
      window.ItemTracker?.toast(
        data.sessionsEnded > 0
          ? (name || userId) + " has been signed out"
          : (name || userId) + " had no active sessions",
        "success"
      );
      await loadAll();
    } catch (err) {
      window.ItemTracker?.toast(err.message || "Could not sign out user", "error");
    }
  }

  if (logoutAllButton) {
    logoutAllButton.addEventListener("click", async function () {
      if (!confirm("Sign out all other users? They will be redirected to the login page on their next request.")) return;
      try {
        var data = await apiFetch("/api/admin/logout-all", { method: "POST" });
        window.ItemTracker?.toast(
          data.sessionsEnded > 0
            ? data.sessionsEnded + " session" + (data.sessionsEnded === 1 ? "" : "s") + " ended"
            : "No other active sessions to end",
          "success"
        );
        await loadAll();
      } catch (err) {
        window.ItemTracker?.toast(err.message || "Could not log everyone off", "error");
      }
    });
  }

  // ── Reset password modal ──────────────────────────────────────────────────

  function openResetModal(userId, name) {
    if (!resetModal) return;
    if (resetUserId)          resetUserId.value = userId;
    if (resetModalTitle)      resetModalTitle.textContent = "Reset password for " + (name || userId);
    if (resetPasswordInput)   resetPasswordInput.value = "";
    if (resetPasswordConfirm) resetPasswordConfirm.value = "";
    if (resetModalError)      { resetModalError.hidden = true; resetModalError.textContent = ""; }
    resetModal.hidden = false;
    resetPasswordInput?.focus();
  }

  function closeResetModal() {
    if (resetModal) resetModal.hidden = true;
  }

  document.querySelectorAll(".admin-modal__close").forEach(function (btn) {
    btn.addEventListener("click", closeResetModal);
  });

  if (resetModal) {
    resetModal.addEventListener("click", function (e) {
      if (e.target === resetModal) closeResetModal();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && resetModal && !resetModal.hidden) closeResetModal();
  });

  if (resetPasswordForm) {
    resetPasswordForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var userId   = resetUserId?.value || "";
      var password = resetPasswordInput?.value || "";
      var confirm  = resetPasswordConfirm?.value || "";
      if (!userId || !password) return;
      if (password.length < 8) {
        showModalError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        showModalError("Passwords do not match.");
        return;
      }
      if (resetSubmitButton) { resetSubmitButton.disabled = true; resetSubmitButton.textContent = "Saving…"; }
      try {
        await apiFetch("/api/admin/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, password })
        });
        closeResetModal();
        window.ItemTracker?.toast("Password updated successfully", "success");
      } catch (err) {
        showModalError(err.message || "Could not reset password");
      } finally {
        if (resetSubmitButton) { resetSubmitButton.disabled = false; resetSubmitButton.textContent = "Set password"; }
      }
    });
  }

  function showModalError(msg) {
    if (!resetModalError) return;
    resetModalError.textContent = msg;
    resetModalError.hidden = false;
  }

  // ── Auto-refresh sessions every 30s ──────────────────────────────────────

  setInterval(async function () {
    try {
      var data = await apiFetch("/api/admin/sessions");
      cachedSessions = data.sessions || [];
      renderSessions(cachedSessions);
    } catch (_) {}
  }, 30000);

  // ── Boot ──────────────────────────────────────────────────────────────────

  loadAll();
})();
