import { store } from "./store.js";
import { autoSaveInvoices, performLocalFolderBackup } from "./backup.js";
import { startPushTask } from "./progress-indicator.js";

const API = "https://api.github.com";

function triggerLocalBackupOnPush() {
  try {
    const s = store.getSettings();
    if (s.localFolderBackup?.onPush !== false) {
      performLocalFolderBackup({ trigger: "push", showToast: true });
    }
  } catch (e) {
    console.warn("خطا در همگام‌سازی بک‌آپ محلی هنگام push:", e);
  }
}

export function getBackupRepoConfig() {
  const s = store.getSettings();
  const b = s.backupRepo || {};
  return {
    owner: b.owner || "Mohamadrezaheydarpourgithub",
    repo: b.repo || "online-factor",
    branch: b.branch || "main",
    token: b.token || "",
    autoPush: b.autoPush !== false,
  };
}

export function getPublicRepoConfig() {
  const s = store.getSettings();
  const backup = getBackupRepoConfig();
  const pub = s.publicRepo || {};
  return {
    owner: pub.owner || backup.owner || "Mohamadrezaheydarpourgithub",
    repo: pub.repo || backup.repo || "online-factor",
    branch: pub.branch || backup.branch || "main",
    token: pub.token || backup.token || "",
    enabled: pub.enabled ?? true,
  };
}

function ghToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3000);
}

/* =========================================================================
   مدیریت وضعیت آفلاین و صف همگام‌سازی خودکار (Offline Sync Manager)
   ========================================================================= */
const OFFLINE_SYNC_KEY = "cafe_pending_offline_sync";
let isOfflineActive = false;
let offlineProbeTimer = null;

export function getPendingOfflineData() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_SYNC_KEY)) || { count: 0, items: [] };
  } catch {
    return { count: 0, items: [] };
  }
}

export function savePendingOfflineData(data) {
  try {
    localStorage.setItem(OFFLINE_SYNC_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("خطا در ذخیره داده‌های صف آفلاین:", e);
  }
}

export function recordPendingOfflineChange(title = "تغییر اطلاعات") {
  const data = getPendingOfflineData();
  data.count = (data.count || 0) + 1;
  data.lastAt = new Date().toISOString();
  if (!data.items) data.items = [];
  data.items.push({ title, at: data.lastAt });
  savePendingOfflineData(data);
  updateOfflineBannerUI();
}

export function clearPendingOfflineChanges() {
  localStorage.removeItem(OFFLINE_SYNC_KEY);
  updateOfflineBannerUI();
}

export function getPendingOfflineChangesCount() {
  return getPendingOfflineData().count || 0;
}

export function isOfflineMode() {
  return isOfflineActive || !navigator.onLine;
}

function adjustBarPosition() {
  const updateBar = document.getElementById("app-update-bar");
  const offlineBar = document.getElementById("app-offline-bar");
  if (!offlineBar) return;
  if (updateBar && !updateBar.classList.contains("hidden")) {
    offlineBar.style.top = `${updateBar.offsetHeight}px`;
  } else {
    offlineBar.style.top = "0px";
  }
}

export function updateOfflineBannerUI(reason = "", wasSuccess = false) {
  const bar = document.getElementById("app-offline-bar");
  if (!bar) return;

  const titleEl = document.getElementById("offline-bar-title");
  const descEl = document.getElementById("offline-bar-desc");
  const badgeEl = document.getElementById("offline-pending-badge");
  const iconEl = document.getElementById("offline-bar-icon");
  const btnRetry = document.getElementById("btn-retry-sync");

  const count = getPendingOfflineChangesCount();
  const offline = isOfflineMode() || count > 0;

  if (offline && !wasSuccess) {
    bar.classList.remove("hidden");
    bar.className =
      "sticky top-0 z-[95] bg-gradient-to-r from-amber-600 via-amber-700 to-orange-600 text-white shadow-xl px-3 sm:px-6 py-2 sm:py-2.5 transition-all duration-300 border-b border-white/20";
    if (iconEl) {
      iconEl.textContent = "⚡";
      iconEl.className = "text-xl sm:text-2xl shrink-0 animate-pulse";
    }
    if (titleEl) titleEl.textContent = "حالت آفلاین فعال است";
    if (badgeEl) {
      badgeEl.textContent =
        count > 0
          ? `${count.toLocaleString("fa-IR")} تغییر در صف ارسال`
          : "ذخیره محلی فعال";
    }
    if (descEl) {
      descEl.textContent =
        reason
          ? `${reason}. تغییرات در حافظه و پوشه محلی ذخیره شده‌اند و به محض برقراری اتصال اینترنت به گیت‌هاب ارسال خواهند شد.`
          : "اینترنت در دسترس نیست یا اتصال با خطا مواجه شد. تغییرات به صورت محلی ذخیره شده و به محض آنلاین شدن به گیت‌هاب ارسال می‌شوند.";
    }
    if (btnRetry) btnRetry.disabled = false;
    adjustBarPosition();
  } else if (wasSuccess) {
    bar.classList.remove("hidden");
    bar.className =
      "sticky top-0 z-[95] bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-700 text-white shadow-xl px-3 sm:px-6 py-2 sm:py-2.5 transition-all duration-300 border-b border-white/20";
    if (iconEl) {
      iconEl.textContent = "✅";
      iconEl.className = "text-xl sm:text-2xl shrink-0";
    }
    if (titleEl) titleEl.textContent = "اتصال برقرار شد — تمامی تغییرات ذخیره شدند";
    if (badgeEl) badgeEl.textContent = "همگام‌سازی کامل";
    if (descEl) descEl.textContent = "تمامی فاکتورها، پیش‌فاکتورها و اطلاعات ثبت‌شده با موفقیت روی گیت‌هاب ذخیره شدند ☁️";
    if (btnRetry) btnRetry.disabled = true;
    adjustBarPosition();

    setTimeout(() => {
      if (!isOfflineActive && getPendingOfflineChangesCount() === 0) {
        bar.classList.add("hidden");
      }
    }, 3500);
  } else {
    bar.classList.add("hidden");
  }
}

export function setOfflineMode(active, reason = "", wasSuccess = false) {
  isOfflineActive = active;
  updateOfflineBannerUI(reason, wasSuccess);

  if (active) {
    startOfflineProbe();
  } else if (offlineProbeTimer) {
    clearInterval(offlineProbeTimer);
    offlineProbeTimer = null;
  }
}

export async function probeNetworkConnectivity() {
  if (!navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(`https://api.github.com/zen?_t=${Date.now()}`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    return res.ok || res.status === 403 || res.status === 429;
  } catch {
    return false;
  }
}

function startOfflineProbe() {
  if (offlineProbeTimer) clearInterval(offlineProbeTimer);
  offlineProbeTimer = setInterval(async () => {
    if (!isOfflineMode() && getPendingOfflineChangesCount() === 0) {
      clearInterval(offlineProbeTimer);
      offlineProbeTimer = null;
      return;
    }
    if (navigator.onLine) {
      const reachable = await probeNetworkConnectivity();
      if (reachable) {
        console.log("🌐 اتصال اینترنت مجدداً تایید شد — شروع ارسال تغییرات در صف...");
        await retryPendingSync();
      }
    }
  }, 20000);
}

export async function retryPendingSync() {
  const btn = document.getElementById("btn-retry-sync");
  const icon = document.getElementById("btn-retry-sync-icon");
  const text = document.getElementById("btn-retry-sync-text");
  if (btn) btn.disabled = true;
  if (icon) icon.className = "text-sm inline-block animate-spin";
  if (text) text.textContent = "در حال ارسال به گیت‌هاب...";

  try {
    const res = await syncAllStorages({
      title: "همگام‌سازی پس از آنلاین شدن",
      showToast: true,
      isRetry: true,
    });
    return res;
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.className = "text-sm";
    if (text) text.textContent = "تلاش مجدد برای ارسال";
  }
}

export function initOfflineSyncManager() {
  const btnRetry = document.getElementById("btn-retry-sync");
  btnRetry?.addEventListener("click", () => retryPendingSync());

  window.addEventListener("online", async () => {
    console.log("رویداد online مرورگر فعال شد");
    const count = getPendingOfflineChangesCount();
    if (count > 0 || isOfflineActive) {
      const ok = await probeNetworkConnectivity();
      if (ok) {
        await retryPendingSync();
      }
    } else {
      setOfflineMode(false);
    }
  });

  window.addEventListener("offline", () => {
    console.log("رویداد offline مرورگر فعال شد");
    setOfflineMode(true, "اتصال اینترنت قطع شد");
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      if (isOfflineActive || getPendingOfflineChangesCount() > 0) {
        if (navigator.onLine && (await probeNetworkConnectivity())) {
          await retryPendingSync();
        }
      }
    }
  });

  window.addEventListener("resize", adjustBarPosition);

  // بررسی وضعیت اولیه
  const pendingCount = getPendingOfflineChangesCount();
  if (!navigator.onLine) {
    setOfflineMode(true, "اینترنت در دسترس نیست");
  } else if (pendingCount > 0) {
    setOfflineMode(true, "تغییرات در صف همگام‌سازی");
    setTimeout(async () => {
      if (await probeNetworkConnectivity()) {
        await retryPendingSync();
      }
    }, 3000);
  }
}

/* ---------- push خودکار به ریپوی بک‌آپ ---------- */
export function autoPushGitHub(title = "پشتیبان‌گیری خودکار") {
  syncAllStorages({ title, showToast: false });
}

/* ---------- push خودکار به ریپوی پابلیک ---------- */
export function autoPushPublicRepo(title = "همگام‌سازی عمومی") {
  syncAllStorages({ title, showToast: false });
}

/* ---------- همگام‌سازی یکپارچه تمام حافظه‌ها (لوکال + گیت‌هاب خصوصی و عمومی) ---------- */
let isSyncing = false;
let syncDebounceTimer = null;

export async function syncAllStorages({
  title = "همگام‌سازی گیت‌هاب",
  showToast = false,
  _task = null,
  isRetry = false,
} = {}) {
  try {
    autoSaveInvoices();
  } catch (_) {}

  const backupCfg = getBackupRepoConfig();
  const pubCfg = getPublicRepoConfig();

  const hasBackup = Boolean(backupCfg.owner && backupCfg.repo && backupCfg.token);
  const hasPublic = Boolean(pubCfg.owner && pubCfg.repo && pubCfg.token);

  if (!hasBackup && !hasPublic) {
    if (showToast) {
      ghToast("⚠️ اطلاعات اتصال به گیت‌هاب در تنظیمات وارد نشده است");
    }
    return { ok: false, message: "تنظیمات گیت‌هاب یافت نشد" };
  }

  // ۱. بررسی حالت آفلاین: اگر اینترنت قطع باشد، بلافاصله بک‌آپ لوکال اجرا شده و در صف قرار می‌گیرد
  if ((!navigator.onLine || isOfflineMode()) && !isRetry) {
    console.log("حالت آفلاین فعال است — تغییر به صف همگام‌سازی اضافه شد:", title);
    setOfflineMode(true, "اینترنت در دسترس نیست");
    recordPendingOfflineChange(title);

    // بک‌آپ لوکال بلافاصله آپدیت بشه (فقط در حالت آفلاین اینجوری بشه)
    let backupRes = null;
    try {
      backupRes = await performLocalFolderBackup({ trigger: "offline", showToast: true });
    } catch (e) {
      console.warn("خطا در بک‌آپ لوکال آفلاین:", e);
    }

    if (backupRes && !backupRes.ok) {
      console.warn("پشتیبان‌گیری لوکال در حالت آفلاین ناموفق بود:", backupRes.reason);
      if (backupRes.reason === "no_dir") {
        ghToast("⚡ حالت آفلاین: تغییر در صف گیت‌هاب ثبت شد (پوشه محلی هنوز در تنظیمات متصل نشده است)");
      } else if (backupRes.reason === "no_permission") {
        ghToast("⚠️ حالت آفلاین: مجوز دسترسی به پوشه محلی نیازمند تأیید است؛ لطفاً در تنظیمات روی پوشه کلیک کنید");
      }
    } else if (showToast) {
      ghToast("⚡ حالت آفلاین: دیتای لوکال آپدیت شد و در صف ارسال به گیت‌هاب قرار گرفت");
    }
    return { ok: false, offline: true, message: "ذخیره در حالت آفلاین انجام شد" };
  }

  const task = _task || startPushTask(title, "در حال بررسی اتصال به گیت‌هاب...");

  if (isSyncing) {
    task.update(10, "در صف همگام‌سازی...");
    clearTimeout(syncDebounceTimer);
    return new Promise((resolve) => {
      syncDebounceTimer = setTimeout(async () => {
        resolve(await syncAllStorages({ title, showToast, _task: task, isRetry }));
      }, 1000);
    });
  }

  isSyncing = true;
  try {
    const isSameRepo =
      hasBackup &&
      hasPublic &&
      backupCfg.owner.trim().toLowerCase() === pubCfg.owner.trim().toLowerCase() &&
      backupCfg.repo.trim().toLowerCase() === pubCfg.repo.trim().toLowerCase() &&
      (backupCfg.branch || "main").trim() === (pubCfg.branch || "main").trim();

    if (isSameRepo) {
      const res = await pushCombinedToGitHub(backupCfg, { silent: true, task });
      if (typeof window.updatePublicStatusUI === "function") window.updatePublicStatusUI();
      if (typeof window.updateGitHubStatusUI === "function") window.updateGitHubStatusUI();

      if (res.ok) {
        const hadPending = getPendingOfflineChangesCount() > 0 || isOfflineActive;
        clearPendingOfflineChanges();
        setOfflineMode(false, "", hadPending);
        triggerLocalBackupOnPush();
        task.complete("با موفقیت روی گیت‌هاب ذخیره شد ✅");
        if (showToast) {
          ghToast("✅ همگام‌سازی گیت‌هاب (عمومی و خصوصی) انجام شد ☁️");
        }
      } else {
        if (res.blockedByGuard) {
          task.fail("سد ضد تخریب: پوش لغو شد");
        } else {
          task.fail(res.message || "خطا در همگام‌سازی");
          // ورود به حالت آفلاین و بک‌آپ فوری در پوشه لوکال
          setOfflineMode(true, res.message || "خطا در اتصال به گیت‌هاب");
          recordPendingOfflineChange(title);
          try {
            await performLocalFolderBackup({ trigger: "offline", showToast: true });
          } catch (_) {}
        }
        if (showToast) {
          ghToast(`❌ خطا در همگام‌سازی گیت‌هاب: ${res.message || ""}`);
        }
      }
      return res;
    } else {
      let backupRes = { ok: false };
      let publicRes = { ok: false };

      if (hasBackup) {
        backupRes = await pushBackupToGitHub({ silent: true, task });
      }
      if (hasPublic) {
        publicRes = await pushToPublicRepo({ silent: true, task });
      }

      if (typeof window.updatePublicStatusUI === "function") window.updatePublicStatusUI();
      if (typeof window.updateGitHubStatusUI === "function") window.updateGitHubStatusUI();

      const allOk = (hasBackup ? backupRes.ok : true) && (hasPublic ? publicRes.ok : true);
      if (allOk) {
        const hadPending = getPendingOfflineChangesCount() > 0 || isOfflineActive;
        clearPendingOfflineChanges();
        setOfflineMode(false, "", hadPending);
        triggerLocalBackupOnPush();
        task.complete("با موفقیت روی گیت‌هاب ذخیره شد ✅");
        if (showToast) {
          ghToast("✅ همگام‌سازی ریپوی عمومی و خصوصی انجام شد ☁️");
        }
      } else {
        task.fail("خطا در همگام‌سازی گیت‌هاب");
        // ورود به حالت آفلاین و بک‌آپ فوری در پوشه لوکال
        setOfflineMode(true, "اتصال به گیت‌هاب با خطا مواجه شد");
        recordPendingOfflineChange(title);
        try {
          await performLocalFolderBackup({ trigger: "offline", showToast: true });
        } catch (_) {}
        if (showToast) {
          ghToast("❌ خطا در همگام‌سازی با گیت‌هاب: ذخیره در حالت آفلاین انجام شد");
        }
      }
      return { ok: backupRes.ok || publicRes.ok };
    }
  } catch (err) {
    console.error("خطا در syncAllStorages:", err);
    task.fail(err.message || "خطا در همگام‌سازی");
    setOfflineMode(true, err.message || "خطا در اتصال به گیت‌هاب");
    recordPendingOfflineChange(title);
    try {
      await performLocalFolderBackup({ trigger: "offline", showToast: true });
    } catch (_) {}
    if (showToast) ghToast(`⚠️ خطا در اتصال: حالت آفلاین فعال شد و بک‌آپ محلی ذخیره گردید`);
    return { ok: false, offline: true, error: err.message };
  } finally {
    isSyncing = false;
  }
}

export function saveBackupRepoConfig(cfg) {
  store.saveSettings({ ...store.getSettings(), backupRepo: cfg });
}

export function savePublicRepoConfig(cfg) {
  store.saveSettings({ ...store.getSettings(), publicRepo: cfg });
}

export function getGitHubConfig() {
  return getBackupRepoConfig();
}
export function saveGitHubConfig(cfg) {
  saveBackupRepoConfig(cfg);
}

function headers(cfg) {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function gh(path, cfg, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...headers(cfg), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

/* ---------- محاسبه هَش Git Blob SHA-1 در مرورگر برای تشخیص دقیق تغییرات فایل‌ها ---------- */
export async function calculateGitBlobSha(contentStr) {
  try {
    const enc = new TextEncoder();
    const contentBytes = enc.encode(contentStr);
    const headerBytes = enc.encode(`blob ${contentBytes.byteLength}\0`);
    const fullBytes = new Uint8Array(headerBytes.byteLength + contentBytes.byteLength);
    fullBytes.set(headerBytes, 0);
    fullBytes.set(contentBytes, headerBytes.byteLength);
    const hashBuffer = await crypto.subtle.digest("SHA-1", fullBytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (err) {
    console.warn("خطا در محاسبه هش SHA-1 گیت:", err);
    return null;
  }
}

/* ---------- فیلتر هوشمند: فقط فایل‌هایی که دارای دیتای جدید یا تغییریافته هستند انتخاب می‌شوند ---------- */
export async function filterOnlyChangedFiles(candidateFiles, remoteFileShas) {
  if (!remoteFileShas || remoteFileShas.size === 0) {
    return candidateFiles;
  }

  // ۱. بررسی فایل‌های اصلی داده‌ها (فاکتورها، محصولات، مشتریان، اعلانات و ...)
  const nonMetaFiles = candidateFiles.filter((f) => !f.path.endsWith("meta.json"));
  const changedNonMetaFiles = [];

  for (const f of nonMetaFiles) {
    const localSha = await calculateGitBlobSha(f.content);
    const remoteSha = remoteFileShas.get(f.path);
    // اگر فایل در مخزن وجود نداشته باشد یا هش آن متفاوت باشد، دارای دیتای جدید است
    if (!remoteSha || remoteSha !== localSha) {
      changedNonMetaFiles.push(f);
    }
  }

  // اگر هیچ فایل دیتایی تغییر نکرده باشد، هیچ ارسالی لازم نیست (حتی meta.json نیز ارسال نمی‌شود)
  if (changedNonMetaFiles.length === 0) {
    return [];
  }

  // ۲. متادیتا تنها برای بخش‌هایی که دیتای جدید دارند اضافه می‌شود
  const result = [...changedNonMetaFiles];
  const metaFiles = candidateFiles.filter((f) => f.path.endsWith("meta.json"));
  for (const mf of metaFiles) {
    if (mf.path.startsWith("backup/") && changedNonMetaFiles.some((f) => f.path.startsWith("backup/"))) {
      result.push(mf);
    } else if (mf.path.startsWith("data/") && changedNonMetaFiles.some((f) => f.path.startsWith("data/"))) {
      result.push(mf);
    }
  }

  return result;
}

/* ---------- بررسی وجود داده‌های محصولات در مخزن عمومی ---------- */
export async function checkRemotePublicData(cfg) {
  if (!cfg || !cfg.owner || !cfg.repo) {
    return {
      hasData: false,
      productCount: 0,
      categoryCount: 0,
      products: [],
      categories: [],
    };
  }

  const branch = encodeURIComponent(cfg.branch || "main");
  let productCount = 0;
  let categoryCount = 0;
  let remoteProducts = [];
  let remoteCategories = [];

  // ۱. بررسی فایل دیتای عمومی محصولات (data/products.json) از طریق GitHub API
  try {
    const res = await gh(
      `/repos/${cfg.owner}/${cfg.repo}/contents/data/products.json?ref=${branch}`,
      cfg,
    );
    if (res && res.content) {
      const data = JSON.parse(fromBase64(res.content));
      if (Array.isArray(data) && data.length > 0) {
        productCount = data.length;
        remoteProducts = data;
      }
    }
  } catch (_) {}

  // ۲. تلاش جایگزین از raw.githubusercontent.com در صورت عدم پاسخ مناسب
  if (productCount === 0) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch || "main"}/data/products.json?_=${Date.now()}`;
      const resRaw = await fetch(rawUrl, { cache: "no-store" });
      if (resRaw.ok) {
        const data = await resRaw.json();
        if (Array.isArray(data) && data.length > 0) {
          productCount = data.length;
          remoteProducts = data;
        }
      }
    } catch (_) {}
  }

  // ۳. بررسی دسته‌بندی‌های عمومی (data/product-categories.json)
  try {
    const resCat = await gh(
      `/repos/${cfg.owner}/${cfg.repo}/contents/data/product-categories.json?ref=${branch}`,
      cfg,
    );
    if (resCat && resCat.content) {
      const dataCat = JSON.parse(fromBase64(resCat.content));
      if (Array.isArray(dataCat) && dataCat.length > 0) {
        categoryCount = dataCat.length;
        remoteCategories = dataCat;
      }
    }
  } catch (_) {}

  // ۴. اگر هیچ محصولی در data/products.json نبود، بررسی backup/products.json
  if (productCount === 0) {
    try {
      const resB = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/contents/backup/products.json?ref=${branch}`,
        cfg,
      );
      if (resB && resB.content) {
        const dataB = JSON.parse(fromBase64(resB.content));
        if (Array.isArray(dataB) && dataB.length > 0) {
          productCount = dataB.length;
          remoteProducts = dataB;
        }
      }
    } catch (_) {}
  }

  return {
    hasData: productCount > 0 || categoryCount > 0,
    productCount,
    categoryCount,
    products: remoteProducts,
    categories: remoteCategories,
  };
}

/* ---------- فایل‌های پشتیبان ریپوی پرایوت ---------- */
function collectBackupFiles() {
  return [
    {
      path: "backup/invoices.json",
      content: JSON.stringify(store.getInvoices(), null, 2),
    },
    {
      path: "backup/proformas.json",
      content: JSON.stringify(store.getProformas(), null, 2),
    },
    {
      path: "backup/announcements.json",
      content: JSON.stringify(store.getAnnouncements(), null, 2),
    },
    {
      path: "backup/products.json",
      content: JSON.stringify(store.getProducts(), null, 2),
    },
    {
      // ✅ دسته‌بندی محصولات در ریپوی خصوصی
      path: "backup/product-categories.json",
      content: JSON.stringify(store.getProductCategories(), null, 2),
    },
    {
      path: "backup/customers.json",
      content: JSON.stringify(store.getCustomers(), null, 2),
    },
    {
      path: "backup/shop-info.json",
      content: JSON.stringify(store.getShopInfo(), null, 2),
    },
    {
      path: "backup/custom-services.json",
      content: JSON.stringify(store.getCustomServices(), null, 2),
    },
    {
      path: "backup/services.json",
      content: JSON.stringify(store.getServices(), null, 2),
    },
    {
      path: "backup/meta.json",
      content: JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          invoiceCount: store.getInvoices().length,
          proformaCount: store.getProformas().length,
          productCount: store.getProducts().length,
          productCategoryCount: store.getProductCategories().length,
          customerCount: store.getCustomers().length,
        },
        null,
        2,
      ),
    },
  ];
}

/* ---------- فایل‌های عمومی ریپوی پابلیک (سایت مشتری) ---------- */
function collectPublicFiles() {
  return [
    {
      path: "data/products.json",
      content: JSON.stringify(store.getProducts(), null, 2),
    },
    {
      path: "data/announcements.json",
      content: JSON.stringify(store.getAnnouncements(), null, 2),
    },
    {
      // ✅ دسته‌بندی محصولات در ریپوی عمومی مشتری
      path: "data/product-categories.json",
      content: JSON.stringify(store.getProductCategories(), null, 2),
    },
    {
      path: "data/shop-info.json",
      content: JSON.stringify(store.getShopInfo(), null, 2),
    },
    {
      path: "data/custom-services.json",
      content: JSON.stringify(store.getCustomServices(), null, 2),
    },
    {
      path: "data/services.json",
      content: JSON.stringify(store.getServices(), null, 2),
    },
    {
      path: "data/meta.json",
      content: JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          productCount: store.getProducts().length,
          productCategoryCount: store.getProductCategories().length,
        },
        null,
        2,
      ),
    },
  ];
}

/* ---------- همگام‌سازی کامل یکپارچه برای زمانی که هر دو ریپو یکسان هستند ---------- */
export async function pushCombinedToGitHub(cfg, { silent = false, task = null, title = "همگام‌سازی عمومی و پشتیبان" } = {}) {
  const currentTask = task || startPushTask(title, "بررسی اطلاعات اتصال به گیت‌هاب...");

  if (!cfg.owner || !cfg.repo || !cfg.token) {
    currentTask.fail("تنظیمات گیت‌هاب ناقص است");
    if (!silent) alert("ابتدا تنظیمات گیت‌هاب (مالک / ریپو / توکن) را کامل کنید.");
    return { ok: false, message: "تنظیمات گیت‌هاب ناقص است" };
  }

  const invs = store.getInvoices();
  const pfs = store.getProformas();
  const custs = store.getCustomers();
  const prods = store.getProducts();

  currentTask.update(12, "بررسی سد ضد تخریب داده‌ها...");
  // 🛡️ سد امنیتی ضد تخریب: اگر محصولات لوکال خالی باشد اما در ریپو دیتا وجود داشته باشد
  if (prods.length === 0) {
    const remoteData = await checkRemotePublicData(cfg);
    if (remoteData.hasData) {
      currentTask.fail("سد ضد تخریب: پوش لغو شد");
      if (!silent) {
        const shouldRestore = confirm(
          "⛔ عملیات متوقف شد (سد امنیتی ضد تخریب)!\n\n" +
            `حافظه این مرورگر فاقد اطلاعات محصول است، در حالی که در مخزن گیت‌هاب ${remoteData.productCount} محصول وجود دارد.\n` +
            "ارسال لغو شد تا دیتای سرور و سایت مشتری با اطلاعات خالی جایگزین نشود.\n\n" +
            "📥 آیا مایلید اطلاعات محصولات موجود در مخزن هم‌اکنون در این سیستم بازیابی شوند؟",
        );
        if (shouldRestore) {
          if (remoteData.products && remoteData.products.length > 0) {
            store.setProducts(remoteData.products);
          }
          if (remoteData.categories && remoteData.categories.length > 0) {
            store.setProductCategories(remoteData.categories);
          }
          if (typeof window.renderProducts === "function") window.renderProducts();
          if (typeof window.renderCategoryChips === "function") window.renderCategoryChips();
          alert("✅ اطلاعات محصولات با موفقیت از مخزن بازیابی شد.");
        }
      } else {
        ghToast("⚠️ سد ضد تخریب: دیتای محلی خالی است؛ پوش لغو شد تا اطلاعات مخزن پاک نشود");
      }
      return {
        ok: false,
        blockedByGuard: true,
        message: "داده‌های محصولات در حافظه محلی خالی است در حالی که مخزن حاوی اطلاعات است؛ پوش لغو شد.",
      };
    }
  }

  if (invs.length === 0 && pfs.length === 0 && custs.length === 0 && prods.length === 0) {
    currentTask.fail("داده‌های محلی خالی است");
    if (!silent) {
      alert(
        "⛔ عملیات متوقف شد (سد امنیتی ضد تخریب)!\n\n" +
          "حافظه این مرورگر در حال حاضر خالی است.\n" +
          "اگر قصد بازیابی دارید، روی «⬇️ بازیابی از گیت‌هاب» بزنید.",
      );
    }
    return { ok: false, message: "داده‌های محلی خالی است؛ عملیات لغو شد." };
  }

  try {
    currentTask.update(22, "آماده‌سازی فایل‌های داده...");
    const backupFiles = collectBackupFiles();
    const publicFiles = collectPublicFiles();
    const files = [...backupFiles, ...publicFiles];
    const branch = cfg.branch || "main";

    let latestSha = null;
    let baseTree = null;
    let existingPaths = new Set();

    currentTask.update(30, "واکشی شاخه اصلی...");
    try {
      const ref = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${branch}`,
        cfg,
      );
      latestSha = ref.object.sha;
      const lastCommit = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/commits/${latestSha}`,
        cfg,
      );
      baseTree = lastCommit.tree.sha;

      let remoteFileShas = new Map();
      try {
        const treeData = await gh(
          `/repos/${cfg.owner}/${cfg.repo}/git/trees/${baseTree}?recursive=1`,
          cfg,
        );
        if (Array.isArray(treeData?.tree)) {
          existingPaths = new Set(treeData.tree.map((t) => t.path));
          remoteFileShas = new Map(treeData.tree.map((t) => [t.path, t.sha]));
        }
      } catch {}
    } catch {
      await gh(`/repos/${cfg.owner}/${cfg.repo}/contents/data/init.json`, cfg, {
        method: "PUT",
        body: JSON.stringify({
          message: "🌱 راه‌اندازی پوشه دیتا",
          content: toBase64(
            JSON.stringify(
              { initializedAt: new Date().toISOString() },
              null,
              2,
            ),
          ),
          branch,
        }),
      });

      const ref = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${branch}`,
        cfg,
      );
      latestSha = ref.object.sha;
      const lastCommit = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/commits/${latestSha}`,
        cfg,
      );
      baseTree = lastCommit.tree.sha;
    }

    currentTask.update(35, "بررسی و تفکیک فایل‌های دارای داده جدید...");
    const filesToSend = baseTree ? await filterOnlyChangedFiles(files, remoteFileShas) : files;

    // اگر هیچ فایلی دیتای جدیدی نداشته باشد، نیازی به ارسال بیهوده نیست
    if (baseTree && filesToSend.length === 0) {
      currentTask.complete("تمامی اطلاعات با گیت‌هاب همگام است (داده جدیدی برای ارسال وجود ندارد) ✅");
      return { ok: true, noChanges: true, message: "تمامی اطلاعات همگام هستند" };
    }

    const treeItems = [];
    for (let i = 0; i < filesToSend.length; i++) {
      const f = filesToSend[i];
      const p = Math.round(35 + ((i + 1) / filesToSend.length) * 45);
      currentTask.update(p, `ارسال دیتای جدید (${i + 1} از ${filesToSend.length}: ${f.path})...`);
      const blob = await gh(`/repos/${cfg.owner}/${cfg.repo}/git/blobs`, cfg, {
        method: "POST",
        body: JSON.stringify({
          content: toBase64(f.content),
          encoding: "base64",
        }),
      });
      treeItems.push({
        path: f.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    const privateFilesToDelete = [
      "data/customers.json",
      "data/invoices.json",
      "data/proformas.json",
    ];

    for (const privPath of privateFilesToDelete) {
      if (existingPaths.has(privPath)) {
        treeItems.push({
          path: privPath,
          mode: "100644",
          type: "blob",
          sha: null,
        });
      }
    }

    currentTask.update(82, "ایجاد ساختار درختی (Tree)...");
    const tree = await gh(`/repos/${cfg.owner}/${cfg.repo}/git/trees`, cfg, {
      method: "POST",
      body: JSON.stringify(
        baseTree
          ? { base_tree: baseTree, tree: treeItems }
          : { tree: treeItems },
      ),
    });

    currentTask.update(89, "ثبت کامیت در ریپازیتوری...");
    const changedLabels = filesToSend
      .filter((f) => !f.path.endsWith("meta.json"))
      .map((f) => {
        const name = f.path.split("/").pop().replace(".json", "");
        if (name === "invoices") return "فاکتورها";
        if (name === "proformas") return "پیش‌فاکتورها";
        if (name === "products") return "محصولات";
        if (name === "product-categories") return "دسته‌بندی‌ها";
        if (name === "customers") return "مشتریان";
        if (name === "announcements") return "اعلانات";
        return name;
      });
    const uniqueLabels = Array.from(new Set(changedLabels)).join("، ") || "اطلاعات جدید";
    const message = `📤 بروزرسانی دیتای جدید (${uniqueLabels}) — ${new Date().toLocaleString("fa-IR")}`;
    const commit = await gh(
      `/repos/${cfg.owner}/${cfg.repo}/git/commits`,
      cfg,
      {
        method: "POST",
        body: JSON.stringify(
          latestSha
            ? { message, tree: tree.sha, parents: [latestSha] }
            : { message, tree: tree.sha },
        ),
      },
    );

    currentTask.update(95, "نهایی‌سازی شاخه در گیت‌هاب...");
    if (latestSha) {
      await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${branch}`,
        cfg,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: commit.sha, force: true }),
        },
      );
    } else {
      await gh(`/repos/${cfg.owner}/${cfg.repo}/git/refs`, cfg, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
      });
    }

    const now = Date.now();
    store.saveSettings({
      ...store.getSettings(),
      lastPush: { at: now, ok: true },
      lastPublicPush: { at: now, ok: true },
    });
    triggerLocalBackupOnPush();
    if (!task) currentTask.complete("با موفقیت روی گیت‌هاب ذخیره شد ✅");
    if (!silent) alert("پشتیبان و دیتای عمومی با موفقیت روی گیت‌هاب push شد ✅");
    return { ok: true, sha: commit.sha };
  } catch (err) {
    currentTask.fail(err.message);
    const now = Date.now();
    store.saveSettings({
      ...store.getSettings(),
      lastPush: { at: now, ok: false, error: err.message },
      lastPublicPush: { at: now, ok: false, error: err.message },
    });
    if (!silent) alert("همگام‌سازی گیت‌هاب ناموفق بود ❌\n" + err.message);
    return { ok: false, message: err.message };
  }
}

export async function pushBackupToGitHub({
  silent = false,
  task = null,
  title = "پشتیبان‌گیری در گیت‌هاب",
} = {}) {
  const currentTask = task || startPushTask(title, "بررسی اطلاعات اتصال به گیت‌هاب...");
  const cfg = getGitHubConfig();
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    currentTask.fail("تنظیمات گیت‌هاب ناقص است");
    if (!silent)
      alert("ابتدا تنظیمات گیت‌هاب (مالک / ریپو / توکن) را کامل کنید.");
    return { ok: false };
  }

  const invs = store.getInvoices();
  const pfs = store.getProformas();
  const custs = store.getCustomers();
  const prods = store.getProducts();
  const customSrv = store.getCustomServices();

  currentTask.update(12, "بررسی سد ضد تخریب داده‌ها...");
  // 🛡️ سد امنیتی ضد تخریب: اگر محصولات لوکال خالی باشد اما در ریپو دیتای محصولات وجود داشته باشد
  if (prods.length === 0) {
    const remoteData = await checkRemotePublicData(cfg);
    if (remoteData.hasData) {
      currentTask.fail("سد ضد تخریب: پوش لغو شد");
      if (!silent) {
        const shouldRestore = confirm(
          "⛔ عملیات متوقف شد (سد امنیتی ضد تخریب بک‌آپ)!\n\n" +
            `حافظه این مرورگر فاقد اطلاعات محصول است، در حالی که در مخزن گیت‌هاب ${remoteData.productCount} محصول وجود دارد.\n` +
            "ارسال بک‌آپ لغو شد تا اطلاعات محصولات پاک نشود.\n\n" +
            "📥 آیا مایلید اطلاعات موجود در مخزن هم‌اکنون بازیابی شوند؟",
        );
        if (shouldRestore) {
          if (remoteData.products && remoteData.products.length > 0) {
            store.setProducts(remoteData.products);
          }
          if (remoteData.categories && remoteData.categories.length > 0) {
            store.setProductCategories(remoteData.categories);
          }
          if (typeof window.renderProducts === "function") window.renderProducts();
          if (typeof window.renderCategoryChips === "function") window.renderCategoryChips();
          alert("✅ محصولات با موفقیت بازیابی شدند.");
        }
      } else {
        ghToast("⚠️ سد ضد تخریب: دیتای محلی خالی است؛ پوش لغو شد تا دیتای سرور با خالی جایگزین نشود");
      }
      return {
        ok: false,
        blockedByGuard: true,
        message: "داده‌های محصولات در حافظه محلی خالی است در حالی که مخزن حاوی اطلاعات است؛ پوش لغو شد.",
      };
    }
  }

  if (invs.length === 0 && pfs.length === 0 && custs.length === 0 && prods.length === 0) {
    currentTask.fail("داده‌های محلی خالی است");
    if (!silent) {
      alert(
        "⛔ عملیات متوقف شد (سد امنیتی ضد تخریب)!\n\n" +
          "حافظه این مرورگر در حال حاضر خالی است.\n" +
          "اگر قصد بازیابی دارید، روی «⬇️ بازیابی از گیت‌هاب» بزنید.",
      );
    }
    return { ok: false, message: "داده‌های محلی خالی است؛ عملیات لغو شد." };
  }

  if (!silent) {
    const srvCount =
      (customSrv?.newCategories?.length || 0) +
      Object.keys(customSrv?.categoryOverrides || {}).length;

    const confirmMsg =
      "☁️ تأیید ارسال پشتیبان به گیت‌هاب:\n\n" +
      `آیا مطمئن هستید که می‌خواهید نسخه فعلی سیستم روی مخزن «${cfg.repo}» ذخیره شود؟\n\n` +
      `📊 اطلاعات:\n` +
      `• فاکتورها: ${invs.length} عدد\n` +
      `• پیش‌فاکتورها: ${pfs.length} عدد\n` +
      `• مشتریان: ${custs.length} نفر\n` +
      `• محصولات: ${prods.length} مورد\n` +
      `• دسته‌های محصولات: ${store.getProductCategories().length} مورد\n` +
      `• خدمات سفارشی: ${srvCount} مورد\n\n` +
      "برای تأیید، OK را بزنید.";

    if (!confirm(confirmMsg)) {
      currentTask.fail("عملیات لغو شد");
      return { ok: false, message: "لغو توسط کاربر" };
    }
  }

  try {
    currentTask.update(22, "آماده‌سازی فایل‌های پشتیبان...");
    const files = collectBackupFiles();
    const branch = cfg.branch || "main";

    let latestSha = null;
    let baseTree = null;
    currentTask.update(30, "واکشی شاخه اصلی...");
    try {
      const ref = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${branch}`,
        cfg,
      );
      latestSha = ref.object.sha;
      const lastCommit = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/commits/${latestSha}`,
        cfg,
      );
      baseTree = lastCommit.tree.sha;
    } catch {
      await gh(
        `/repos/${cfg.owner}/${cfg.repo}/contents/backup/init.json`,
        cfg,
        {
          method: "PUT",
          body: JSON.stringify({
            message: "🌱 راه‌اندازی پوشه بک‌آپ",
            content: toBase64(
              JSON.stringify(
                { initializedAt: new Date().toISOString() },
                null,
                2,
              ),
            ),
            branch,
          }),
        },
      );
      const ref = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${branch}`,
        cfg,
      );
      latestSha = ref.object.sha;
      const lastCommit = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/commits/${latestSha}`,
        cfg,
      );
      baseTree = lastCommit.tree.sha;
    }

    let remoteFileShas = new Map();
    if (baseTree) {
      try {
        const treeData = await gh(
          `/repos/${cfg.owner}/${cfg.repo}/git/trees/${baseTree}?recursive=1`,
          cfg,
        );
        if (Array.isArray(treeData?.tree)) {
          remoteFileShas = new Map(treeData.tree.map((t) => [t.path, t.sha]));
        }
      } catch (_) {}
    }

    currentTask.update(35, "بررسی و تفکیک فایل‌های دارای داده جدید...");
    const filesToSend = baseTree ? await filterOnlyChangedFiles(files, remoteFileShas) : files;

    if (baseTree && filesToSend.length === 0) {
      currentTask.complete("پشتیبان با گیت‌هاب همگام است (داده جدیدی برای ارسال وجود ندارد) ✅");
      return { ok: true, noChanges: true, message: "پشتیبان همگام است" };
    }

    const treeItems = [];
    for (let i = 0; i < filesToSend.length; i++) {
      const f = filesToSend[i];
      const p = Math.round(35 + ((i + 1) / filesToSend.length) * 45);
      currentTask.update(p, `ارسال دیتای جدید (${i + 1} از ${filesToSend.length}: ${f.path})...`);
      const blob = await gh(`/repos/${cfg.owner}/${cfg.repo}/git/blobs`, cfg, {
        method: "POST",
        body: JSON.stringify({
          content: toBase64(f.content),
          encoding: "base64",
        }),
      });
      treeItems.push({
        path: f.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    // دریافت مجدد آخرین وضعیت شاخه جهت جلوگیری از تداخل و بازنویسی کامیت‌های کد
    try {
      const freshRef = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${branch}`,
        cfg,
      );
      if (freshRef?.object?.sha) {
        latestSha = freshRef.object.sha;
        const freshCommit = await gh(
          `/repos/${cfg.owner}/${cfg.repo}/git/commits/${latestSha}`,
          cfg,
        );
        if (freshCommit?.tree?.sha) {
          baseTree = freshCommit.tree.sha;
        }
      }
    } catch {}

    currentTask.update(82, "ایجاد ساختار درختی (Tree)...");
    const tree = await gh(`/repos/${cfg.owner}/${cfg.repo}/git/trees`, cfg, {
      method: "POST",
      body: JSON.stringify(
        baseTree
          ? { base_tree: baseTree, tree: treeItems }
          : { tree: treeItems },
      ),
    });

    currentTask.update(89, "ثبت کامیت در ریپازیتوری...");
    const changedLabels = filesToSend
      .filter((f) => !f.path.endsWith("meta.json"))
      .map((f) => {
        const name = f.path.split("/").pop().replace(".json", "");
        if (name === "invoices") return "فاکتورها";
        if (name === "proformas") return "پیش‌فاکتورها";
        if (name === "products") return "محصولات";
        if (name === "product-categories") return "دسته‌بندی‌ها";
        if (name === "customers") return "مشتریان";
        return name;
      });
    const uniqueLabels = Array.from(new Set(changedLabels)).join("، ") || "پشتیبان";
    const message = `📥 بروزرسانی دیتای جدید (${uniqueLabels}) — ${new Date().toLocaleString("fa-IR")}`;
    const commit = await gh(
      `/repos/${cfg.owner}/${cfg.repo}/git/commits`,
      cfg,
      {
        method: "POST",
        body: JSON.stringify(
          latestSha
            ? { message, tree: tree.sha, parents: [latestSha] }
            : { message, tree: tree.sha },
        ),
      },
    );

    currentTask.update(95, "نهایی‌سازی شاخه در گیت‌هاب...");
    if (latestSha) {
      await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${branch}`,
        cfg,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: commit.sha, force: true }),
        },
      );
    } else {
      await gh(`/repos/${cfg.owner}/${cfg.repo}/git/refs`, cfg, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
      });
    }

    store.saveSettings({
      ...store.getSettings(),
      lastPush: { at: Date.now(), ok: true },
    });
    triggerLocalBackupOnPush();
    if (!task) currentTask.complete("پشتیبان‌گیری با موفقیت انجام شد ✅");
    if (!silent) alert("پشتیبان با موفقیت روی گیت‌هاب push شد ✅");
    return { ok: true, sha: commit.sha };
  } catch (err) {
    currentTask.fail(err.message);
    store.saveSettings({
      ...store.getSettings(),
      lastPush: { at: Date.now(), ok: false, error: err.message },
    });
    if (!silent) alert("push به گیت‌هاب ناموفق بود ❌\n" + err.message);
    return { ok: false, message: err.message };
  }
}

export async function pushToPublicRepo({
  silent = false,
  task = null,
  title = "ارسال به پورتال مشتری",
} = {}) {
  const currentTask = task || startPushTask(title, "بررسی اطلاعات پورتال مشتری...");
  const cfg = getPublicRepoConfig();

  if (!cfg.owner || !cfg.repo || !cfg.token) {
    currentTask.fail("تنظیمات ریپوی پابلیک ناقص است");
    if (!silent) {
      alert("ابتدا تنظیمات ریپوی پابلیک (مالک / ریپو / توکن) را کامل کنید.");
    }
    return { ok: false, message: "تنظیمات ریپوی پابلیک ناقص است" };
  }

  const prods = store.getProducts();

  currentTask.update(12, "بررسی سد ضد تخریب...");
  // 🛡️ سد امنیتی ضد تخریب ریپوی پابلیک: اگر لوکال خالی باشد و در ریپوی پابلیک دیتا باشد
  if (prods.length === 0) {
    const remoteData = await checkRemotePublicData(cfg);
    if (remoteData.hasData) {
      currentTask.fail("سد ضد تخریب: پوش لغو شد");
      if (!silent) {
        const shouldRestore = confirm(
          "⛔ عملیات متوقف شد (سد امنیتی ضد تخریب ریپوی پابلیک)!\n\n" +
            `حافظه این مرورگر فاقد اطلاعات محصول است، در حالی که در ریپوی پابلیک ${remoteData.productCount} محصول وجود دارد.\n` +
            "جهت محافظت از دیتای سایت مشتری و جلوگیری از جایگزین شدن دیتای خالی، ارسال لغو شد.\n\n" +
            "📥 آیا مایلید اطلاعات محصولات موجود در مخزن هم‌اکنون در این سیستم بازیابی شوند؟",
        );
        if (shouldRestore) {
          if (remoteData.products && remoteData.products.length > 0) {
            store.setProducts(remoteData.products);
          }
          if (remoteData.categories && remoteData.categories.length > 0) {
            store.setProductCategories(remoteData.categories);
          }
          if (typeof window.renderProducts === "function") window.renderProducts();
          if (typeof window.renderCategoryChips === "function") window.renderCategoryChips();
          alert("✅ اطلاعات محصولات با موفقیت از ریپوی پابلیک دریافت و ذخیره شد.");
        }
      } else {
        ghToast("⚠️ سد ضد تخریب: دیتای محلی خالی است؛ پوش پابلیک لغو شد تا دیتای سرور پاک نشود");
      }
      return {
        ok: false,
        blockedByGuard: true,
        message: "داده‌های محلی خالی است در حالی که مخزن پابلیک حاوی اطلاعات است؛ پوش لغو شد.",
      };
    } else {
      currentTask.fail("هیچ محصولی یافت نشد");
      if (!silent) {
        alert(
          "⚠️ هیچ محصولی در حافظه محلی برای ارسال وجود ندارد.\n\n" +
            "ابتدا در سیستم محصول تعریف کنید، سپس اقدام به ارسال نمایید.",
        );
      }
      return { ok: false, message: "هیچ محصولی در حافظه محلی یافت نشد." };
    }
  }

  if (!silent) {
    const ok = confirm(
      "🌐 تأیید ارسال اطلاعات به ریپوی پابلیک (سایت مشتری):\n\n" +
        "آیا مایلید اطلاعات محصولات، دسته‌بندی‌ها و خدمات روی سایت مشتری به‌روزرسانی شوند؟",
    );
    if (!ok) {
      currentTask.fail("عملیات لغو شد");
      return { ok: false, message: "لغو توسط کاربر" };
    }
  }

  if (!cfg.enabled && !cfg.repo) {
    if (!silent) {
      cfg.enabled = true;
      savePublicRepoConfig(cfg);
      const pubEnabledEl = document.getElementById("pub-gh-enabled");
      if (pubEnabledEl) pubEnabledEl.checked = true;
    } else {
      currentTask.fail("ریپوی پابلیک فعال نیست");
      return { ok: false, message: "ریپوی پابلیک فعال نیست" };
    }
  }

  try {
    currentTask.update(22, "آماده‌سازی فایل‌های عمومی...");
    const files = collectPublicFiles();
    const branch = cfg.branch || "main";

    let latestSha = null;
    let baseTree = null;
    let existingPaths = new Set();

    currentTask.update(30, "واکشی شاخه اصلی...");
    try {
      const ref = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${branch}`,
        cfg,
      );
      latestSha = ref.object.sha;
      const lastCommit = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/commits/${latestSha}`,
        cfg,
      );
      baseTree = lastCommit.tree.sha;

      let remoteFileShas = new Map();
      try {
        const treeData = await gh(
          `/repos/${cfg.owner}/${cfg.repo}/git/trees/${baseTree}?recursive=1`,
          cfg,
        );
        if (Array.isArray(treeData?.tree)) {
          existingPaths = new Set(treeData.tree.map((t) => t.path));
          remoteFileShas = new Map(treeData.tree.map((t) => [t.path, t.sha]));
        }
      } catch {}
    } catch {
      await gh(`/repos/${cfg.owner}/${cfg.repo}/contents/data/init.json`, cfg, {
        method: "PUT",
        body: JSON.stringify({
          message: "🌱 راه‌اندازی پوشه دیتا",
          content: toBase64(
            JSON.stringify(
              { initializedAt: new Date().toISOString() },
              null,
              2,
            ),
          ),
          branch,
        }),
      });

      const ref = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${branch}`,
        cfg,
      );
      latestSha = ref.object.sha;
      const lastCommit = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/commits/${latestSha}`,
        cfg,
      );
      baseTree = lastCommit.tree.sha;
    }

    currentTask.update(35, "بررسی و تفکیک فایل‌های دارای داده جدید عمومی...");
    const filesToSend = baseTree ? await filterOnlyChangedFiles(files, remoteFileShas) : files;

    if (baseTree && filesToSend.length === 0) {
      currentTask.complete("داده‌های عمومی با گیت‌هاب همگام هستند (داده جدیدی برای ارسال وجود ندارد) ✅");
      return { ok: true, noChanges: true, message: "داده‌های عمومی همگام هستند" };
    }

    const treeItems = [];
    for (let i = 0; i < filesToSend.length; i++) {
      const f = filesToSend[i];
      const p = Math.round(35 + ((i + 1) / filesToSend.length) * 45);
      currentTask.update(p, `ارسال دیتای جدید عمومی (${i + 1} از ${filesToSend.length}: ${f.path})...`);
      const blob = await gh(`/repos/${cfg.owner}/${cfg.repo}/git/blobs`, cfg, {
        method: "POST",
        body: JSON.stringify({
          content: toBase64(f.content),
          encoding: "base64",
        }),
      });
      treeItems.push({
        path: f.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    const privateFilesToDelete = [
      "data/customers.json",
      "data/invoices.json",
      "data/proformas.json",
      "backup/customers.json",
      "backup/invoices.json",
      "backup/proformas.json",
    ];

    for (const privPath of privateFilesToDelete) {
      if (existingPaths.has(privPath)) {
        treeItems.push({
          path: privPath,
          mode: "100644",
          type: "blob",
          sha: null,
        });
      }
    }

    // دریافت مجدد آخرین وضعیت شاخه جهت جلوگیری از تداخل و بازنویسی کامیت‌های کد
    try {
      const freshRef = await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${branch}`,
        cfg,
      );
      if (freshRef?.object?.sha) {
        latestSha = freshRef.object.sha;
        const freshCommit = await gh(
          `/repos/${cfg.owner}/${cfg.repo}/git/commits/${latestSha}`,
          cfg,
        );
        if (freshCommit?.tree?.sha) {
          baseTree = freshCommit.tree.sha;
        }
      }
    } catch {}

    currentTask.update(82, "ایجاد ساختار درختی (Tree)...");
    const tree = await gh(`/repos/${cfg.owner}/${cfg.repo}/git/trees`, cfg, {
      method: "POST",
      body: JSON.stringify(
        baseTree
          ? { base_tree: baseTree, tree: treeItems }
          : { tree: treeItems },
      ),
    });

    currentTask.update(89, "ثبت کامیت در ریپازیتوری...");
    const changedLabels = filesToSend
      .filter((f) => !f.path.endsWith("meta.json"))
      .map((f) => {
        const name = f.path.split("/").pop().replace(".json", "");
        if (name === "products") return "محصولات";
        if (name === "product-categories") return "دسته‌بندی‌ها";
        if (name === "announcements") return "اعلانات";
        if (name === "shop-info") return "اطلاعات فروشگاه";
        return name;
      });
    const uniqueLabels = Array.from(new Set(changedLabels)).join("، ") || "داده‌های عمومی";
    const message = `📤 بروزرسانی دیتای جدید عمومی (${uniqueLabels}) — ${new Date().toLocaleString("fa-IR")}`;
    const commit = await gh(
      `/repos/${cfg.owner}/${cfg.repo}/git/commits`,
      cfg,
      {
        method: "POST",
        body: JSON.stringify(
          latestSha
            ? { message, tree: tree.sha, parents: [latestSha] }
            : { message, tree: tree.sha },
        ),
      },
    );

    currentTask.update(95, "نهایی‌سازی شاخه عمومی...");
    if (latestSha) {
      await gh(
        `/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${branch}`,
        cfg,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: commit.sha, force: true }),
        },
      );
    } else {
      await gh(`/repos/${cfg.owner}/${cfg.repo}/git/refs`, cfg, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
      });
    }

    store.saveSettings({
      ...store.getSettings(),
      lastPublicPush: { at: Date.now(), ok: true },
    });
    triggerLocalBackupOnPush();
    if (!task) currentTask.complete("پورتال مشتری با موفقیت به‌روزرسانی شد ✅");
    if (!silent) alert("اطلاعات با موفقیت روی ریپوی پابلیک push شد ✅");
    return { ok: true, sha: commit.sha };
  } catch (err) {
    currentTask.fail(err.message);
    store.saveSettings({
      ...store.getSettings(),
      lastPublicPush: { at: Date.now(), ok: false, error: err.message },
    });
    if (!silent) alert("push به ریپوی پابلیک ناموفق بود ❌\n" + err.message);
    return { ok: false, message: err.message };
  }
}

export async function testGitHubConnection() {
  const cfg = getGitHubConfig();
  if (!cfg.token || !cfg.owner || !cfg.repo)
    return alert("ابتدا مالک، ریپو و توکن ریپوی بک‌آپ را وارد کنید.");
  try {
    const repo = await gh(`/repos/${cfg.owner}/${cfg.repo}`, cfg);
    alert(
      `اتصال به ریپوی بک‌آپ موفق بود ✅\nریپو: ${repo.full_name}\nنوع: ${repo.private ? "خصوصی (Private)" : "عمومی (Public)"}\nشاخه پیش‌فرض: ${repo.default_branch}`,
    );
    return true;
  } catch (err) {
    alert("اتصال ناموفق ❌\n" + err.message);
    return false;
  }
}

export async function testPublicGitHubConnection() {
  const cfg = getPublicRepoConfig();
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    alert("ابتدا مالک، ریپو و توکن ریپوی پابلیک را وارد کنید.");
    return false;
  }
  try {
    const repo = await gh(`/repos/${cfg.owner}/${cfg.repo}`, cfg);
    const repoStatus = repo.private
      ? "خصوصی (Private) ⚠️"
      : "عمومی (Public) ✅";
    alert(
      `اتصال به ریپوی پابلیک موفق بود ✅\n` +
        `نام کامل ریپو: ${repo.full_name}\n` +
        `وضعیت دسترسی: ${repoStatus}\n` +
        `شاخه پیش‌فرض: ${repo.default_branch}`,
    );
    return true;
  } catch (err) {
    alert("اتصال به ریپوی پابلیک ناموفق بود ❌\n" + err.message);
    return false;
  }
}

export async function restoreFromGitHub({ replace = false } = {}) {
  const cfg = getGitHubConfig();
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    return alert("ابتدا تنظیمات گیت‌هاب (مالک / ریپو / توکن) را کامل کن.");
  }

  try {
    const branch = encodeURIComponent(cfg.branch || "main");

    const readJson = async (path) => {
      try {
        const res = await gh(
          `/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${branch}`,
          cfg,
        );
        return JSON.parse(fromBase64(res.content));
      } catch {
        return null;
      }
    };

    const invoices = await readJson("backup/invoices.json");
    const proformas = await readJson("backup/proformas.json");
    let products = await readJson("backup/products.json");
    let productCategories = await readJson("backup/product-categories.json"); // ✅ خواندن دسته‌های محصول از بک‌آپ
    let announcements = await readJson("backup/announcements.json"); // ✅ خواندن اخبار و اعلانات
    const shop = await readJson("backup/shop-info.json");
    const customers = await readJson("backup/customers.json");
    const customServices = await readJson("backup/custom-services.json");
    const services = await readJson("backup/services.json");

    // اگر در پوشه backup فایل محصولات یا دسته‌بندی‌ها نبود، از data/ بخوان
    if (!products || (Array.isArray(products) && products.length === 0)) {
      products = await readJson("data/products.json");
    }
    if (!productCategories || (Array.isArray(productCategories) && productCategories.length === 0)) {
      productCategories = await readJson("data/product-categories.json");
    }
    if (!announcements || (Array.isArray(announcements) && announcements.length === 0)) {
      announcements = await readJson("data/announcements.json");
    }

    if (!invoices && !proformas && !products && !shop && !customServices && !services && !announcements) {
      return alert("هیچ فایل پشتیبانی در پوشه backup/ یا data/ مخزن پیدا نشد!");
    }

    const invCount = Array.isArray(invoices) ? invoices.length : 0;
    const pfCount = Array.isArray(proformas) ? proformas.length : 0;
    const prdCount = Array.isArray(products) ? products.length : 0;
    const pCatCount = Array.isArray(productCategories)
      ? productCategories.length
      : 0;
    const cstCount = Array.isArray(customers) ? customers.length : 0;
    const annCount = Array.isArray(announcements) ? announcements.length : 0;
    const srvCount =
      (customServices?.newCategories?.length || 0) +
      Object.keys(customServices?.categoryOverrides || {}).length;

    if (
      !confirm(
        `📥 بازیابی از گیت‌هاب:\n` +
          `• ${invCount} فاکتور\n` +
          `• ${pfCount} پیش‌فاکتور\n` +
          `• ${prdCount} محصول در ${pCatCount} دسته‌بندی\n` +
          `• ${cstCount} مشتری\n` +
          `• ${annCount} اعلان و خبر\n` +
          `• ${srvCount} دسته‌بندی و خدمات سفارشی\n\n` +
          `حالت بازیابی: ${replace ? "⚠️ جایگزینی کامل" : "➕ ادغام بدون تکراری"}\n` +
          `ادامه می‌دهید؟`,
      )
    )
      return;

    // بازیابی دسته‌بندی محصولات
    if (Array.isArray(productCategories)) {
      if (replace) {
        store.setProductCategories(productCategories);
      } else {
        const current = store.getProductCategories();
        const ids = new Set(current.map((c) => c.id));
        const added = productCategories.filter(
          (c) => c && c.id && !ids.has(c.id),
        );
        store.setProductCategories([...current, ...added]);
      }
    }

    // بازیابی اخبار و اعلانات
    if (Array.isArray(announcements)) {
      if (replace) {
        store.setAnnouncements(announcements);
      } else {
        const current = store.getAnnouncements();
        const ids = new Set(current.map((a) => a.id));
        const added = announcements.filter((a) => a && a.id && !ids.has(a.id));
        store.setAnnouncements([...current, ...added]);
      }
    }

    // بازیابی خدمات جدید و سفارشی
    if (customServices && typeof customServices === "object") {
      if (replace) {
        store.saveCustomServices(customServices);
      } else {
        const current = store.getCustomServices();
        const currentNewCatIds = new Set(
          (current.newCategories || []).map((c) => c.id),
        );
        const addedNewCats = (customServices.newCategories || []).filter(
          (c) => c && !currentNewCatIds.has(c.id),
        );
        const mergedNewCategories = [
          ...(current.newCategories || []),
          ...addedNewCats,
        ];
        const mergedOverrides = {
          ...(current.categoryOverrides || {}),
          ...(customServices.categoryOverrides || {}),
        };
        store.saveCustomServices({
          newCategories: mergedNewCategories,
          categoryOverrides: mergedOverrides,
        });
      }
    }

    // بازیابی مشتریان
    if (Array.isArray(customers)) {
      if (replace) {
        store.saveCustomers(customers);
      } else {
        const current = store.getCustomers();
        const phones = new Set(current.map((c) => c.phone).filter(Boolean));
        const added = customers.filter(
          (c) => c && (!c.phone || !phones.has(c.phone)),
        );
        store.saveCustomers([...current, ...added]);
      }
    }

    // بازیابی فاکتورها
    if (Array.isArray(invoices)) {
      if (replace) {
        store.setInvoices(invoices);
      } else {
        const current = store.getInvoices();
        const existing = new Set(current.map((i) => i.number));
        const added = invoices.filter((i) => i && !existing.has(i.number));
        store.setInvoices(
          [...current, ...added].sort((a, b) => b.number - a.number),
        );
      }
    }

    // بازیابی پیش‌فاکتورها
    if (Array.isArray(proformas)) {
      if (replace) {
        store.setProformas(proformas);
      } else {
        const current = store.getProformas();
        const existing = new Set(current.map((p) => p.number));
        const added = proformas.filter((p) => p && !existing.has(p.number));
        store.setProformas(
          [...current, ...added].sort((a, b) => b.number - a.number),
        );
      }
    }

    // بازیابی محصولات
    if (Array.isArray(products)) {
      if (replace) {
        store.setProducts(products);
      } else {
        const current = store.getProducts();
        const ids = new Set(current.map((p) => p.id));
        store.setProducts([
          ...current,
          ...products.filter((p) => p && !ids.has(p.id)),
        ]);
      }
    }

    // اطلاعات فروشگاه
    if (shop && typeof shop === "object") {
      store.saveShopInfo({ ...store.getShopInfo(), ...shop });
    }

    const maxNum = store
      .getInvoices()
      .reduce((m, i) => Math.max(m, i.number || 0), 0);
    if (maxNum > store.getCounter()) store.setCounter(maxNum);

    const maxPfNum = store
      .getProformas()
      .reduce((m, p) => Math.max(m, p.number || 0), 0);
    if (maxPfNum > store.getProformaCounter()) store.setProformaCounter(maxPfNum);

    alert("✅ بازیابی اطلاعات با موفقیت انجام شد. برنامه تازه می‌شود…");
    const u = new URL(window.location.href);
    u.searchParams.set("_reload", Date.now().toString());
    window.location.replace(u.toString());
  } catch (err) {
    alert("بازیابی از گیت‌هاب ناموفق بود ❌\n" + err.message);
  }
}

export function initGitHubUI() {
  const $ = (id) => document.getElementById(id);
  if (!$("gh-owner")) return;

  const backupCfg = getBackupRepoConfig();
  $("gh-owner").value = backupCfg.owner || "";
  $("gh-repo").value = backupCfg.repo || "";
  $("gh-branch").value = backupCfg.branch || "main";
  $("gh-token").value = backupCfg.token || "";
  $("gh-autopush").checked = backupCfg.autoPush !== false;

  const publicCfg = getPublicRepoConfig();
  const pubOwnerEl = $("pub-gh-owner");
  const pubRepoEl = $("pub-gh-repo");
  const pubBranchEl = $("pub-gh-branch");
  const pubTokenEl = $("pub-gh-token");
  const pubEnabledEl = $("pub-gh-enabled");

  if (pubOwnerEl) pubOwnerEl.value = publicCfg.owner || "";
  if (pubRepoEl) pubRepoEl.value = publicCfg.repo || "";
  if (pubBranchEl) pubBranchEl.value = publicCfg.branch || "main";
  if (pubTokenEl) pubTokenEl.value = publicCfg.token || "";
  if (pubEnabledEl) pubEnabledEl.checked = publicCfg.enabled === true;

  const updateStatus = () => {
    const s = store.getSettings().lastPush;
    const el = $("gh-status");
    if (!el) return;
    if (!s) {
      el.textContent = "هنوز هیچ پشتیبانی push نشده است.";
      el.className = "text-xs text-slate-400";
      return;
    }
    el.textContent = s.ok
      ? `✅ آخرین push موفق: ${new Date(s.at).toLocaleString("fa-IR")}`
      : `❌ آخرین push ناموفق: ${s.error || "خطای ناشناخته"}`;
    el.className = s.ok
      ? "text-xs text-emerald-500 dark:text-emerald-400 font-bold"
      : "text-xs text-rose-500 dark:text-rose-400 font-bold";
  };

  const updatePublicStatus = () => {
    const s = store.getSettings().lastPublicPush;
    const el = $("pub-gh-status");
    if (!el) return;
    if (!s) {
      el.textContent = "هنوز هیچ دیتایی به ریپوی پابلیک push نشده است.";
      el.className = "text-xs text-slate-400";
      return;
    }
    el.textContent = s.ok
      ? `✅ آخرین push موفق: ${new Date(s.at).toLocaleString("fa-IR")}`
      : `❌ آخرین push ناموفق: ${s.error || "خطای ناشناخته"}`;
    el.className = s.ok
      ? "text-xs text-emerald-500 dark:text-emerald-400 font-bold"
      : "text-xs text-rose-500 dark:text-rose-400 font-bold";
  };

  window.updatePublicStatusUI = updatePublicStatus;
  window.updateGitHubStatusUI = updateStatus;

  const readBackupFormConfig = () => ({
    owner: $("gh-owner").value.trim(),
    repo: $("gh-repo").value.trim(),
    branch: $("gh-branch").value.trim() || "main",
    token: $("gh-token").value.trim(),
    autoPush: $("gh-autopush").checked,
  });

  const readPublicFormConfig = () => ({
    owner: pubOwnerEl ? pubOwnerEl.value.trim() : "",
    repo: pubRepoEl ? pubRepoEl.value.trim() : "",
    branch: pubBranchEl ? pubBranchEl.value.trim() || "main" : "main",
    token: pubTokenEl ? pubTokenEl.value.trim() : "",
    enabled: pubEnabledEl ? pubEnabledEl.checked : false,
  });

  $("btn-gh-save").addEventListener("click", () => {
    saveBackupRepoConfig(readBackupFormConfig());
    updateStatus();
    alert("تنظیمات گیت‌هاب (بک‌آپ) ذخیره شد ✅");
  });

  $("btn-gh-test").addEventListener("click", async () => {
    saveBackupRepoConfig(readBackupFormConfig());
    await testGitHubConnection();
  });

  $("btn-gh-push").addEventListener("click", async () => {
    saveBackupRepoConfig(readBackupFormConfig());
    await pushBackupToGitHub({ title: "پشتیبان‌گیری دستی در گیت‌هاب" });
    updateStatus();
  });

  $("btn-gh-restore").addEventListener("click", async () => {
    saveBackupRepoConfig(readBackupFormConfig());
    await restoreFromGitHub({ replace: $("gh-restore-replace").checked });
  });

  const btnPubSave = $("btn-pub-gh-save");
  const btnPubTest = $("btn-pub-gh-test");
  const btnPubPush = $("btn-pub-gh-push");

  if (btnPubSave) {
    btnPubSave.addEventListener("click", () => {
      savePublicRepoConfig(readPublicFormConfig());
      updatePublicStatus();
      alert("تنظیمات ریپوی پابلیک ذخیره شد ✅");
    });
  }

  if (btnPubTest) {
    btnPubTest.addEventListener("click", async () => {
      savePublicRepoConfig(readPublicFormConfig());
      await testPublicGitHubConnection();
      updatePublicStatus();
    });
  }

  if (btnPubPush) {
    btnPubPush.addEventListener("click", async () => {
      const cfg = readPublicFormConfig();
      savePublicRepoConfig(cfg);
      await pushToPublicRepo({ title: "همگام‌سازی دستی پورتال مشتری" });
      updatePublicStatus();
    });
  }

  updateStatus();
  updatePublicStatus();
  initOfflineSyncManager();
}
