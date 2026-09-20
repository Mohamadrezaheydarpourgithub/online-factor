import { store, toJalali, nowTimeFa } from "./store.js";

const DB_NAME = "cafe-fs-access";
const DB_STORE = "handles";
const FILE_HANDLE_KEY = "invoices-backup";
const DIR_HANDLE_KEY = "local-backup-directory-handle";

let fileHandle = null;
let dirHandle = null;
let backupIntervalTimer = null;

/* =========================================================================
   توابع پایگاه‌داده IndexedDB برای نگهداری امن Handle‌های فایل و پوشه
   ========================================================================= */
function idbOpen() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(DB_STORE);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const rq = db
      .transaction(DB_STORE, "readonly")
      .objectStore(DB_STORE)
      .get(key);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  });
}

async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* =========================================================================
   اعتبارسنجی مجوزهای فایل و پوشه در مرورگر
   ========================================================================= */
async function ensurePermission(handle, { request = true } = {}) {
  if (!handle) return false;
  const opts = { mode: "readwrite" };
  try {
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if (request) {
      return (await handle.requestPermission(opts)) === "granted";
    }
    return false;
  } catch {
    return false;
  }
}

/* =========================================================================
   تاریخ شمسی استاندارد برای نام‌گذاری پوشه‌ها (مثلاً ۱۴۰۵-۰۶-۲۹)
   ========================================================================= */
export function getTodayShamsiFolderDate() {
  const j = toJalali();
  return `${j.year}-${String(j.month).padStart(2, "0")}-${String(j.day).padStart(2, "0")}`;
}

/* =========================================================================
   گردآوری کامل بسته‌های داده‌ای جهت بک‌آپ (مطابق با ریپوی خصوصی و عمومی گیت‌هاب)
   ========================================================================= */
export function collectAllBackupDatasets() {
  const invoices = store.getInvoices();
  const proformas = store.getProformas();
  const products = store.getProducts();
  const productCategories = store.getProductCategories();
  const announcements = store.getAnnouncements();
  const customers = store.getCustomers();
  const shop = store.getShopInfo();
  const customServices = store.getCustomServices();
  const services = store.getServices();

  const metaPrivate = {
    exportedAt: new Date().toISOString(),
    invoiceCount: invoices.length,
    proformaCount: proformas.length,
    productCount: products.length,
    productCategoryCount: productCategories.length,
    customerCount: customers.length,
    announcementCount: announcements.length,
    type: "private_backup",
  };

  const metaPublic = {
    exportedAt: new Date().toISOString(),
    productCount: products.length,
    productCategoryCount: productCategories.length,
    announcementCount: announcements.length,
    type: "public_data",
  };

  return {
    privateFiles: [
      { name: "invoices.json", data: invoices },
      { name: "proformas.json", data: proformas },
      { name: "products.json", data: products },
      { name: "product-categories.json", data: productCategories },
      { name: "announcements.json", data: announcements },
      { name: "customers.json", data: customers },
      { name: "shop-info.json", data: shop },
      { name: "custom-services.json", data: customServices },
      { name: "services.json", data: services },
      { name: "meta.json", data: metaPrivate },
    ],
    publicFiles: [
      { name: "products.json", data: products },
      { name: "product-categories.json", data: productCategories },
      { name: "announcements.json", data: announcements },
      { name: "shop-info.json", data: shop },
      { name: "custom-services.json", data: customServices },
      { name: "services.json", data: services },
      { name: "meta.json", data: metaPublic },
    ],
    bundle: {
      version: 5,
      exportedAt: new Date().toISOString(),
      shamsiDate: toJalali().full,
      invoices,
      proformas,
      products,
      productCategories,
      announcements,
      customers,
      shop,
      customServices,
      services,
    },
  };
}

/* نوشتن یک فایل JSON داخل هندل پوشه */
async function writeJsonToDirectory(targetDirHandle, fileName, data) {
  const fh = await targetDirHandle.getFileHandle(fileName, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/* نمایش Toast اعلان */
function showBackupToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3500);
}

/* =========================================================================
   مدیریت مودال هشدار تغییر تاریخ پوشه
   ========================================================================= */
function askAdminNewDayFolderConfirm(prevDate, todayDate) {
  return new Promise((resolve) => {
    const modal = document.getElementById("local-backup-day-modal");
    const prevEl = document.getElementById("lb-modal-prev-date");
    const todayEl = document.getElementById("lb-modal-today-date");
    const btnConfirm = document.getElementById("btn-confirm-create-today-folder");
    const btnCancel = document.getElementById("btn-cancel-create-today-folder");

    if (!modal) {
      const ok = confirm(
        `⚠️ تاریخ روز تغییر کرده است!\n\n` +
          `تاریخ آخرین پوشه بک‌آپ: ${prevDate}\n` +
          `تاریخ شمسی امروز: ${todayDate}\n\n` +
          `آیا مایلید پوشه جدیدی برای تاریخ امروز در پوشه انتخاب‌شده ساخته شود؟`,
      );
      return resolve(ok);
    }

    if (prevEl) prevEl.textContent = prevDate || "نامشخص";
    if (todayEl) todayEl.textContent = todayDate;

    modal.classList.remove("hidden");

    function cleanup(result) {
      modal.classList.add("hidden");
      btnConfirm?.removeEventListener("click", onConfirm);
      btnCancel?.removeEventListener("click", onCancel);
      resolve(result);
    }

    function onConfirm() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }

    btnConfirm?.addEventListener("click", onConfirm);
    btnCancel?.addEventListener("click", onCancel);
  });
}

/* =========================================================================
   عملیات اصلی بک‌آپ‌گیری در پوشه سیستم (Local Folder Backup)
   ========================================================================= */
let isLocalBackingUp = false;

export async function performLocalFolderBackup({
  trigger = "manual",
  forceNewFolder = false,
  showToast = true,
} = {}) {
  if (isLocalBackingUp) return { ok: false, reason: "in_progress" };

  try {
    if (!dirHandle) {
      dirHandle = await idbGet(DIR_HANDLE_KEY).catch(() => null);
    }

    if (!dirHandle) {
      if (trigger === "manual") {
        alert("⚠️ هنوز هیچ پوشه‌ای برای ذخیره بک‌آپ انتخاب نشده است.\nلطفاً ابتدا روی «انتخاب پوشه ذخیره بک‌آپ» کلیک کنید.");
      }
      return { ok: false, reason: "no_dir" };
    }

    // بررسی مجوز دسترسی به پوشه
    const hasPerm = await ensurePermission(dirHandle, {
      request: trigger === "manual",
    });
    if (!hasPerm) {
      if (trigger === "manual") {
        alert("⚠️ دسترسی به پوشه انتخاب‌شده تایید نشد یا منقضی شده است.\nلطفاً دوباره پوشه را انتخاب کنید.");
      }
      refreshLocalFolderUI();
      return { ok: false, reason: "no_permission" };
    }

    isLocalBackingUp = true;

    const todayDate = getTodayShamsiFolderDate();
    const settings = store.getSettings();
    const lbConfig = settings.localFolderBackup || {};
    const lastFolderDate = lbConfig.lastBackupDate;
    const autoConfirmNewDay = Boolean(lbConfig.autoConfirmNewDay);

    // بررسی عدم همخوانی تاریخ پوشه قبلی با تاریخ امروز (در حالت آفلاین به صورت خودکار پوشه روز جدید ساخته می‌شود)
    if (lastFolderDate && lastFolderDate !== todayDate && !forceNewFolder && trigger !== "offline") {
      if (!autoConfirmNewDay) {
        // هشدار به ادمین و درخواست تأیید
        const userApproved = await askAdminNewDayFolderConfirm(lastFolderDate, todayDate);
        if (!userApproved) {
          if (showToast) {
            showBackupToast("⚠️ ساخت پوشه تاریخ جدید لغو شد — فایل‌ها ذخیره نشدند");
          }
          isLocalBackingUp = false;
          return { ok: false, reason: "user_cancelled" };
        }
      }
    }

    // ۱. دسترسی یا ساخت پوشه تاریخ امروز (مثلاً 1405-06-29)
    const todayDir = await dirHandle.getDirectoryHandle(todayDate, { create: true });

    // ۲. گردآوری کلیه داده‌های سیستم (دیتای ریپوی خصوصی و عمومی)
    const datasets = collectAllBackupDatasets();

    // ۳. ذخیره دیتای خصوصی داخل زیرپوشه backup/
    const backupSubDir = await todayDir.getDirectoryHandle("backup", { create: true });
    for (const f of datasets.privateFiles) {
      await writeJsonToDirectory(backupSubDir, f.name, f.data);
    }

    // ۴. ذخیره دیتای عمومی داخل زیرپوشه data/
    const dataSubDir = await todayDir.getDirectoryHandle("data", { create: true });
    for (const f of datasets.publicFiles) {
      await writeJsonToDirectory(dataSubDir, f.name, f.data);
    }

    // ۵. ذخیره فایل تجمیعی و مانیفست اطلاعات روز
    await writeJsonToDirectory(todayDir, "backup-bundle.json", datasets.bundle);
    await writeJsonToDirectory(todayDir, "manifest.json", {
      shamsiDate: todayDate,
      updatedAt: new Date().toISOString(),
      timeFa: nowTimeFa(),
      trigger,
      counts: {
        invoices: datasets.bundle.invoices.length,
        proformas: datasets.bundle.proformas.length,
        products: datasets.bundle.products.length,
        customers: datasets.bundle.customers.length,
        announcements: datasets.bundle.announcements.length,
      },
    });

    // ۶. به‌روزرسانی تنظیمات و متادیتای ذخیره‌سازی
    const now = Date.now();
    const timeStr = `${toJalali().full} ساعت ${nowTimeFa()}`;
    const updatedSettings = {
      ...store.getSettings(),
      localFolderBackup: {
        ...(store.getSettings().localFolderBackup || {}),
        folderName: dirHandle.name,
        lastBackupAt: now,
        lastBackupDate: todayDate,
        lastBackupTimeStr: timeStr,
      },
    };
    store.saveSettings(updatedSettings);

    refreshLocalFolderUI();

    if (showToast) {
      const triggerLabel =
        trigger === "push"
          ? "در زمان Push"
          : trigger === "timer"
            ? "زمان‌بندی خودکار"
            : trigger === "offline"
              ? "حالت آفلاین (در صف ارسال)"
              : "دستی";
      showBackupToast(`💾 بک‌آپ محلی (${triggerLabel}) با موفقیت در پوشه «${todayDate}» ذخیره شد`);
    }

    return { ok: true, folderDate: todayDate, timestamp: now };
  } catch (err) {
    console.error("خطا در پشتیبان‌گیری محلی در پوشه:", err);
    if (trigger === "manual") {
      alert("❌ خطا در ذخیره نسخه پشتیبان محلی:\n" + err.message);
    }
    return { ok: false, error: err.message };
  } finally {
    isLocalBackingUp = false;
  }
}

/* =========================================================================
   انتخاب پوشه توسط کاربر (Directory Picker)
   ========================================================================= */
export async function selectBackupDirectory() {
  if (!("showDirectoryPicker" in window)) {
    alert(
      "مرورگر شما از انتخاب مستقیم پوشه پشتیبانی نمی‌کند.\n" +
        "لطفاً از مرورگرهای مدرن مانند گوگل کروم (Chrome) یا مایکروسافت اج (Edge) استفاده کنید.",
    );
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const ok = await ensurePermission(handle, { request: true });
    if (!ok) {
      alert("⚠️ برای ذخیره خودکار فایل‌ها، اعطای مجوز ویرایش (Read & Write) الزامی است.");
      return;
    }

    dirHandle = handle;
    await idbSet(DIR_HANDLE_KEY, handle);

    // ذخیره اولیه تنظیمات پوشه
    const s = store.getSettings();
    store.saveSettings({
      ...s,
      localFolderBackup: {
        ...(s.localFolderBackup || {}),
        folderName: handle.name,
      },
    });

    refreshLocalFolderUI();

    // اجرای اولین بک‌آپ بلافاصله پس از انتخاب پوشه
    await performLocalFolderBackup({ trigger: "manual", showToast: true });
  } catch (err) {
    if (err.name !== "AbortError") {
      console.warn("خطا در انتخاب پوشه:", err);
      alert("خطا در انتخاب پوشه: " + err.message);
    }
  }
}

/* قطع اتصال پوشه */
export async function disconnectBackupDirectory() {
  dirHandle = null;
  await idbDel(DIR_HANDLE_KEY);
  const s = store.getSettings();
  if (s.localFolderBackup) {
    store.saveSettings({
      ...s,
      localFolderBackup: {
        ...s.localFolderBackup,
        folderName: null,
      },
    });
  }
  refreshLocalFolderUI();
  showBackupToast("اتصال پوشه محلی قطع شد");
}

/* به‌روزرسانی وضعیت نمایشی پوشه محلی در صفحه تنظیمات */
export async function refreshLocalFolderUI() {
  const statusEl = document.getElementById("local-dir-status");
  const nameEl = document.getElementById("local-dir-name");
  const todayEl = document.getElementById("local-today-date");
  const lastFolderEl = document.getElementById("local-last-folder-date");
  const lastTimeEl = document.getElementById("local-last-backup-time");
  const btnSelect = document.getElementById("btn-local-dir-select");
  const btnDisconnect = document.getElementById("btn-local-dir-disconnect");
  const intervalSelect = document.getElementById("local-backup-interval");
  const onPushCheck = document.getElementById("local-backup-on-push");
  const autoConfirmCheck = document.getElementById("local-backup-auto-confirm-new-day");

  const todayDate = getTodayShamsiFolderDate();
  if (todayEl) todayEl.textContent = todayDate;

  const s = store.getSettings();
  const lbConfig = s.localFolderBackup || {};

  if (intervalSelect && lbConfig.intervalMinutes !== undefined) {
    intervalSelect.value = String(lbConfig.intervalMinutes);
  }
  if (onPushCheck && lbConfig.onPush !== undefined) {
    onPushCheck.checked = Boolean(lbConfig.onPush);
  }
  if (autoConfirmCheck && lbConfig.autoConfirmNewDay !== undefined) {
    autoConfirmCheck.checked = Boolean(lbConfig.autoConfirmNewDay);
  }

  if (lastFolderEl) {
    lastFolderEl.textContent = lbConfig.lastBackupDate || "هنوز ساخته نشده";
  }
  if (lastTimeEl) {
    lastTimeEl.textContent = lbConfig.lastBackupTimeStr || "هیچ";
  }

  if (!dirHandle) {
    dirHandle = await idbGet(DIR_HANDLE_KEY).catch(() => null);
  }

  if (!dirHandle) {
    if (statusEl) {
      statusEl.className =
        "text-xs font-bold px-3 py-1 rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-900 flex items-center gap-1.5";
      statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500"></span> قطع — پوشه‌ای انتخاب نشده`;
    }
    if (nameEl) nameEl.textContent = "انتخاب نشده";
    btnSelect?.classList.remove("hidden");
    btnDisconnect?.classList.add("hidden");
    return;
  }

  // بررسی وضعیت دسترسی
  const perm = await dirHandle.queryPermission({ mode: "readwrite" }).catch(() => "denied");
  if (nameEl) nameEl.textContent = dirHandle.name;

  if (perm === "granted") {
    if (statusEl) {
      statusEl.className =
        "text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5";
      statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> متصل ✅ (${dirHandle.name})`;
    }
  } else {
    if (statusEl) {
      statusEl.className =
        "text-xs font-bold px-3 py-1 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex items-center gap-1.5";
      statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span> نیازمند تأیید مجوز`;
    }
  }

  btnSelect?.classList.remove("hidden");
  btnDisconnect?.classList.remove("hidden");
}

/* =========================================================================
   تایمر خودکار بک‌آپ‌گیری دوره‌ای (Periodic Interval)
   ========================================================================= */
export function initLocalBackupInterval() {
  if (backupIntervalTimer) clearInterval(backupIntervalTimer);

  // بررسی هر ۱ دقیقه
  backupIntervalTimer = setInterval(async () => {
    try {
      const s = store.getSettings();
      const lb = s.localFolderBackup || {};
      const intervalMin = Number(lb.intervalMinutes ?? 60);

      // اگر بازه زمانی غیرفعال (0) باشد کاری انجام نده
      if (intervalMin <= 0) return;

      const lastAt = Number(lb.lastBackupAt || 0);
      const elapsedMs = Date.now() - lastAt;
      const intervalMs = intervalMin * 60 * 1000;

      if (elapsedMs >= intervalMs) {
        if (!dirHandle) {
          dirHandle = await idbGet(DIR_HANDLE_KEY).catch(() => null);
        }
        if (dirHandle) {
          const perm = await dirHandle.queryPermission({ mode: "readwrite" }).catch(() => "denied");
          if (perm === "granted") {
            await performLocalFolderBackup({ trigger: "timer", showToast: false });
          }
        }
      }
    } catch (e) {
      console.warn("خطا در تایمر بک‌آپ محلی:", e);
    }
  }, 60 * 1000);
}

/* =========================================================================
   پشتیبان‌گیری تک‌فایلی قدیمی (Legacy Single File Backup) جهت سازگاری
   ========================================================================= */
async function writeInvoicesToFile(handle) {
  const writable = await handle.createWritable();
  const payload = {
    version: 4,
    exportedAt: new Date().toISOString(),
    invoices: store.getInvoices(),
    proformas: store.getProformas(),
    products: store.getProducts(),
    productCategories: store.getProductCategories(),
    announcements: store.getAnnouncements(),
    customers: store.getCustomers(),
    customServices: store.getCustomServices(),
    shop: store.getShopInfo(),
  };
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

async function refreshStatus() {
  const status = document.getElementById("backup-status");
  const btnConnect = document.getElementById("btn-backup-connect");
  const btnDisconnect = document.getElementById("btn-backup-disconnect");
  if (!status) return;

  if (!fileHandle) {
    status.textContent = "قطع — ذخیره خودکار غیرفعال";
    status.className = "text-rose-500 dark:text-rose-400 font-bold";
    btnConnect?.classList.remove("hidden");
    btnDisconnect?.classList.add("hidden");
    return;
  }
  const perm = await fileHandle.queryPermission({ mode: "readwrite" });
  if (perm === "granted") {
    status.textContent = "متصل ✅ — ذخیره خودکار فعال";
    status.className = "text-emerald-500 dark:text-emerald-400 font-bold";
  } else {
    status.textContent = "متصل ⚠️ — با ثبت فاکتور بعدی، مجوز خواسته می‌شود";
    status.className = "text-amber-500 dark:text-amber-400 font-bold";
  }
  btnConnect?.classList.add("hidden");
  btnDisconnect?.classList.remove("hidden");
}

export async function connectBackupFile() {
  if (!("showSaveFilePicker" in window)) {
    alert(
      "مرورگر شما از اتصال مستقیم به فایل پشتیبانی نمی‌کند.\nاز Chrome یا Edge استفاده کنید، یا از دکمه «خروجی JSON» بهره بگیرید.",
    );
    return;
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: "invoices-backup.json",
      types: [
        { description: "فایل JSON", accept: { "application/json": [".json"] } },
      ],
    });
    fileHandle = handle;
    await idbSet(FILE_HANDLE_KEY, handle);
    const ok = await ensurePermission(handle);
    if (ok) await writeInvoicesToFile(handle);
    await refreshStatus();
  } catch (err) {
    if (err.name !== "AbortError") console.warn("connect failed:", err);
  }
}

export async function disconnectBackupFile() {
  fileHandle = null;
  await idbDel(FILE_HANDLE_KEY);
  await refreshStatus();
}

export async function autoSaveInvoices() {
  try {
    // ۱. اگر فایل تک‌فایلی متصل باشد
    if (!fileHandle) fileHandle = await idbGet(FILE_HANDLE_KEY);
    if (fileHandle) {
      const ok = await ensurePermission(fileHandle, { request: false });
      if (ok) await writeInvoicesToFile(fileHandle);
    }
  } catch (err) {
    console.warn("ذخیره خودکار روی فایل ناموفق بود:", err);
  }
}

export function exportAllData() {
  const data = {
    version: 4,
    exportedAt: new Date().toISOString(),
    invoices: store.getInvoices(),
    proformas: store.getProformas(),
    products: store.getProducts(),
    productCategories: store.getProductCategories(),
    announcements: store.getAnnouncements(),
    customers: store.getCustomers(),
    customServices: store.getCustomServices(),
    shop: store.getShopInfo(),
  };
  if (
    !data.invoices.length &&
    !data.proformas.length &&
    !data.products.length &&
    !data.customers.length
  )
    return alert("هیچ داده‌ای برای خروجی وجود ندارد!");

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup-${toJalali().full.replaceAll("/", "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importInvoicesFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);

      const invoices = Array.isArray(parsed) ? parsed : parsed.invoices;
      const products = parsed.products;
      const productCategories = parsed.productCategories;
      const customers = parsed.customers;
      const shop = parsed.shop;
      const customServices = parsed.customServices;
      const announcements = parsed.announcements;

      const invValid = Array.isArray(invoices)
        ? invoices.filter(
            (inv) =>
              inv &&
              typeof inv.number === "number" &&
              Array.isArray(inv.items) &&
              typeof inv.total === "number",
          )
        : [];
      const prdValid = Array.isArray(products)
        ? products.filter((p) => p && p.id && p.name)
        : [];
      const cstValid = Array.isArray(customers)
        ? customers.filter((c) => c && (c.phone || c.name))
        : [];

      // ادغام فاکتورها
      const currentInv = store.getInvoices();
      const existingInvNums = new Set(currentInv.map((i) => i.number));
      const addedInv = invValid.filter((i) => !existingInvNums.has(i.number));
      store.setInvoices(
        [...currentInv, ...addedInv].sort((a, b) => b.number - a.number),
      );

      // ادغام پیش‌فاکتورها
      if (Array.isArray(parsed.proformas) && parsed.proformas.length) {
        const currentPf = store.getProformas();
        const existingPfNums = new Set(currentPf.map((p) => p.number));
        const addedPf = parsed.proformas.filter(
          (p) => p && p.number && !existingPfNums.has(p.number),
        );
        store.setProformas(
          [...currentPf, ...addedPf].sort((a, b) => b.number - a.number),
        );
      }

      if (Array.isArray(announcements) && announcements.length) {
        const currentAnn = store.getAnnouncements();
        const annIds = new Set(currentAnn.map((a) => a.id));
        const addedAnn = announcements.filter(
          (a) => a && a.id && !annIds.has(a.id),
        );
        store.setAnnouncements([...currentAnn, ...addedAnn]);
      }

      // ادغام محصولات
      if (prdValid.length) {
        const currentPrd = store.getProducts();
        const prdIds = new Set(currentPrd.map((p) => p.id));
        store.setProducts([
          ...currentPrd,
          ...prdValid.filter((p) => !prdIds.has(p.id)),
        ]);
      }

      // ادغام دسته‌های محصولات
      if (Array.isArray(productCategories) && productCategories.length) {
        const currentCats = store.getProductCategories();
        const catIds = new Set(currentCats.map((c) => c.id));
        const addedCats = productCategories.filter(
          (c) => c && c.id && !catIds.has(c.id),
        );
        store.setProductCategories([...currentCats, ...addedCats]);
      }

      // ادغام مشتریان
      if (cstValid.length) {
        const currentCst = store.getCustomers();
        const cstPhones = new Set(
          currentCst.map((c) => c.phone).filter(Boolean),
        );
        store.saveCustomers([
          ...currentCst,
          ...cstValid.filter((c) => !c.phone || !cstPhones.has(c.phone)),
        ]);
      }

      // ادغام خدمات سفارشی
      if (customServices && typeof customServices === "object") {
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

      if (shop && typeof shop === "object") store.saveShopInfo(shop);

      alert(
        `✅ ایمپورت انجام شد:\n` +
          `فاکتور: ${addedInv.length} جدید\n` +
          `محصول: ${prdValid.length} عدد\n` +
          `مشتری: ${cstValid.length} نفر\n` +
          `دسته‌بندی‌ها و خدمات با موفقیت بازیابی شدند.`,
      );
      autoSaveInvoices();
      if (window.initInvoicesList) window.initInvoicesList();
      location.reload();
    } catch {
      alert("❌ فایل انتخاب‌شده یک JSON معتبر نیست!");
    }
  };
  reader.readAsText(file);
}

/* =========================================================================
   بازیابی آفلاین از پوشه تاریخ سیستم (Offline Date Folder Restore)
   ========================================================================= */
let pendingRestoreData = null;

/**
 * خواندن امن محتوای JSON یک فایل درون دایرکتوری
 */
async function readJsonFromDir(targetDirHandle, fileName) {
  try {
    const fh = await targetDirHandle.getFileHandle(fileName);
    const file = await fh.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * دریافت هندل زیرپوشه
 */
async function getSubdirHandle(parentDirHandle, subDirName) {
  try {
    return await parentDirHandle.getDirectoryHandle(subDirName);
  } catch {
    return null;
  }
}

/**
 * بازرسی ساختار پوشه انتخابی و استخراج کلیه داده‌های بک‌آپ
 */
async function inspectDirectoryHandle(targetDirHandle) {
  // ۱. بررسی فایل تجمیعی backup-bundle.json
  const bundle = await readJsonFromDir(targetDirHandle, "backup-bundle.json");
  if (bundle && typeof bundle === "object") {
    return {
      folderName: targetDirHandle.name,
      invoices: Array.isArray(bundle.invoices) ? bundle.invoices : [],
      proformas: Array.isArray(bundle.proformas) ? bundle.proformas : [],
      products: Array.isArray(bundle.products) ? bundle.products : [],
      productCategories: Array.isArray(bundle.productCategories) ? bundle.productCategories : [],
      customers: Array.isArray(bundle.customers) ? bundle.customers : [],
      announcements: Array.isArray(bundle.announcements) ? bundle.announcements : [],
      shop: bundle.shop || null,
      customServices: bundle.customServices || null,
      services: Array.isArray(bundle.services) ? bundle.services : [],
    };
  }

  // ۲. بررسی وجود زیرپوشه backup (فرمت استاندارد ریپو خصوصی)
  let invoices = null;
  let proformas = null;
  let products = null;
  let productCategories = null;
  let customers = null;
  let announcements = null;
  let shop = null;
  let customServices = null;
  let services = null;

  const backupSub = await getSubdirHandle(targetDirHandle, "backup");
  if (backupSub) {
    [
      invoices,
      proformas,
      products,
      productCategories,
      customers,
      announcements,
      shop,
      customServices,
      services,
    ] = await Promise.all([
      readJsonFromDir(backupSub, "invoices.json"),
      readJsonFromDir(backupSub, "proformas.json"),
      readJsonFromDir(backupSub, "products.json"),
      readJsonFromDir(backupSub, "product-categories.json"),
      readJsonFromDir(backupSub, "customers.json"),
      readJsonFromDir(backupSub, "announcements.json"),
      readJsonFromDir(backupSub, "shop-info.json"),
      readJsonFromDir(backupSub, "custom-services.json"),
      readJsonFromDir(backupSub, "services.json"),
    ]);
  }

  // ۳. بررسی فایل‌ها در ریشه خود پوشه در صورت نبودن در backup
  if (!invoices) invoices = await readJsonFromDir(targetDirHandle, "invoices.json");
  if (!proformas) proformas = await readJsonFromDir(targetDirHandle, "proformas.json");
  if (!products) products = await readJsonFromDir(targetDirHandle, "products.json");
  if (!productCategories) productCategories = await readJsonFromDir(targetDirHandle, "product-categories.json");
  if (!customers) customers = await readJsonFromDir(targetDirHandle, "customers.json");
  if (!announcements) announcements = await readJsonFromDir(targetDirHandle, "announcements.json");
  if (!shop) shop = await readJsonFromDir(targetDirHandle, "shop-info.json");
  if (!customServices) customServices = await readJsonFromDir(targetDirHandle, "custom-services.json");
  if (!services) services = await readJsonFromDir(targetDirHandle, "services.json");

  // ۴. بررسی زیرپوشه data در صورت وجود
  const dataSub = await getSubdirHandle(targetDirHandle, "data");
  if (dataSub) {
    if (!products) products = await readJsonFromDir(dataSub, "products.json");
    if (!productCategories) productCategories = await readJsonFromDir(dataSub, "product-categories.json");
    if (!announcements) announcements = await readJsonFromDir(dataSub, "announcements.json");
    if (!shop) shop = await readJsonFromDir(dataSub, "shop-info.json");
    if (!customServices) customServices = await readJsonFromDir(dataSub, "custom-services.json");
    if (!services) services = await readJsonFromDir(dataSub, "services.json");
  }

  return {
    folderName: targetDirHandle.name,
    invoices: Array.isArray(invoices) ? invoices : [],
    proformas: Array.isArray(proformas) ? proformas : [],
    products: Array.isArray(products) ? products : [],
    productCategories: Array.isArray(productCategories) ? productCategories : [],
    customers: Array.isArray(customers) ? customers : [],
    announcements: Array.isArray(announcements) ? announcements : [],
    shop: shop || null,
    customServices: customServices || null,
    services: Array.isArray(services) ? services : [],
  };
}

/**
 * بازرسی لیست فایل‌های دریافتی از اینپوت دایرکتوری در مرورگرهای ناسازگار
 */
async function inspectFilesList(files) {
  if (!files || !files.length) return null;

  const folderName = files[0].webkitRelativePath
    ? files[0].webkitRelativePath.split("/")[0]
    : "پوشه انتخابی";

  // ۱. اولویت اول: بررسی فایل تجمیعی backup-bundle.json
  const bundleFile = files.find((f) => f.name === "backup-bundle.json");
  if (bundleFile) {
    try {
      const text = await bundleFile.text();
      const bundle = JSON.parse(text);
      return {
        folderName,
        invoices: Array.isArray(bundle.invoices) ? bundle.invoices : [],
        proformas: Array.isArray(bundle.proformas) ? bundle.proformas : [],
        products: Array.isArray(bundle.products) ? bundle.products : [],
        productCategories: Array.isArray(bundle.productCategories) ? bundle.productCategories : [],
        customers: Array.isArray(bundle.customers) ? bundle.customers : [],
        announcements: Array.isArray(bundle.announcements) ? bundle.announcements : [],
        shop: bundle.shop || null,
        customServices: bundle.customServices || null,
        services: Array.isArray(bundle.services) ? bundle.services : [],
      };
    } catch (e) {
      console.warn("خطا در پارس backup-bundle.json:", e);
    }
  }

  // ۲. استخراج جداگانه فایل‌ها
  const findAndParse = async (predicate) => {
    const f = files.find(predicate);
    if (!f) return null;
    try {
      const text = await f.text();
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const invoices = await findAndParse((f) => f.name === "invoices.json");
  const proformas = await findAndParse((f) => f.name === "proformas.json");
  const products = await findAndParse((f) => f.name === "products.json");
  const productCategories = await findAndParse((f) => f.name === "product-categories.json");
  const customers = await findAndParse((f) => f.name === "customers.json");
  const announcements = await findAndParse((f) => f.name === "announcements.json");
  const shop = await findAndParse((f) => f.name === "shop-info.json");
  const customServices = await findAndParse((f) => f.name === "custom-services.json");
  const services = await findAndParse((f) => f.name === "services.json");

  return {
    folderName,
    invoices: Array.isArray(invoices) ? invoices : [],
    proformas: Array.isArray(proformas) ? proformas : [],
    products: Array.isArray(products) ? products : [],
    productCategories: Array.isArray(productCategories) ? productCategories : [],
    customers: Array.isArray(customers) ? customers : [],
    announcements: Array.isArray(announcements) ? announcements : [],
    shop: shop || null,
    customServices: customServices || null,
    services: Array.isArray(services) ? services : [],
  };
}

/**
 * تغییر مرحله نمایش در مودال بازیابی آفلاین
 */
function showRestoreStep(step) {
  const step1 = document.getElementById("local-restore-step-select");
  const step2 = document.getElementById("local-restore-step-confirm");
  if (step === 1) {
    step1?.classList.remove("hidden");
    step2?.classList.add("hidden");
  } else if (step === 2) {
    step1?.classList.add("hidden");
    step2?.classList.remove("hidden");
  }
}

/**
 * به‌روزرسانی پیش‌نمایش اطلاعات یافت‌شده در مرحله ۲
 */
function updateRestorePreviewUI(data) {
  pendingRestoreData = data;
  const nameEl = document.getElementById("lr-confirm-folder-name");
  const invEl = document.getElementById("lr-count-invoices");
  const pfEl = document.getElementById("lr-count-proformas");
  const prdEl = document.getElementById("lr-count-products");
  const cstEl = document.getElementById("lr-count-customers");
  const extraEl = document.getElementById("lr-extra-counts");

  if (nameEl) nameEl.textContent = data.folderName || "-";
  if (invEl) invEl.textContent = (data.invoices || []).length.toLocaleString("fa-IR");
  if (pfEl) pfEl.textContent = (data.proformas || []).length.toLocaleString("fa-IR");
  if (prdEl) prdEl.textContent = (data.products || []).length.toLocaleString("fa-IR");
  if (cstEl) cstEl.textContent = (data.customers || []).length.toLocaleString("fa-IR");

  if (extraEl) {
    const extraParts = [];
    if (data.productCategories?.length) {
      extraParts.push(`دسته‌بندی‌ها: ${data.productCategories.length.toLocaleString("fa-IR")} مورد`);
    }
    if (data.announcements?.length) {
      extraParts.push(`اخبار/اعلانات: ${data.announcements.length.toLocaleString("fa-IR")} مورد`);
    }
    if (data.shop) {
      extraParts.push(`اطلاعات فروشگاه: موجود`);
    }
    if (data.customServices) {
      extraParts.push(`خدمات سفارشی: موجود`);
    }
    extraEl.innerHTML = extraParts.length > 0 ? `🔹 موارد دیگر: ${extraParts.join(" | ")}` : "";
  }
}

/**
 * بازخوانی و نمایش پوشه‌های تاریخ موجود در پوشه بک‌آپ متصل فعلی
 */
async function loadAndRenderConnectedDateFolders() {
  const listEl = document.getElementById("local-restore-folders-list");
  if (!listEl) return;

  if (!dirHandle) {
    dirHandle = await idbGet(DIR_HANDLE_KEY).catch(() => null);
  }

  if (!dirHandle) {
    listEl.innerHTML = `
      <div class="p-3 text-center text-slate-400">
        پوشه اصلی بک‌آپ متصل نیست. می‌توانید از دکمه زیر برای انتخاب پوشه تاریخ از فلش یا هارد استفاده کنید.
      </div>`;
    return;
  }

  const perm = await dirHandle.queryPermission({ mode: "read" }).catch(() => "denied");
  if (perm !== "granted") {
    listEl.innerHTML = `
      <div class="p-3 text-center text-amber-600 dark:text-amber-400 space-y-2">
        <p>پوشه متصل است اما نیاز به اجازه دسترسی دارد.</p>
        <button id="btn-lr-request-perm" type="button" class="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs cursor-pointer">
          اعطای مجوز خواندن پوشه
        </button>
      </div>`;
    document.getElementById("btn-lr-request-perm")?.addEventListener("click", async () => {
      const ok = await ensurePermission(dirHandle, { request: true });
      if (ok) loadAndRenderConnectedDateFolders();
    });
    return;
  }

  try {
    const subdirs = [];
    for await (const entry of dirHandle.values()) {
      if (entry.kind === "directory") {
        subdirs.push(entry);
      }
    }

    if (!subdirs.length) {
      listEl.innerHTML = `
        <div class="p-3 text-center text-slate-400">
          هیچ پوشه تاریخی در پوشه بک‌آپ متصل یافت نشد.
        </div>`;
      return;
    }

    // مرتب‌سازی معکوس (تاریخ‌های جدیدتر در بالا)
    subdirs.sort((a, b) => b.name.localeCompare(a.name));

    listEl.innerHTML = subdirs
      .map(
        (dir) => `
        <div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 hover:border-amber-400 transition">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-base">📁</span>
            <span class="font-mono font-bold text-slate-700 dark:text-slate-200 truncate">${dir.name}</span>
          </div>
          <button
            type="button"
            class="btn-lr-select-folder bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1 rounded-md text-[11px] transition shrink-0 cursor-pointer"
            data-folder="${dir.name}"
          >
            🔍 بررسی و بازیابی
          </button>
        </div>
      `,
      )
      .join("");

    listEl.querySelectorAll(".btn-lr-select-folder").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const fName = btn.dataset.folder;
        try {
          const subDirHandle = await dirHandle.getDirectoryHandle(fName);
          const data = await inspectDirectoryHandle(subDirHandle);
          updateRestorePreviewUI(data);
          showRestoreStep(2);
        } catch (err) {
          alert("خطا در بازخوانی پوشه: " + err.message);
        }
      });
    });
  } catch (err) {
    console.warn("خطا در لیست پوشه‌ها:", err);
    listEl.innerHTML = `<div class="p-3 text-center text-rose-500 text-xs">خطا در خواندن پوشه‌ها: ${err.message}</div>`;
  }
}

/**
 * اعمال و اجرای نهایی بازیابی داده‌ها در store
 */
export async function executeLocalRestore(data, replace = false) {
  if (!data) return;

  const invCount = (data.invoices || []).length;
  const pfCount = (data.proformas || []).length;
  const prdCount = (data.products || []).length;
  const cstCount = (data.customers || []).length;

  const confirmMsg =
    `⚠️ آیا از بازیابی اطلاعات از پوشه «${data.folderName}» اطمینان دارید؟\n\n` +
    `• تعداد فاکتورها: ${invCount}\n` +
    `• تعداد پیش‌فاکتورها: ${pfCount}\n` +
    `• تعداد محصولات: ${prdCount}\n` +
    `• تعداد مشتریان: ${cstCount}\n\n` +
    `نوع بازیابی: ${replace ? "جایگزینی کامل (داده‌های قبلی پاک و جایگزین می‌شوند)" : "ادغام هوشمند (بدون تکراری)"}\n\n` +
    `این عملیات غیرقابل بازگشت است. ادامه می‌دهید؟`;

  if (!confirm(confirmMsg)) return;

  try {
    // ۱. دسته‌بندی محصولات
    if (Array.isArray(data.productCategories)) {
      if (replace) {
        store.setProductCategories(data.productCategories);
      } else {
        const current = store.getProductCategories();
        const ids = new Set(current.map((c) => c.id));
        const added = data.productCategories.filter(
          (c) => c && c.id && !ids.has(c.id),
        );
        store.setProductCategories([...current, ...added]);
      }
    }

    // ۲. اعلانات و اخبار
    if (Array.isArray(data.announcements)) {
      if (replace) {
        store.setAnnouncements(data.announcements);
      } else {
        const current = store.getAnnouncements();
        const ids = new Set(current.map((a) => a.id));
        const added = data.announcements.filter((a) => a && a.id && !ids.has(a.id));
        store.setAnnouncements([...current, ...added]);
      }
    }

    // ۳. خدمات سفارشی
    if (data.customServices && typeof data.customServices === "object") {
      if (replace) {
        store.saveCustomServices(data.customServices);
      } else {
        const current = store.getCustomServices();
        const currentNewCatIds = new Set(
          (current.newCategories || []).map((c) => c.id),
        );
        const addedNewCats = (data.customServices.newCategories || []).filter(
          (c) => c && !currentNewCatIds.has(c.id),
        );
        const mergedNewCategories = [
          ...(current.newCategories || []),
          ...addedNewCats,
        ];
        const mergedOverrides = {
          ...(current.categoryOverrides || {}),
          ...(data.customServices.categoryOverrides || {}),
        };
        store.saveCustomServices({
          newCategories: mergedNewCategories,
          categoryOverrides: mergedOverrides,
        });
      }
    } else if (Array.isArray(data.services) && data.services.length) {
      // در صورتی که فقط services.json در بک‌آپ موجود بود، دسته‌های سفارشی آن را به customServices منتقل کن
      const customCats = data.services.filter((s) => s && s.custom);
      if (customCats.length) {
        const current = store.getCustomServices();
        const currentNewCatIds = new Set(
          (current.newCategories || []).map((c) => c.id),
        );
        const addedNewCats = customCats.filter(
          (c) => c && !currentNewCatIds.has(c.id),
        );
        store.saveCustomServices({
          newCategories: replace
            ? customCats
            : [...(current.newCategories || []), ...addedNewCats],
          categoryOverrides: current.categoryOverrides || {},
        });
      }
    }

    // ۴. مشتریان
    if (Array.isArray(data.customers)) {
      if (replace) {
        store.saveCustomers(data.customers);
      } else {
        const current = store.getCustomers();
        const phones = new Set(current.map((c) => c.phone).filter(Boolean));
        const added = data.customers.filter(
          (c) => c && (!c.phone || !phones.has(c.phone)),
        );
        store.saveCustomers([...current, ...added]);
      }
    }

    // ۶. فاکتورها
    if (Array.isArray(data.invoices)) {
      if (replace) {
        store.setInvoices(data.invoices);
      } else {
        const current = store.getInvoices();
        const existing = new Set(current.map((i) => i.number));
        const added = data.invoices.filter((i) => i && !existing.has(i.number));
        store.setInvoices(
          [...current, ...added].sort((a, b) => b.number - a.number),
        );
      }
    }

    // ۷. پیش‌فاکتورها
    if (Array.isArray(data.proformas)) {
      if (replace) {
        store.setProformas(data.proformas);
      } else {
        const current = store.getProformas();
        const existing = new Set(current.map((p) => p.number));
        const added = data.proformas.filter((p) => p && !existing.has(p.number));
        store.setProformas(
          [...current, ...added].sort((a, b) => b.number - a.number),
        );
      }
    }

    // ۸. محصولات
    if (Array.isArray(data.products)) {
      if (replace) {
        store.setProducts(data.products);
      } else {
        const current = store.getProducts();
        const ids = new Set(current.map((p) => p.id));
        store.setProducts([
          ...current,
          ...data.products.filter((p) => p && !ids.has(p.id)),
        ]);
      }
    }

    // ۹. اطلاعات فروشگاه
    if (data.shop && typeof data.shop === "object") {
      store.saveShopInfo({ ...store.getShopInfo(), ...data.shop });
    }

    // ۱۰. به‌روزرسانی شمارنده فاکتور و پیش‌فاکتور
    const maxNum = store
      .getInvoices()
      .reduce((m, i) => Math.max(m, i.number || 0), 0);
    if (maxNum > store.getCounter()) store.setCounter(maxNum);

    const maxPfNum = store
      .getProformas()
      .reduce((m, p) => Math.max(m, p.number || 0), 0);
    if (maxPfNum > store.getProformaCounter()) store.setProformaCounter(maxPfNum);

    // ۱۱. همگام‌سازی خودکار با فایل تک‌فایلی در صورت اتصال
    try {
      await autoSaveInvoices();
    } catch {}

    alert("✅ اطلاعات با موفقیت از پوشه محلی بازیابی شد. صفحه بازنشانی می‌شود...");
    const u = new URL(window.location.href);
    u.searchParams.set("_reload", Date.now().toString());
    window.location.replace(u.toString());
  } catch (err) {
    console.error("خطا در اجرای بازیابی محلی:", err);
    alert("❌ بازیابی اطلاعات با خطا مواجه شد:\n" + err.message);
  }
}

/**
 * راه‌اندازی کنترلرهای واسط کاربری بازیابی آفلاین
 */
export function initLocalRestoreUI() {
  const modal = document.getElementById("local-restore-modal");
  const btnOpen = document.getElementById("btn-local-restore-folder");
  const btnClose = document.getElementById("btn-close-local-restore-modal");
  const btnPickOther = document.getElementById("btn-local-restore-pick-other");
  const fallbackInput = document.getElementById("input-local-restore-fallback");
  const btnBack = document.getElementById("btn-local-restore-back");
  const btnExecute = document.getElementById("btn-local-restore-execute");
  const replaceCheck = document.getElementById("lr-replace-checkbox");

  // باز کردن مودال
  btnOpen?.addEventListener("click", async () => {
    showRestoreStep(1);
    modal?.classList.remove("hidden");
    await loadAndRenderConnectedDateFolders();
  });

  // بستن مودال
  btnClose?.addEventListener("click", () => {
    modal?.classList.add("hidden");
  });

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });

  // دکمه بازگشت به مرحله ۱
  btnBack?.addEventListener("click", () => {
    showRestoreStep(1);
  });

  // انتخاب پوشه از مسیر دلخواه (فلش یا هارد)
  btnPickOther?.addEventListener("click", async () => {
    if ("showDirectoryPicker" in window) {
      try {
        const chosenHandle = await window.showDirectoryPicker({ mode: "read" });

        // بررسی اینکه آیا مستقیماً یک پوشه تاریخ بک‌آپ انتخاب شده است
        const hasBundle = await readJsonFromDir(chosenHandle, "backup-bundle.json");
        const hasBackupDir = await getSubdirHandle(chosenHandle, "backup");
        const hasInvoices = await readJsonFromDir(chosenHandle, "invoices.json");

        if (hasBundle || hasBackupDir || hasInvoices) {
          const data = await inspectDirectoryHandle(chosenHandle);
          updateRestorePreviewUI(data);
          showRestoreStep(2);
        } else {
          // بررسی زیرپوشه‌های موجود در صورت انتخاب پوشه والد
          const subdirs = [];
          for await (const entry of chosenHandle.values()) {
            if (entry.kind === "directory") subdirs.push(entry);
          }

          if (subdirs.length > 0) {
            subdirs.sort((a, b) => b.name.localeCompare(a.name));
            const listEl = document.getElementById("local-restore-folders-list");
            if (listEl) {
              listEl.innerHTML = subdirs
                .map(
                  (dir) => `
                <div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 hover:border-amber-400 transition">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-base">📁</span>
                    <span class="font-mono font-bold text-slate-700 dark:text-slate-200 truncate">${dir.name}</span>
                  </div>
                  <button
                    type="button"
                    class="btn-lr-select-custom-folder bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1 rounded-md text-[11px] transition shrink-0 cursor-pointer"
                    data-folder="${dir.name}"
                  >
                    🔍 بررسی و بازیابی
                  </button>
                </div>
              `,
                )
                .join("");

              listEl.querySelectorAll(".btn-lr-select-custom-folder").forEach((btn) => {
                btn.addEventListener("click", async () => {
                  const fName = btn.dataset.folder;
                  const targetSub = await chosenHandle.getDirectoryHandle(fName);
                  const data = await inspectDirectoryHandle(targetSub);
                  updateRestorePreviewUI(data);
                  showRestoreStep(2);
                });
              });
              showRestoreStep(1);
            }
          } else {
            alert("⚠️ در پوشه انتخابی هیچ فایل یا زیرپوشه بک‌آپی پیدا نشد.");
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn("خطا در انتخاب پوشه:", err);
          fallbackInput?.click();
        }
      }
    } else {
      fallbackInput?.click();
    }
  });

  // فال‌بک ورودی پوشه در تمام مرورگرها
  fallbackInput?.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      const data = await inspectFilesList(files);
      if (
        !data ||
        (!data.invoices.length &&
          !data.products.length &&
          !data.proformas.length &&
          !data.customers.length)
      ) {
        alert("⚠️ در فایل‌های این پوشه اطلاعات معتبری از بک‌آپ یافت نشد.");
        return;
      }
      updateRestorePreviewUI(data);
      showRestoreStep(2);
    } catch (err) {
      alert("خطا در پردازش فایل‌های پوشه: " + err.message);
    } finally {
      fallbackInput.value = "";
    }
  });

  // اجرای بازیابی
  btnExecute?.addEventListener("click", async () => {
    if (!pendingRestoreData) return;
    const replace = Boolean(replaceCheck?.checked);
    await executeLocalRestore(pendingRestoreData, replace);
  });
}

/* =========================================================================
   راه‌اندازی ماژول پشتیبان‌گیری
   ========================================================================= */
export async function initBackup() {
  fileHandle = await idbGet(FILE_HANDLE_KEY).catch(() => null);
  dirHandle = await idbGet(DIR_HANDLE_KEY).catch(() => null);

  // دکمه‌های نسخه تک‌فایل
  document
    .getElementById("btn-backup-connect")
    ?.addEventListener("click", connectBackupFile);
  document
    .getElementById("btn-backup-disconnect")
    ?.addEventListener("click", () => {
      if (confirm("اتصال ذخیره خودکار قطع شود؟")) disconnectBackupFile();
    });
  document
    .getElementById("btn-export-json")
    ?.addEventListener("click", exportAllData);

  const fileInput = document.getElementById("import-file");
  document
    .getElementById("btn-import-json")
    ?.addEventListener("click", () => fileInput.click());
  fileInput?.addEventListener("change", () => {
    if (fileInput.files[0]) importInvoicesFile(fileInput.files[0]);
    fileInput.value = "";
  });

  // دکمه‌ها و رویدادهای پشتیبان‌گیری محلی در پوشه سیستم
  document
    .getElementById("btn-local-dir-select")
    ?.addEventListener("click", selectBackupDirectory);

  document
    .getElementById("btn-local-dir-disconnect")
    ?.addEventListener("click", () => {
      if (confirm("اتصال پوشه محلی قطع شود؟")) {
        disconnectBackupDirectory();
      }
    });

  document
    .getElementById("btn-local-backup-now")
    ?.addEventListener("click", () => {
      performLocalFolderBackup({ trigger: "manual", showToast: true });
    });

  // رویداد تغییر بازه زمانی
  document
    .getElementById("local-backup-interval")
    ?.addEventListener("change", (e) => {
      const val = Number(e.target.value) || 0;
      const s = store.getSettings();
      store.saveSettings({
        ...s,
        localFolderBackup: {
          ...(s.localFolderBackup || {}),
          intervalMinutes: val,
        },
      });
      showBackupToast(
        val === 0
          ? "بک‌آپ خودکار زمان‌بندی‌شده غیرفعال شد"
          : `بازه زمانی بک‌آپ خودکار روی هر ${val} دقیقه تنظیم شد`,
      );
    });

  // رویداد فعال‌سازی بک‌آپ با Push
  document
    .getElementById("local-backup-on-push")
    ?.addEventListener("change", (e) => {
      const checked = Boolean(e.target.checked);
      const s = store.getSettings();
      store.saveSettings({
        ...s,
        localFolderBackup: {
          ...(s.localFolderBackup || {}),
          onPush: checked,
        },
      });
      showBackupToast(
        checked
          ? "بک‌آپ محلی هنگام هر Push فعال شد"
          : "بک‌آپ محلی هنگام Push غیرفعال شد",
      );
    });

  // رویداد تایید خودکار روز جدید
  document
    .getElementById("local-backup-auto-confirm-new-day")
    ?.addEventListener("change", (e) => {
      const checked = Boolean(e.target.checked);
      const s = store.getSettings();
      store.saveSettings({
        ...s,
        localFolderBackup: {
          ...(s.localFolderBackup || {}),
          autoConfirmNewDay: checked,
        },
      });
    });

  await refreshStatus();
  await refreshLocalFolderUI();
  initLocalBackupInterval();
  initLocalRestoreUI();
}
