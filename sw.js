/* Service worker : rend l'appli et ses données consultables en mode avion.
   Changer VERSION à chaque modification du code pour forcer la mise à jour. */
var VERSION = 'v16';
var COQUILLE = 'coquille-' + VERSION;
// v2 : les anciens caches de tuiles pouvaient contenir l'image « Access blocked » d'OpenStreetMap.
var TUILES = 'tuiles-v2';
var TUILES_PRECHARGEES = 'tuiles-prechargees-v2';
var ANCIENS_CACHES = ['tuiles', 'tuiles-prechargees'];

// OpenStreetMap renvoie son image de blocage avec un code 200 et « Cache-Control: no-cache ».
// Une vraie tuile a toujours un max-age : on ne garde que celles-là.
function tuileValide(rep) {
  return rep && rep.ok && !/no-cache|no-store/i.test(rep.headers.get('Cache-Control') || '');
}
var MAX_TUILES = 2500;

var FICHIERS = [
  'index.html',
  'css/style.css',
  'js/app.js',
  'data/voyage.json',
  'data/frontieres.geojson',
  'manifest.webmanifest',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];
var EXTERNES = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(COQUILLE).then(function (c) {
    // cache: 'reload' : ignorer le cache HTTP du navigateur pour enregistrer la vraie nouvelle version
    return c.addAll(FICHIERS.map(function (u) { return new Request(u, { cache: 'reload' }); })).then(function () {
      return Promise.all(EXTERNES.map(function (u) {
        return fetch(u, { mode: 'cors' }).then(function (r) { if (r.ok) return c.put(u, r); });
      }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (cles) {
    return Promise.all(cles.filter(function (k) {
      return (k.indexOf('coquille-') === 0 && k !== COQUILLE) || ANCIENS_CACHES.indexOf(k) >= 0;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function reseauDAbord(req) {
  // Réseau en priorité (pour avoir la dernière version), cache si pas de réseau ou trop lent.
  // Toutes les pages ouvertes (avec ou sans ?date=…) sont rangées sous index.html.
  var cle = req.mode === 'navigate' ? 'index.html' : req;
  return caches.open(COQUILLE).then(function (c) {
    function enCache() { return c.match(cle, { ignoreSearch: true }); }
    // Une requête de navigation ne peut pas être recopiée avec des options : on refait la requête par son adresse
    var reseau = fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }).then(function (r) {
      if (r.ok) c.put(cle, r.clone());
      return r;
    });
    var delai = new Promise(function (ok) { setTimeout(ok, 4000); }).then(enCache);
    return Promise.race([reseau.catch(enCache), delai.then(function (r) { return r || reseau; })])
      .then(function (r) { return r || reseau; });
  });
}

function limiterTuiles() {
  return caches.open(TUILES).then(function (c) {
    return c.keys().then(function (cles) {
      if (cles.length <= MAX_TUILES) return;
      return Promise.all(cles.slice(0, cles.length - MAX_TUILES).map(function (k) { return c.delete(k); }));
    });
  });
}

function tuile(req) {
  // Cache d'abord : les tuiles déjà vues ou pré-chargées restent visibles hors ligne.
  return caches.match(req.url).then(function (r) {
    if (r) return r;
    return fetch(req).then(function (rep) {
      if (tuileValide(rep)) {
        var copie = rep.clone();
        caches.open(TUILES).then(function (c) { return c.put(req.url, copie); }).then(limiterTuiles);
      }
      return rep;
    });
  });
}

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (url.hostname === 'tile.openstreetmap.org') { ev.respondWith(tuile(req)); return; }
  if (url.hostname === 'unpkg.com') {
    ev.respondWith(caches.match(req.url).then(function (r) { return r || fetch(req); }));
    return;
  }
  if (url.origin === self.location.origin) ev.respondWith(reseauDAbord(req));
});
