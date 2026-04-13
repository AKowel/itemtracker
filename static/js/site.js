(function () {
  // ── Toast system ────────────────────────────────────────────────────────
  // Types: "success" | "error" | "info" (default)
  // Success toasts show an animated tick above the message.
  // All toasts slide up from the bottom and auto-dismiss after 3.5 s.

  let toastContainer = null;

  function getContainer() {
    if (!toastContainer) {
      toastContainer = document.createElement("div");
      toastContainer.className = "toast-container";
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  function toast(message, type) {
    if (!message) return;
    const safeType = type === "success" || type === "error" ? type : "info";
    const container = getContainer();

    const el = document.createElement("div");
    el.className = "toast toast--" + safeType;

    if (safeType === "success") {
      el.innerHTML =
        '<span class="toast__tick" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="20 6 9 17 4 12"></polyline>' +
          "</svg>" +
        "</span>" +
        '<span class="toast__message">' + escapeToast(message) + "</span>";
    } else {
      el.innerHTML = '<span class="toast__message">' + escapeToast(message) + "</span>";
    }

    container.appendChild(el);

    // Trigger the enter transition on the next two frames so the
    // browser has painted the element in its initial (hidden) state first.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.classList.add("toast--visible");
      });
    });

    var dismissTimer = setTimeout(function () {
      dismiss(el);
    }, 3500);

    // Allow tapping the toast to dismiss it early
    el.addEventListener("click", function () {
      clearTimeout(dismissTimer);
      dismiss(el);
    });
  }

  function dismiss(el) {
    el.classList.remove("toast--visible");
    el.addEventListener(
      "transitionend",
      function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      },
      { once: true }
    );
  }

  function escapeToast(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.ItemTracker = { toast: toast };

  // ── Service Worker registration ─────────────────────────────────────────
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {
        // SW registration failing is non-fatal
      });
    });
  }
})();
