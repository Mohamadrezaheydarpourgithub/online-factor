// sw.js - Service Worker برای کارکرد ۱۰۰٪ آفلاین و قابلیت نصب PWA با سرعت حداکثری
const CACHE_NAME = "cafe-pwa-v9";

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./manifest-customer.json",
  "./assets/css/tailwind.css",
  "./assets/vendor/vazirmatn/Vazirmatn-font-face.css",
  "./assets/vendor/vazirmatn/fonts/webfonts/Vazirmatn-Regular.woff2",
  "./assets/vendor/vazirmatn/fonts/webfonts/Vazirmatn-Bold.woff2",
  "./assets/vendor/vazirmatn/fonts/webfonts/Vazirmatn-Medium.woff2",
  "./assets/vendor/vazirmatn/fonts/webfonts/Vazirmatn-SemiBold.woff2",
  "./assets/vendor/jquery.min.js",
  "./assets/vendor/persian-date/persian-date.min.js",
  "./assets/vendor/persian-datepicker/persian-datepicker.min.js",
  "./assets/vendor/persian-datepicker/persian-datepicker.min.css",
  "./assets/vendor/chart.umd.min.js",
  "./assets/vendor/quill/quill.js",
  "./assets/vendor/quill/quill.snow.css",
  "./assets/vendor/qrcode.min.js",
  "./assets/vendor/xlsx.full.min.js",
  "./src/js/app.js",
  "./src/js/store.js",
  "./src/js/invoice.js",
  "./src/js/invoices-list.js",
  "./src/js/proformas-list.js",
  "./src/js/products.js",
  "./src/js/reports.js",
  "./src/js/customers.js",
  "./src/js/customer-portal.js",
  "./src/js/nice-select.js",
  "./src/js/progress-indicator.js",
  "./src/js/auth.js",
  "./src/js/backup.js",
  "./src/js/github.js",
  "./src/js/announcements.js",
  "./src/js/price-helper.js",
  "./src/data/rates.js",
];

// دریافت پیام از کلاینت جهت فعال‌سازی آنی نسخه جدید بدون معطلی
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn("برخی فایل‌ها در کش اولیه قرار نگرفتند:", err);
      });
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log("حذف کش نسخه قبلی:", key);
            return caches.delete(key);
          }),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (
    event.request.url.includes("api.github.com") ||
    event.request.url.includes("goftino.com")
  ) {
    return;
  }

  // ۱. درخواست‌های صفحات و ناوبری HTML: استراتژی Network-First با فال‌بک به کش
  // این استراتژی باعث می‌شود همیشه آخرین نسخه صفحه وب از سرور بارگذاری شود و در صورت آفلاین بودن از کش استفاده گردد
  const isHtml =
    event.request.mode === "navigate" ||
    event.request.headers.get("accept")?.includes("text/html");

  if (isHtml) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            return cached || caches.match("./index.html");
          });
        }),
    );
    return;
  }

  // ۲. داده‌های json استخراجی: استراتژی شبکه با فال‌بک به کش
  const isDataJson =
    event.request.url.includes("/data/") && event.request.url.endsWith(".json");

  if (isDataJson) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            event.request.method === "GET"
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // ۳. فایل‌های استاتیک محلی (جاوااسکریپت، استایل، فونت، مدیا): استراتژی Stale-While-Revalidate
  // کش بلافاصله تحویل داده می‌شود (لود فوق سریع) و در پس‌زمینه نسخه به‌روز از شبکه دریافت و کش را نوسازی می‌کند
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            event.request.method === "GET"
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    }),
  );
});
