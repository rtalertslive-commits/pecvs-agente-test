const CACHE_NAME = 'pecvs-agent-testnet-v4.41.0';
// Los iconos llevan sufijo -v2 A PROPOSITO. Chrome decide si tiene que
// regenerar el WebAPK comparando los campos del manifest, y para los iconos
// compara la URL, NO el contenido: dejarlos con el mismo nombre y cambiarles
// los bytes no dispara ninguna actualizacion. Cambiar la ruta si.
//
// En iOS no hay forma: el icono se hornea al momento de "Agregar a inicio" y
// Safari no lo vuelve a leer nunca. Ahi el agente tiene que borrar el acceso
// directo y volver a agregarlo.
const assets = [
    './',
    './index.html',
    './manifest.json',
    './icon-192-v2.png',
    './icon-512-v2.png',
    './apple-touch-icon-v2.png',
    './favicon-32-v2.png',
    // El logo del login. Va precacheado porque es lo primero que se ve al
    // abrir la app, y sin red la etiqueta trae onerror que esconde el hueco:
    // se veria la pantalla sin marca en vez de rota, pero sin marca.
    './promessa-logo.png',
    './promessa-logo-claro.png'
];

// ─── FIREBASE CLOUD MESSAGING ─────────────────────────────────────────────────
// Importamos los SDKs compat de Firebase para Service Worker. La versión 10.x
// modular no funciona en SW (solo en módulos ES); por eso usamos -compat.
//
// OJO — esto va envuelto en try/catch a propósito. importScripts es SÍNCRONO y
// bloqueante: si gstatic falla, la excepción sube y el Service Worker entero no
// instala. Sin SW no hay handler de fetch, y el arranque de la app se queda sin
// respuesta → pantalla negra.
//
// Envuelto, un gstatic caído degrada a "sin notificaciones push" en vez de
// tumbar la app. El resto del SW (cache, navegación) se registra igual, más
// abajo, así que sobrevive a este fallo.
//
// Lo que esto NO cubre: si gstatic no falla sino que se CUELGA, importScripts se
// queda esperando sin timeout y el SW tampoco arranca. Eso solo se elimina
// hospedando los SDK en el mismo origen (quedan en el cache del SW y dejan de
// depender de la red). Pendiente.
let messaging = null;
try {
    importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

    firebase.initializeApp({
        apiKey: "AIzaSyCnhYA0Jq-1_b6nqQVx3BN47WXgg2YEDxs",
        authDomain: "pecvs-testnet.firebaseapp.com",
        projectId: "pecvs-testnet",
        storageBucket: "pecvs-testnet.firebasestorage.app",
        messagingSenderId: "76206458151",
        appId: "1:76206458151:web:464559030e00d060c11502"
    });

    messaging = firebase.messaging();

    // Handler de mensajes en background (app cerrada o no enfocada).
    // Cuando la PWA está abierta, FCM dispara onMessage en el cliente directamente
    // y este handler NO se ejecuta. Solo aplica cuando el SW recibe el push solo.
    messaging.onBackgroundMessage(payload => {
        const title = (payload.notification && payload.notification.title) || 'PECVS$';
        const body  = (payload.notification && payload.notification.body)  || '';
        const data  = payload.data || {};
        return self.registration.showNotification(title, {
            body,
            icon: './icon-192-v2.png',
            badge: './favicon-32-v2.png',
            data,
            // En Android, tag agrupa notificaciones; en iOS lo ignora
            tag: data.tag || 'pecvs-notif',
            // requireInteraction: true mantiene la notif hasta que el user la toque
            requireInteraction: false
        });
    });
} catch (err) {
    // La app funciona sin push. No funciona sin fetch handler.
    console.warn('[sw] FCM no disponible, sigo sin push:', err);
}

// Click en la notificación → abrir/enfocar la app
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || './';
    event.waitUntil((async () => {
        const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
            // Si ya hay una ventana de la app abierta, enfocarla
            if (client.url.includes(self.registration.scope) && 'focus' in client) {
                return client.focus();
            }
        }
        // Si no, abrir nueva
        if (clients.openWindow) return clients.openWindow(url);
    })());
});

// ─── INSTALL / ACTIVATE / FETCH ──────────────────────────────────────────────
self.addEventListener('install', e => {
    self.skipWaiting();
    // .catch: addAll es atómico — si UN asset falla, falla el install completo y el
    // SW nuevo nunca activa. No vale la pena bloquear una actualización porque no
    // se pudo precachear un ícono.
    // Los CDN a propósito NO van acá: precachearlos ataría el install a que los
    // tres CDN respondan, que es justo el problema que estamos resolviendo.
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(assets)).catch(() => {}));
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        // Borra TODOS los caches viejos
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
        await self.clients.claim();
        // Avisa a todas las pestañas/PWAs que hay nueva versión activa
        // para que recarguen el HTML (necesario en iOS PWA donde el HTML
        // queda cacheado en memoria del proceso aun con network-first).
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach(c => c.postMessage({ type: 'sw-activated', version: CACHE_NAME }));
    })());
});

// Timeout de red para la navegación. Sin esto, un fetch colgado (señal mala,
// torre saturada, captive portal) deja al SW sin responder — y el splash nativo
// del PWA se queda en pantalla hasta que el browser aborta solo (30-120s).
// Con 4s servimos cache y la app abre al instante; la próxima carga trae fresh.
const NAV_TIMEOUT_MS = 4000;
const LAST_RESORT_MS = 15000;

// CDNs de assets estáticos que el <head> carga BLOQUEANDO el render:
// Chart.js, Font Awesome y Google Fonts. Antes se dejaban pasar sin cachear
// ("solo cacheamos same-origin"), así que cada arranque de la app dependía de
// que los tres CDNs respondieran. Si uno se colgaba —WiFi con captive portal,
// DNS muerto— el browser no pintaba NADA: pantalla negra hasta que el sistema
// abortara la petición, y por eso "se arreglaba" al cambiar de WiFi a LTE.
// Cacheados, a partir del segundo arranque no vuelven a tocar la red.
const STATIC_CDN = [
    'cdn.jsdelivr.net',        // chart.js
    'cdnjs.cloudflare.com',    // font awesome
    'fonts.googleapis.com',    // css de fuentes
    'fonts.gstatic.com'        // archivos de fuentes
];

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    const sameOrigin  = url.origin === self.location.origin;
    const isStaticCdn = STATIC_CDN.indexOf(url.hostname) !== -1;

    // Todo el resto cross-origin (Firestore, FCM, APIs de hora) se deja pasar
    // intacto: cachear respuestas de API sería un desastre de datos viejos.
    if (!sameOrigin && !isStaticCdn) return;
    if (e.request.method !== 'GET') return;

    // Network-First CON TIMEOUT para la navegación principal (index.html).
    // Si hay internet decente, descarga la última versión de GitHub.
    // Si la red tarda más de NAV_TIMEOUT_MS, sirve el cache sin esperar.
    if (e.request.mode === 'navigate') {
        e.respondWith((async () => {
            // Preparamos el fallback ANTES de la carrera. './index.html' cubre el
            // caso de URLs con query params o hash que no matchean exacto.
            const cached = (await caches.match(e.request))
                || (await caches.match('./index.html'))
                || (await caches.match('./'));

            try {
                const res = await Promise.race([
                    fetch(e.request, { cache: 'no-store' }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('sw-nav-timeout')), NAV_TIMEOUT_MS))
                ]);
                if (res && res.ok) {
                    const clone = res.clone();
                    // Fire-and-forget: un error de cache nunca debe romper la response.
                    caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
                }
                return res;
            } catch (err) {
                // Timeout o fallo de red → cache si lo tenemos.
                if (cached) return cached;
                // Sin cache (primera instalación offline, o cache recién purgado).
                // Timeout generoso: suficiente para una conexión mala legítima, pero
                // acotado — un fetch sin límite acá deja PANTALLA NEGRA indefinida y
                // solo se recupera al cambiar de red (lo que aborta el fetch colgado).
                // Al expirar, respondWith rechaza y el browser muestra su error real.
                return await Promise.race([
                    fetch(e.request),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('sw-last-resort-timeout')), LAST_RESORT_MS))
                ]);
            }
        })());
    } else {
        // Cache-First para assets estáticos, propios y de CDN.
        e.respondWith((async () => {
            const cached = await caches.match(e.request);

            if (cached) {
                // Refresco en segundo plano solo para los CDN: sirve el cache al
                // instante y va actualizando sin bloquear nada. Si la red está
                // muerta, el .catch() lo absorbe y el usuario no se enteró.
                if (isStaticCdn) {
                    fetch(e.request).then(res => {
                        if (!res) return;
                        // Los CDN sin CORS devuelven respuestas 'opaque': status 0 y
                        // ok=false. Son cacheables igual, así que hay que aceptarlas
                        // explícitamente o nunca se guardaría ninguna fuente.
                        if (res.ok || res.type === 'opaque') {
                            const clone = res.clone();
                            caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
                        }
                    }).catch(() => {});
                }
                return cached;
            }

            // Primera vez: a la red, y guardamos para que no vuelva a depender de ella.
            const res = await fetch(e.request);
            if (isStaticCdn && res && (res.ok || res.type === 'opaque')) {
                const clone = res.clone();
                caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
            }
            return res;
        })());
    }
});
