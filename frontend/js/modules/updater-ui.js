// updater-ui.js - electron-updater status (public GitHub releases)

function setUpdateBanner(text, kind = "info") {
  const el = document.getElementById("update-banner");
  if (!el) return;
  el.style.display = text ? "block" : "none";
  el.textContent = text || "";
  el.dataset.kind = kind;
}

function setUpdateDetail(text) {
  const el = document.getElementById("update-status-text");
  if (el) el.textContent = text || "—";
}

function setInstallButtonVisible(visible) {
  const btn = document.getElementById("btn-install-update");
  if (btn) btn.style.display = visible ? "inline-block" : "none";
}

function handleUpdateStatus(payload) {
  if (!payload || !payload.status) return;

  switch (payload.status) {
    case "checking":
      setUpdateDetail("Suche nach Updates…");
      setUpdateBanner("Suche nach Updates…", "info");
      setInstallButtonVisible(false);
      break;
    case "available":
      setUpdateDetail(`Update ${payload.version} verfügbar – Download startet…`);
      setUpdateBanner(`Update ${payload.version} verfügbar`, "info");
      setInstallButtonVisible(false);
      log(`Update verfügbar: v${payload.version}`, "info");
      break;
    case "none":
      setUpdateDetail(`Aktuell (v${payload.version || "?"})`);
      setUpdateBanner("", "info");
      setInstallButtonVisible(false);
      break;
    case "downloading": {
      const pct = Math.round(payload.percent || 0);
      setUpdateDetail(`Lade Update… ${pct}%`);
      setUpdateBanner(`Update wird geladen… ${pct}%`, "info");
      setInstallButtonVisible(false);
      break;
    }
    case "ready":
      setUpdateDetail(`v${payload.version} bereit – Neustart zum Installieren`);
      setUpdateBanner(
        `Update v${payload.version} bereit. Klicke „Jetzt installieren“ oder starte neu.`,
        "success"
      );
      setInstallButtonVisible(true);
      log(`Update v${payload.version} heruntergeladen.`, "success");
      break;
    case "error": {
      let msg = payload.message || "unbekannt";
      if (msg.length > 220) msg = msg.slice(0, 220) + "…";
      setUpdateDetail(`Fehler: ${msg}`);
      setUpdateBanner(`Update-Fehler: ${msg}`, "error");
      setInstallButtonVisible(false);
      log(`Update-Fehler: ${payload.message || "unbekannt"}`, "error");
      break;
    }
    default:
      break;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!window.electronAPI) {
    setUpdateDetail("Nur in der Desktop-App verfügbar");
    return;
  }

  if (typeof window.electronAPI.onUpdateStatus === "function") {
    window.electronAPI.onUpdateStatus(handleUpdateStatus);
  }

  document.getElementById("btn-check-update")?.addEventListener("click", async () => {
    setUpdateDetail("Suche nach Updates…");
    const result = await window.electronAPI.checkForUpdates();
    if (result?.reason === "dev-mode") {
      setUpdateDetail("Dev-Modus: Auto-Update deaktiviert");
      setUpdateBanner("Auto-Update nur in der installierten App", "info");
      log("Update-Check im Dev-Modus übersprungen.", "warning");
    } else if (result?.ok === false && result.error) {
      setUpdateDetail(`Fehler: ${result.error}`);
      log(`Update-Check fehlgeschlagen: ${result.error}`, "error");
    }
  });

  document.getElementById("btn-install-update")?.addEventListener("click", async () => {
    const ok = confirm("Update jetzt installieren? Die App wird beendet und neu gestartet.");
    if (!ok) return;
    await window.electronAPI.installUpdate();
  });

  window.electronAPI.isPackaged?.().then((packaged) => {
    if (!packaged) setUpdateDetail("Dev-Modus (kein Auto-Update)");
    else setUpdateDetail("Bereit – prüft automatisch nach Start");
  });

  window.electronAPI.getVersion?.().then((v) => {
    if (DOM["app-version-text"]) DOM["app-version-text"].textContent = `v${v}`;
    const about = document.getElementById("about-version-line");
    if (about) about.textContent = `Version ${v}`;
  });
});
