import { RATE_CATEGORIES } from "../data/rates.js";
import { store, faNum, todayFa, toEnDigits } from "./store.js";
import { addItemToInvoice, initInvoiceEvents } from "./invoice.js";
import {
  renderProducts,
  initProductEvents,
  addProductToInvoice,
} from "./products.js";
import { initInvoicesList } from "./invoices-list.js";
import { initProformasList, updateProformaBadge } from "./proformas-list.js";
import { initAuth } from "./auth.js";
import { initBackup, autoSaveInvoices } from "./backup.js";
import { initGitHubUI, autoPushGitHub, initOfflineSyncManager } from "./github.js";
import { initReports } from "./reports.js"; // ✅ اضافه شد
import { initCustomers, renderCustomers } from "./customers.js";
import { initCustomerPortal } from "./customer-portal.js";
import { autoPushPublicRepo } from "./github.js";
import { initAnnouncements, renderAnnouncements } from "./announcements.js";
import { enhanceAllSelects } from "./nice-select.js";

// لیست رسمی بانک‌های کشور جهت دراپ‌داون کارت‌های بانکی
export const IRANIAN_BANKS = [
  { name: "بانک ملی ایران", icon: "🏛️" },
  { name: "بانک ملت", icon: "🔴" },
  { name: "بانک صادرات ایران", icon: "🔵" },
  { name: "بانک تجارت", icon: "🔷" },
  { name: "بانک سپه", icon: "🟡" },
  { name: "بانک کشاورزی", icon: "🌾" },
  { name: "بانک مسکن", icon: "🏠" },
  { name: "بانک پاسارگاد", icon: "💛" },
  { name: "بانک سامان", icon: "🌐" },
  { name: "بانک پارسیان", icon: "🟣" },
  { name: "بانک اقتصاد نوین", icon: "🏢" },
  { name: "بانک آینده", icon: "💠" },
  { name: "بانک شهر", icon: "🏙️" },
  { name: "بانک قرض‌الحسنه رسالت", icon: "🌿" },
  { name: "بانک قرض‌الحسنه مهر ایران", icon: "☀️" },
  { name: "بانک رفاه کارگران", icon: "👥" },
  { name: "بانک سینا", icon: "🏛️" },
  { name: "بانک دی", icon: "🔶" },
  { name: "بانک گردشگری", icon: "✈️" },
  { name: "بانک ایران‌زمین", icon: "🌏" },
  { name: "بانک کارآفرین", icon: "💼" },
  { name: "بانک سرمایه", icon: "🪙" },
  { name: "بانک خاورمیانه", icon: "🌐" },
  { name: "بانک توسعه تعاون", icon: "🤝" },
  { name: "بانک صنعت و معدن", icon: "🏭" },
  { name: "پست بانک ایران", icon: "📬" },
  { name: "موسسه اعتباری ملل", icon: "🏦" },
  { name: "موسسه اعتباری نور", icon: "🏦" },
  { name: "سایر بانک‌ها و موسسات", icon: "💳" },
];

const el = {
  tabs: document.querySelectorAll(".view-tab"),
  views: {
    invoice: document.getElementById("view-invoice"),
    products: document.getElementById("view-products"),
    reports: document.getElementById("view-reports"),
    invoices: document.getElementById("view-invoices"),
    proformas: document.getElementById("view-proformas"), // ✅ تب جدید پیش‌فاکتورها
    "invoice-detail": document.getElementById("view-invoice-detail"),
    settings: document.getElementById("view-settings"),
    customers: document.getElementById("view-customers"),
    announcements: document.getElementById("view-announcements"), // ✅ اضافه شد
  },
  srcTabs: document.querySelectorAll(".src-tab"),
  search: document.getElementById("search-input"),
  items: document.getElementById("items-list"),
};

let currentView = "invoice";
let currentSource = "services"; // services | products
let expandedCategories = new Set(); // دسته‌بندی‌های باز شده

// ---------- ناوبری بین ویوها ----------
function setView(view) {
  currentView = view;

  Object.entries(el.views).forEach(([k, v]) => {
    if (v) v.classList.toggle("hidden", k !== view);
  });

  // ✅ فقط یک کلاس active — استایل‌ها در CSS با پشتیبانی دارک‌مود تعریف شده‌اند
  el.tabs.forEach((t) => {
    t.classList.toggle("active", t.dataset.view === view);
  });

  // مدیریت نمایش تب «مشاهده فاکتور» (فقط hidden شدن، بدون دستکاری رنگ)
  const detailTab = document.getElementById("tab-invoice-detail");
  if (view === "invoice-detail") {
    detailTab?.classList.remove("hidden");
  } else if (view !== "invoices" && view !== "proformas" && view !== "invoice-detail") {
    detailTab?.classList.add("hidden");
  }

  if (view === "products") renderProducts();
  if (view === "reports") initReports();
  if (view === "invoices") initInvoicesList();
  if (view === "proformas") initProformasList();
  if (view === "customers") renderCustomers();
  if (view === "announcements") renderAnnouncements();
  if (el.views[view]) {
    setTimeout(() => enhanceAllSelects(el.views[view]), 60);
  }
}

window.setView = setView;

el.tabs.forEach((t) =>
  t.addEventListener("click", () => setView(t.dataset.view)),
);

// ---------- تغییر منبع (خدمات / محصولات) ----------
function setSource(src) {
  currentSource = src;
  expandedCategories.clear();
  el.srcTabs.forEach((b) => {
    const active = b.dataset.src === src;
    b.className = `src-tab px-4 py-1.5 rounded-full text-xs font-bold ${
      active ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-600"
    }`;
  });
  renderItems();
}

el.srcTabs.forEach((b) =>
  b.addEventListener("click", () => setSource(b.dataset.src)),
);

// ---------- سرچ سریع (ایندکس ساده برای سرعت) ----------
function getAllServices() {
  return getCategories().flatMap((c) =>
    c.items.map((i) => ({ ...i, catId: c.id, catTitle: c.title })),
  );
}

function searchServices(q) {
  const categories = getCategories();
  if (!q) return categories; // برگرداندن تمام دسته‌های موجود و جدید

  const query = q.trim().toLowerCase();
  return categories
    .map((c) => {
      const catMatch = c.title.toLowerCase().includes(query);
      const items = catMatch
        ? c.items
        : c.items.filter((i) => i.title.toLowerCase().includes(query));
      return { ...c, items, match: catMatch || items.length > 0 };
    })
    .filter((c) => c.match);
}

function renderItems() {
  const q = el.search.value.trim();

  if (currentSource === "services") {
    let categories = searchServices(q);

    el.items.innerHTML = categories.length
      ? categories
          .map((c) => {
            const isExpanded = expandedCategories.has(c.id);
            return `
        <div class="bg-white border border-slate-200 rounded-xl overflow-hidden fade-in">
          <!-- سر‌دسته خدمات -->
     
          <div data-cat-id="${c.id}" class="cat-header flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/60 transition ${isExpanded ? "bg-brand-50 dark:bg-slate-700/40" : ""}">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-lg">${isExpanded ? "🔽" : "▶️"}</span>
              <p class="text-sm font-bold truncate text-slate-800 dark:text-slate-100">${c.title}</p>
            
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <span class="text-xs text-slate-400 shrink-0 ml-1">${faNum(c.items.length)} خدمت</span>
              <button data-quick-add-to-cat="${c.id}" title="ویرایش یا افزودن به این دسته" class="text-[11px] bg-brand-50 dark:bg-slate-700 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-slate-600 px-2.5 py-1 rounded-lg font-bold border border-brand-200 dark:border-slate-600 transition">
                ✏️ ویرایش
              </button>
              ${c.custom ? `<button data-del-cat="${c.id}" title="حذف این دسته‌بندی" class="text-xs bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 px-2 py-1 rounded-lg border border-rose-200 dark:border-rose-900/40 font-bold transition">🗑️ حذف دسته</button>` : ""}
            </div>
          </div>
          <!-- زیرمجموعه‌ها -->
          <div class="cat-items space-y-2 p-3 ${isExpanded ? "" : "hidden"}">
            ${c.items
              .map(
                (s) => `
              <div class="bg-slate-50 border border-slate-100 rounded-lg p-2.5 flex items-center justify-between gap-3 hover:border-brand-400 transition">
                <div class="min-w-0">
                  <p class="text-sm font-bold truncate text-slate-700">${s.title}</p>
                </div>
                <div class="shrink-0 text-left">
                  <p class="text-xs font-extrabold text-brand-700">${faNum(s.price)} تومان</p>
                  <button data-add-service="${s.id}" class="mt-1 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-lg font-bold">+ فاکتور</button>
                </div>
              </div>`,
              )
              .join("")}
          </div>
        </div>`;
          })
          .join("")
      : `<p class="text-center text-slate-400 text-sm py-10">موردی یافت نشد.</p>`;

    // افزودن ایونت برای کلیک روی سر‌دسته‌ها
    setTimeout(() => {
      // کلیک روی آکاردئون دسته‌ها (جلوگیری از تداخل با دکمه حذف و ویرایش)
      document.querySelectorAll(".cat-header").forEach((header) => {
        header.addEventListener("click", (e) => {
          if (
            e.target.closest("[data-del-cat]") ||
            e.target.closest("[data-quick-add-to-cat]")
          ) {
            return; // اگر روی دکمه حذف یا ویرایش کلیک شد، آکاردئون باز/بسته نشود
          }
          const catId = header.dataset.catId;
          if (expandedCategories.has(catId)) {
            expandedCategories.delete(catId);
          } else {
            expandedCategories.add(catId);
          }
          renderItems();
        });
      });
    }, 0);

    return;
  }

  // منبع: محصولات فیزیکی
  const products = store.getProducts().filter((p) => !q || p.name.includes(q));

  el.items.innerHTML = products.length
    ? products
        .map((p) => {
          const cat = store.getProductCategory(p.categoryId);
          return `
      <div class="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 hover:border-brand-500 transition fade-in">
        <div class="w-14 h-14 rounded-xl bg-slate-100 grid place-items-center overflow-hidden shrink-0">
          ${p.image ? `<img src="${p.image}" class="w-full h-full object-cover" />` : "📦"}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <p class="text-sm font-bold truncate">${p.name}</p>
            ${
              cat
                ? `<span class="text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded">${cat.icon || "📦"} ${cat.name}</span>`
                : ""
            }
          </div>
          <div class="flex items-center gap-2 mt-0.5">
            <p class="text-[11px] text-slate-500 dark:text-slate-400 font-mono">${faNum(p.price)} تومان</p>
            ${
              (p.quantity ?? 0) > 0
                ? `<span class="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.2 rounded border border-emerald-200 dark:border-emerald-800">موجودی: ${faNum(p.quantity)}</span>`
                : `<span class="text-[9px] font-bold text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.2 rounded border border-rose-200 dark:border-rose-800">ناموجود</span>`
            }
          </div>
          ${p.variants?.length ? `<p class="text-[10px] text-slate-400 mt-1">${p.variants.map((v) => `${v.name} (${(v.quantity ?? 0) > 0 ? faNum(v.quantity) : "ناموجود"})`).join(" | ")}</p>` : ""}
        </div>
        <div class="shrink-0 flex flex-col gap-1">
          <button data-add-product="${p.id}" class="text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-lg font-bold">+ فاکتور</button>
          ${
            p.variants?.length
              ? p.variants
                  .map((v) => {
                    const vInStock = (v.quantity ?? 0) > 0;
                    return `<button data-add-product="${p.id}" data-variant-id="${v.id}" class="text-[10px] ${
                      vInStock
                        ? "bg-brand-50 text-brand-700 border-brand-100 hover:bg-brand-100"
                        : "bg-rose-50 text-rose-500 border-rose-200 opacity-75"
                    } px-2 py-1 rounded-lg border flex items-center justify-between gap-1"><span>${v.name} · ${faNum(v.price)}</span><span class="text-[9px] font-mono">(${vInStock ? faNum(v.quantity) : "۰"})</span></button>`;
                  })
                  .join("")
              : ""
          }
        </div>
      </div>`;
        })
        .join("")
    : `<p class="text-center text-slate-400 text-sm py-10">محصولی یافت نشد.</p>`;
}

// debounce ساده برای سرچ
let searchTimer;
el.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderItems, 120);
});

// کلیک برای افزودن به فاکتور
// مدیریت کلیک روی خدمات و دکمه‌های افزودن / حذف
// رویدادهای کلیک روی آیتم‌ها و دکمه‌های حذف/ویرایش
el.items.addEventListener("click", (e) => {
  const quickCatBtn = e.target.closest("[data-quick-add-to-cat]");
  const delCatBtn = e.target.closest("[data-del-cat]");
  const delItemBtn = e.target.closest("[data-del-item]");
  const addServiceBtn = e.target.closest("[data-add-service]");
  const addProductBtn = e.target.closest("[data-add-product]");

  // باز کردن فرم ویرایش دسته
  if (quickCatBtn) {
    window.openAddServiceModal(quickCatBtn.dataset.quickAddToCat);
    return;
  }

  // ✅ حذف کامل یک دسته‌بندی سفارشی
  if (delCatBtn) {
    const catId = delCatBtn.dataset.delCat;
    if (
      confirm(
        "⚠️ آیا از حذف کامل این دسته‌بندی و تمامی خدمات درون آن اطمینان دارید؟",
      )
    ) {
      store.deleteCategory(catId);
      expandedCategories.delete(catId);
      renderItems();

      // همگام‌سازی آنی با فایل و گیت‌هاب (پابلیک و پرایوت)
      autoSaveInvoices();
      autoPushGitHub("حذف دسته‌بندی نرخ‌نامه");
      toast("دسته‌بندی با موفقیت حذف شد 🗑️");
    }
    return;
  }

  // حذف یک خدمت مشخص از درون دسته
  if (delItemBtn) {
    const catId = delItemBtn.dataset.catId;
    const itemId = delItemBtn.dataset.delItem;
    if (confirm("این خدمت حذف شود؟")) {
      store.deleteServiceItem(catId, itemId);
      renderItems();
      autoSaveInvoices();
      autoPushGitHub("حذف خدمت از نرخ‌نامه");
      toast("خدمت حذف شد 🗑️");
    }
    return;
  }

  if (addServiceBtn) {
    const sId = addServiceBtn.dataset.addService;
    const s = getAllServices().find((x) => x.id === sId);
    if (s) {
      addItemToInvoice({ title: s.title, price: s.price, meta: s.catTitle });
      toast("به فاکتور اضافه شد 🧾");
    }
    return;
  }

  if (addProductBtn) {
    const pId = addProductBtn.dataset.addProduct;
    const vId = addProductBtn.dataset.variantId;
    addProductToInvoice(store.getProduct(pId), vId || null);
  }
});

// دریافت خدمات داینامیک از Store (حل مشکل دیده نشدن دسته جدید)
function getCategories() {
  return store.getServices();
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2000);
}

// ---------- لوگوی نوبار ----------

// ---------- لوگوی نوبار ----------
function updateNavLogo() {
  const box = document.getElementById("nav-logo");
  if (!box) return;
  const shop = store.getShopInfo();
  if (shop.logo) {
    box.innerHTML = `<img src="${shop.logo}" class="w-full h-full object-contain" alt="لوگو" />`;
    box.classList.remove("bg-brand-600", "text-white");
    box.classList.add("bg-white", "dark:bg-slate-700", "p-1");
  } else {
    box.innerHTML = "ک";
    box.classList.add("bg-brand-600", "text-white");
    box.classList.remove("bg-white", "dark:bg-slate-700", "p-1");
  }
}

// ---------- حساب‌های بانکی (چند کارتی) ----------
let bankAccounts = [];

function renderBankAccounts() {
  const list = document.getElementById("bank-accounts-list");
  const empty = document.getElementById("bank-empty");
  if (!list) return;
  empty?.classList.toggle("hidden", bankAccounts.length > 0);
  list.innerHTML = bankAccounts
    .map(
      (b, i) => `
      <div class="border border-slate-200 dark:border-slate-700 rounded-2xl p-3.5 space-y-3 bg-white dark:bg-slate-800/90 shadow-sm fade-in" data-bank-row="${i}">
        <div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 pb-2">
          <span class="text-xs font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <span class="text-base">💳</span> کارت ${faNum(i + 1)}
          </span>
          <button type="button" data-bank-del="${i}" class="text-xs text-rose-600 dark:text-rose-400 font-bold hover:bg-rose-50 dark:hover:bg-slate-700 px-2.5 py-1 rounded-xl transition">
            🗑️ حذف کارت
          </button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div>
            <label class="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">نام بانک:</label>
            <select data-bank-field="bank" data-bank-i="${i}"
              class="w-full rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-slate-800 font-medium">
              <option value="">🏦 انتخاب نام بانک...</option>
              ${IRANIAN_BANKS.map((bank) => {
                const isSelected =
                  b.bank === bank.name ||
                  (b.bank && (bank.name.includes(b.bank) || b.bank.includes(bank.name.replace("بانک ", ""))));
                return `<option value="${bank.name}" ${isSelected ? "selected" : ""}>${bank.icon} ${bank.name}</option>`;
              }).join("")}
              ${
                b.bank && !IRANIAN_BANKS.some((x) => x.name === b.bank || b.bank.includes(x.name.replace("بانک ", "")))
                  ? `<option value="${b.bank}" selected>💳 ${b.bank}</option>`
                  : ""
              }
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">نام صاحب حساب:</label>
            <input data-bank-field="holder" data-bank-i="${i}" value="${b.holder || ""}" placeholder="مثال: محمد رضایی"
              class="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 bg-slate-50/50 dark:bg-slate-900/60 text-slate-800 dark:text-slate-100 transition" />
          </div>
          <div>
            <label class="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">شماره کارت (۱۶ رقم):</label>
            <input data-bank-field="card" data-bank-i="${i}" value="${b.card || ""}" inputmode="numeric" dir="ltr" placeholder="6037 9912 3456 7890"
              class="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-left font-mono outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 bg-slate-50/50 dark:bg-slate-900/60 text-slate-800 dark:text-slate-100 transition" />
          </div>
          <div>
            <label class="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">شماره شبا (با IR):</label>
            <input data-bank-field="sheba" data-bank-i="${i}" value="${b.sheba || ""}" dir="ltr" placeholder="IR000000000000000000000000"
              class="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-left font-mono outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 bg-slate-50/50 dark:bg-slate-900/60 text-slate-800 dark:text-slate-100 transition" />
          </div>
        </div>
      </div>`,
    )
    .join("");

  enhanceAllSelects(list);
}

function initBankAccounts() {
  bankAccounts = (store.getShopInfo().bankAccounts || []).map((b) => ({
    ...b,
  }));
  renderBankAccounts();

  document.getElementById("btn-add-bank")?.addEventListener("click", () => {
    bankAccounts.push({ bank: "", card: "", holder: "", sheba: "" });
    renderBankAccounts();
  });

  const list = document.getElementById("bank-accounts-list");
  const handleBankFieldUpdate = (e) => {
    const i = e.target.dataset.bankI;
    const field = e.target.dataset.bankField;
    if (i === undefined || !field) return;
    bankAccounts[Number(i)][field] = e.target.value;
  };
  list?.addEventListener("input", handleBankFieldUpdate);
  list?.addEventListener("change", handleBankFieldUpdate);

  list?.addEventListener("click", (e) => {
    const del = e.target.dataset.bankDel;
    if (del === undefined) return;
    if (!confirm("این کارت بانکی حذف شود؟")) return;
    bankAccounts.splice(Number(del), 1);
    renderBankAccounts();

    // ذخیره آنی تغییر کارت‌ها و push به پابلیک
    const banks = collectBankAccounts();
    if (banks !== null) {
      store.saveShopInfo({ ...store.getShopInfo(), bankAccounts: banks });
      autoSaveInvoices();
      autoPushGitHub("حذف کارت بانکی");
    }
  });
}

// جمع‌آوری + اعتبارسنجی کارت‌ها هنگام ذخیره
function collectBankAccounts() {
  const banks = bankAccounts
    .map((b) => ({
      bank: (b.bank || "").trim(),
      holder: (b.holder || "").trim(),
      card: toEnDigits(b.card || "").replace(/[\s\-./]/g, ""),
      sheba: toEnDigits(b.sheba || "")
        .replace(/\s/g, "")
        .toUpperCase(),
    }))
    .filter((b) => b.bank || b.card || b.holder || b.sheba);

  for (const b of banks) {
    if (b.card && !/^\d{16}$/.test(b.card)) {
      alert(
        `❌ شماره کارت بانک «${b.bank || "نامشخص"}» باید دقیقاً ۱۶ رقم باشد.`,
      );
      return null;
    }
    if (b.sheba && !/^IR\d{24}$/.test(b.sheba)) {
      alert("❌ شبا باید با IR شروع شود و در مجموع ۲۶ کاراکتر باشد.");
      return null;
    }
  }
  return banks;
}

/* ============================================================
   مودال پیشرفته مدیریت و تعریف خدمات (ورود چندتایی + ادیت دسته‌ها)
============================================================ */
function initServiceModal() {
  const modal = document.getElementById("service-form-modal");
  if (!modal || modal.dataset.bound) return;
  modal.dataset.bound = "1";

  const btnOpen = document.getElementById("btn-open-service-modal");
  const btnClose = document.getElementById("btn-close-service-modal");
  const btnCancel = document.getElementById("btn-cancel-service-modal");
  const form = document.getElementById("service-form");

  const tabExisting = document.getElementById("sf-tab-existing");
  const tabNew = document.getElementById("sf-tab-new");
  const selectCatWrapper = document.getElementById("sf-select-cat-wrapper");
  const catSelect = document.getElementById("sf-cat-select");
  const catTitleInput = document.getElementById("sf-cat-title-input");
  const rowsContainer = document.getElementById("sf-rows-container");
  const btnAddRow = document.getElementById("btn-add-service-row");

  let isNewCategoryMode = false;
  let currentRows = []; // لیست سطرهای در حال ویرایش

  // ساخت HTML سطرهای خدمت
  function renderRows() {
    if (!currentRows.length) {
      currentRows.push({ id: "", title: "", price: "" });
    }
    rowsContainer.innerHTML = currentRows
      .map(
        (row, idx) => `
      <div class="flex items-center gap-2 bg-slate-50 dark:bg-slate-700/50 p-2 rounded-xl border border-slate-200 dark:border-slate-600">
        <span class="w-5 text-center text-xs font-bold text-slate-400">${faNum(idx + 1)}</span>
        <input data-row-title="${idx}" value="${row.title || ""}" placeholder="عنوان خدمت (مثلاً: ثبت اظهارنامه)"
          class="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand-500" />
        <input data-row-price="${idx}" type="number" min="0" value="${row.price || ""}" placeholder="قیمت (تومان)"
          class="w-28 sm:w-32 rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-brand-500 text-left font-mono" />
        <button type="button" data-row-del="${idx}" title="حذف این سطر"
          class="w-7 h-7 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-slate-600 font-bold text-sm grid place-items-center">✕</button>
      </div>`,
      )
      .join("");
  }

  const btnDeleteModalCat = document.getElementById("btn-delete-modal-cat");

  function loadCategoryForEdit(catId) {
    const cats = store.getServices();
    const cat = cats.find((c) => c.id === catId);
    if (!cat) return;

    catTitleInput.value = cat.title || "";
    currentRows = (cat.items || []).map((it) => ({
      id: it.id,
      title: it.title,
      price: it.price,
    }));
    renderRows();

    // اگر دسته جدید/سفارشی است، دکمه حذف نمایش داده شود
    if (btnDeleteModalCat) {
      btnDeleteModalCat.classList.toggle("hidden", !cat.custom);
    }
  }

  // کلیک روی دکمه حذف دسته از درون مودال
  btnDeleteModalCat?.addEventListener("click", () => {
    const catId = catSelect.value;
    if (!catId) return;
    if (confirm("⚠️ آیا از حذف کامل این دسته‌بندی اطمینان دارید؟")) {
      store.deleteCategory(catId);
      expandedCategories.delete(catId);
      closeModal();
      renderItems();
      autoSaveInvoices();
      autoPushGitHub("حذف دسته‌بندی نرخ‌نامه");
      toast("دسته‌بندی با موفقیت حذف شد 🗑️");
    }
  });

  function setMode(newMode) {
    isNewCategoryMode = newMode;
    if (isNewCategoryMode) {
      tabNew.className =
        "flex-1 py-2 rounded-lg bg-white dark:bg-slate-800 text-brand-700 dark:text-brand-400 shadow-sm transition";
      tabExisting.className =
        "flex-1 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-brand-600 transition";
      selectCatWrapper.classList.add("hidden");
      catTitleInput.value = "";
      currentRows = [{ id: "", title: "", price: "" }];
      renderRows();
      if (btnDeleteModalCat) btnDeleteModalCat.classList.add("hidden");
    } else {
      tabExisting.className =
        "flex-1 py-2 rounded-lg bg-white dark:bg-slate-800 text-brand-700 dark:text-brand-400 shadow-sm transition";
      tabNew.className =
        "flex-1 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-brand-600 transition";
      selectCatWrapper.classList.remove("hidden");
      fillSelect();
    }
  }

  function fillSelect(preselectedId = "") {
    const cats = store.getServices();
    catSelect.innerHTML = `
      <option value="">-- انتخاب دسته‌بندی --</option>
      ${cats
        .map(
          (c) =>
            `<option value="${c.id}" ${c.id === preselectedId ? "selected" : ""}>${c.title}</option>`,
        )
        .join("")}
    `;

    if (preselectedId) {
      catSelect.value = preselectedId;
      loadCategoryForEdit(preselectedId);
    } else {
      catSelect.value = "";
      catTitleInput.value = "";
      currentRows = [{ id: "", title: "", price: "" }];
      renderRows();
      if (btnDeleteModalCat) btnDeleteModalCat.classList.add("hidden");
    }

    if (typeof enhanceAllSelects === "function") {
      enhanceAllSelects(selectCatWrapper);
    }
  }

  window.openAddServiceModal = function (preselectedCatId = "") {
    fillSelect(preselectedCatId);
    setMode(false);
    if (preselectedCatId) {
      catSelect.value = preselectedCatId;
      loadCategoryForEdit(preselectedCatId);
    } else {
      catSelect.value = "";
      catTitleInput.value = "";
      currentRows = [{ id: "", title: "", price: "" }];
      renderRows();
      if (btnDeleteModalCat) btnDeleteModalCat.classList.add("hidden");
    }
    modal.classList.remove("hidden");
    if (typeof enhanceAllSelects === "function") {
      setTimeout(() => enhanceAllSelects(modal), 40);
    }
  };

  const closeModal = () => {
    modal.classList.add("hidden");
    catTitleInput.value = "";
    catSelect.value = "";
    currentRows = [{ id: "", title: "", price: "" }];
    renderRows();
  };

  btnOpen?.addEventListener("click", () => window.openAddServiceModal());
  btnClose?.addEventListener("click", closeModal);
  btnCancel?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => e.target === modal && closeModal());

  tabExisting?.addEventListener("click", () => setMode(false));
  tabNew?.addEventListener("click", () => setMode(true));

  // با تغییر انتخاب دراپ‌داون، خدمات آن دسته بارگذاری می‌شوند
  catSelect?.addEventListener("change", () => {
    if (catSelect.value) {
      loadCategoryForEdit(catSelect.value);
    } else {
      catTitleInput.value = "";
      currentRows = [{ id: "", title: "", price: "" }];
      renderRows();
      if (btnDeleteModalCat) btnDeleteModalCat.classList.add("hidden");
    }
  });

  // دکمه افزودن سطر جدید
  btnAddRow?.addEventListener("click", () => {
    currentRows.push({ id: "", title: "", price: "" });
    renderRows();
  });

  // ثبت و همگام‌سازی ورودی‌های درون سطرها
  rowsContainer?.addEventListener("input", (e) => {
    const tIdx = e.target.dataset.rowTitle;
    const pIdx = e.target.dataset.rowPrice;
    if (tIdx !== undefined) currentRows[Number(tIdx)].title = e.target.value;
    if (pIdx !== undefined) currentRows[Number(pIdx)].price = e.target.value;
  });

  // حذف یک سطر در فرم
  rowsContainer?.addEventListener("click", (e) => {
    const dIdx = e.target.closest("[data-row-del]")?.dataset.rowDel;
    if (dIdx !== undefined) {
      currentRows.splice(Number(dIdx), 1);
      renderRows();
    }
  });

  // ثبت نهایی فرم
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const catTitle = catTitleInput.value.trim();
    if (!catTitle) return alert("نام دسته‌بندی الزامی است.");

    // فیلتر سطرهای معتبر (سطرهایی که عنوان دارند)
    const validItems = currentRows
      .filter((r) => r.title && r.title.trim())
      .map((r) => ({
        id: r.id || "",
        title: r.title.trim(),
        price: Number(r.price) || 0,
      }));

    if (!validItems.length) {
      return alert("حداقل یک خدمت با عنوان مشخص در سطرها وارد کنید.");
    }

    if (isNewCategoryMode) {
      // ایجاد دسته جدید به همراه تمام خدماتش
      const newCat = store.saveNewCategory(catTitle, validItems);
      expandedCategories.add(newCat.id);
    } else {
      // بروزرسانی دسته موجود و تمام خدمات آن
      const targetCatId = catSelect.value;
      store.updateCategoryItems(targetCatId, catTitle, validItems);
      expandedCategories.add(targetCatId);
    }

    closeModal();
    renderItems(); // نمایش فوری در لیست

    // بک‌آپ آنی محلی و ارسال به گیت‌هاب (ریپوی خصوصی و پابلیک)
    autoSaveInvoices();
    autoPushGitHub("ویرایش نرخ‌نامه و خدمات");

    toast("✅ دسته‌بندی و خدمات با موفقیت ذخیره و همگام شدند");
  });
}
// ---------- تنظیمات کسب‌وکار ----------
function initSettings() {
  const shop = store.getShopInfo();

  initBankAccounts(); // ✅ بارگذاری کارت‌های ذخیره‌شده
  document.getElementById("shop-name").value = shop.name || "";
  document.getElementById("shop-slogan").value = shop.slogan || "";
  document.getElementById("shop-phone").value = shop.phone || "";
  document.getElementById("shop-address").value = shop.address || "";

  const logoPreview = document.getElementById("logo-preview");
  const logoPlaceholder = document.getElementById("logo-placeholder");
  if (shop.logo) {
    logoPreview.innerHTML = `<img src="${shop.logo}" class="w-full h-full object-contain" />`;
  }

  let tempLogo = shop.logo || "";

  document.getElementById("shop-logo").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      tempLogo = reader.result;
      logoPreview.innerHTML = `<img src="${tempLogo}" class="w-full h-full object-contain" />`;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("btn-remove-logo").addEventListener("click", () => {
    tempLogo = "";
    logoPreview.innerHTML = '<span id="logo-placeholder">🖼️</span>';
    store.saveShopInfo({ ...store.getShopInfo(), logo: "" });
    document.getElementById("shop-logo").value = "";
    autoSaveInvoices();
    autoPushGitHub("حذف لوگوی کسب‌وکار");
  });
  document.getElementById("btn-save-shop").addEventListener("click", () => {
    const info = {
      name:
        document.getElementById("shop-name").value.trim() || "کافی‌نت آنلاین",
      slogan: document.getElementById("shop-slogan").value.trim(),
      phone: document.getElementById("shop-phone").value.trim(),
      address: document.getElementById("shop-address").value.trim(),
      logo: tempLogo,
    };

    if (typeof collectBankAccounts === "function") {
      const banks = collectBankAccounts();
      if (banks === null) return; // اعتبارسنجی رد شد → ذخیره نشود
      info.bankAccounts = banks;
    }

    store.saveShopInfo(info);

    if (typeof updateNavLogo === "function") updateNavLogo();
    autoSaveInvoices();
    autoPushGitHub("بروزرسانی اطلاعات کسب‌وکار");

    const toast = document.getElementById("toast");
    toast.textContent = "✅ تنظیمات ذخیره شد + روی ریپوی پابلیک بروزرسانی شد";
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2200);
  });

  // ---------- حالت توسعه و ریست کامل ----------
  const devToggle = document.getElementById("dev-mode-toggle");
  const dangerZone = document.getElementById("danger-zone");

  // نمایش/مخفی‌کردن منطقه خطر بر اساس حالت توسعه
  const applyDevMode = (on) => {
    dangerZone.classList.toggle("hidden", !on);
  };

  // بارگذاری وضعیت ذخیره‌شده
  const settings = store.getSettings();
  devToggle.checked = !!settings.devMode;
  applyDevMode(devToggle.checked);

  // تغییر سوییچ توسعه
  devToggle.addEventListener("change", () => {
    store.saveSettings({ ...store.getSettings(), devMode: devToggle.checked });
    applyDevMode(devToggle.checked);
  });

  // دکمه ریست کامل با تأییدیه دومرحله‌ای
  document.getElementById("btn-reset-all").addEventListener("click", () => {
    if (
      !confirm(
        "⚠️ مطمئن هستید؟\nتمامی فاکتورها، محصولات، تنظیمات کسب‌وکار و شمارنده‌ها حذف خواهند شد!",
      )
    )
      return;

    if (
      !confirm(
        "❌ تأیید نهایی:\nاین عملیات غیرقابل بازگشت است.\nبرای حذف کامل اطلاعات، OK را بزنید.",
      )
    )
      return;

    store.resetAll();
    alert("✅ تمامی اطلاعات حذف شد. برنامه به حالت اولیه برمی‌گردد.");
    location.reload();
  });

  // ---------- تغییر رمز عبور ----------
  document.getElementById("btn-change-pass").addEventListener("click", () => {
    const cur = document.getElementById("pass-current").value;
    const nw = document.getElementById("pass-new").value;
    const cf = document.getElementById("pass-confirm").value;

    if (nw.length < 4) return alert("رمز جدید باید حداقل ۴ کاراکتر باشد.");
    if (nw !== cf) return alert("تکرار رمز با رمز جدید یکسان نیست.");
    if (!store.changePassword(cur, nw)) return alert("رمز فعلی اشتباه است.");

    document.getElementById("pass-current").value = "";
    document.getElementById("pass-new").value = "";
    document.getElementById("pass-confirm").value = "";
    alert("✅ رمز عبور با موفقیت تغییر کرد.");
  });
}

// ---------- init ----------
// ---------- تشخیص نقش از آدرس ----------
// ?role=customer  → پورتال مشتری (فقط نرخ‌نامه)
// ?role=admin یا بدون پارامتر → مدیریت کامل
// تشخیص هوشمند نقش برنامه با پشتیبانی از PWA نصب‌شده روی گوشی مشتری
function getAppRole() {
  const urlParams = new URLSearchParams(window.location.search);
  const roleParam = urlParams.get("role")?.toLowerCase();

  // ۱. اگر در آدرس صراحتاً نقش مشخص شده باشد
  if (roleParam === "customer" || window.location.hash === "#customer") {
    localStorage.setItem("cafe_app_role", "customer");
    return "customer";
  }
  if (roleParam === "admin" || window.location.hash === "#admin") {
    localStorage.setItem("cafe_app_role", "admin");
    return "admin";
  }

  // ۲. بررسی حالت اپلیکیشن نصب‌شده (PWA Standalone)
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;

  const savedRole = localStorage.getItem("cafe_app_role");

  // اگر اپلیکیشن به صورت PWA از صفحه اصلی گوشی باز شده و قبلاً مشتری بوده
  if (isStandalone && savedRole === "customer") {
    return "customer";
  }

  // اگر قبلاً در این مرورگر لینک مشتری باز شده باشد
  if (savedRole === "customer") {
    return "customer";
  }

  return "admin";
}

const APP_ROLE = getAppRole();

if (APP_ROLE === "customer") {
  initCustomerPortal();
  initOfflineSyncManager();
} else {
  document.getElementById("btn-save-najva")?.addEventListener("click", () => {
    saveNajvaConfig({
      scriptId: scriptIdInput?.value.trim() || "",
      apiToken: apiTokenInput?.value.trim() || "",
      enabled: Boolean(enabledInput?.checked),
    });
    alert("تنظیمات نجوا ذخیره شد ✅");
  });

  document.getElementById("today-date").textContent = todayFa();
  updateNavLogo(); // ✅ بارگذاری لوگو در نوبار هنگام شروع برنامه
  initAuth();
  initInvoiceEvents();
  initProductEvents();
  initSettings();
  updateNavLogo(); // ✅ بارگذاری لوگو در نوبار هنگام شروع
  initBackup();
  initGitHubUI();
  initCustomers();
  initServiceModal();
  initAnnouncements();
  updateProformaBadge();
  window.initInvoiceDetailEvents();
  setView("invoice");
  setSource("services");
  enhanceAllSelects();
}
