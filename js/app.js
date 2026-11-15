/* Voyage Amérique du Sud : appli hors ligne.
   Toutes les données viennent de data/voyage.json.
   Les réglages du calculateur de dates restent sur le téléphone (localStorage). */
(function () {
  'use strict';

  var CLE_PLAN = 'voyage-plan-v1';
  var JOUR = 86400000;
  var TUILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  var TYPES = {
    vol: { ico: '✈️', nom: 'Vol' },
    bus: { ico: '🚌', nom: 'Bus' },
    train: { ico: '🚆', nom: 'Train' },
    voiture: { ico: '🚗', nom: 'Voiture' },
    activite: { ico: '🎟️', nom: 'Visite / activité' },
    hebergement: { ico: '🛏️', nom: 'Hébergement' },
    autre: { ico: '📌', nom: 'Autre' }
  };
  var STATUTS = { prevu: 'Prévu', option: 'Option', suggestion: 'Suggestion' };

  var donnees = null;
  var plan = chargerPlan();
  var carte = null, coucheActivites = null, marqueurs = {};

  /* ---------- Outils ---------- */
  function $(s) { return document.querySelector(s); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function versDate(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function versIso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  var fmtCourt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  var fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  var fmtJour = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  function dCourt(ms) { return fmtCourt.format(ms); }
  function dLong(ms) { return fmtLong.format(ms); }
  function dJour(ms) { return fmtJour.format(ms); }
  function pluriel(n, mot) { return n + ' ' + mot + (Math.abs(n) > 1 ? 's' : ''); }
  function jours(n) { return pluriel(n, 'jour'); }

  function aujourdhui() {
    // ?date=2027-11-02 dans l'adresse permet de simuler un jour du voyage.
    var m = /[?&]date=(\d{4}-\d{2}-\d{2})/.exec(location.search);
    if (m) return versDate(m[1]);
    var d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.minuterie);
    toast.minuterie = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------- Réglages du calculateur ---------- */
  function chargerPlan() {
    try {
      var p = JSON.parse(localStorage.getItem(CLE_PLAN));
      if (p && typeof p === 'object') return { debut: p.debut || null, jours: p.jours || {}, activites: p.activites || {} };
    } catch (e) { /* stockage indisponible */ }
    return { debut: null, jours: {}, activites: {} };
  }
  function sauverPlan() {
    try { localStorage.setItem(CLE_PLAN, JSON.stringify(plan)); } catch (e) { /* ignoré */ }
  }

  function activiteChoisie(a) {
    if (Object.prototype.hasOwnProperty.call(plan.activites, a.id)) return !!plan.activites[a.id];
    return a.statut === 'prevu';
  }
  function joursBase(e) {
    var v = plan.jours[e.id];
    return typeof v === 'number' ? v : (e.jours || 0);
  }

  /* Calcule les dates de chaque étape, à la suite, depuis la date de départ. */
  function calendrier() {
    var debut = versDate(plan.debut || donnees.voyage.debut);
    var cur = debut;
    var liste = donnees.etapes.map(function (e, i) {
      var acts = (e.activites || []).filter(activiteChoisie);
      var total = joursBase(e) + acts.reduce(function (s, a) { return s + (a.jours || 0); }, 0);
      var r = { etape: e, num: i + 1, arrivee: cur, depart: cur + total * JOUR, total: total, activites: acts };
      cur = r.depart;
      return r;
    });
    return { debut: debut, fin: cur, etapes: liste };
  }

  function paysDe(id) {
    for (var i = 0; i < donnees.pays.length; i++) if (donnees.pays[i].id === id) return donnees.pays[i];
    return { id: id, nom: id, drapeau: '', couleur: '#1f5f66' };
  }

  function bilanPays(cal) {
    return donnees.pays.map(function (p) {
      var et = cal.etapes.filter(function (x) { return x.etape.pays === p.id; });
      var total = et.reduce(function (s, x) { return s + x.total; }, 0);
      var prevus = p.fenetre ? Math.round((versDate(p.fenetre.fin) - versDate(p.fenetre.debut)) / JOUR) + 1 : null;
      return {
        pays: p, total: total, prevus: prevus,
        debut: et.length ? et[0].arrivee : null,
        fin: et.length ? et[et.length - 1].depart : null
      };
    });
  }

  function reservationsTriees() {
    return (donnees.reservations || []).slice().sort(function (a, b) {
      return (a.date + (a.heure || '')).localeCompare(b.date + (b.heure || ''));
    });
  }

  function lienDriveSur(url) {
    return typeof url === 'string' && /^https:\/\/(drive|docs)\.google\.com\//.test(url);
  }

  /* ---------- Accueil ---------- */
  function rendreAccueil() {
    var cal = calendrier();
    var auj = aujourdhui();
    var html = '';

    var evenements = [];
    cal.etapes.forEach(function (x) {
      evenements.push({ quand: x.arrivee, heure: '', titre: 'Arrivée : ' + x.etape.nom, etape: x.etape.id, provisoire: true });
    });
    reservationsTriees().forEach(function (r) {
      evenements.push({ quand: versDate(r.date), heure: r.heure || '', titre: (TYPES[r.type] || TYPES.autre).ico + ' ' + r.titre, resa: r });
    });
    evenements.sort(function (a, b) { return a.quand - b.quand || a.heure.localeCompare(b.heure); });
    var prochain = evenements.filter(function (ev) { return ev.quand > auj; })[0];
    var duJour = evenements.filter(function (ev) { return ev.quand === auj; });

    if (auj < cal.debut) {
      var n = Math.round((cal.debut - auj) / JOUR);
      html += '<div class="bloc"><p class="surtitre">Avant le départ</p>' +
        '<div class="ligne"><span class="grand-chiffre">' + n + '</span><span>' + (n > 1 ? 'jours avant le départ' : 'jour avant le départ') + '<br><span class="doux petit">' + esc(dLong(cal.debut)) + '</span></span></div></div>';
    } else if (auj < cal.fin) {
      var enCours = cal.etapes.filter(function (x) { return auj >= x.arrivee && auj < x.depart; })[0];
      if (enCours) {
        var jourN = Math.round((auj - enCours.arrivee) / JOUR) + 1;
        html += '<div class="bloc"><p class="surtitre">Aujourd\'hui · ' + esc(dJour(auj)) + '</p>' +
          '<div class="ligne"><span class="num">' + enCours.num + '</span><div><h3>' + esc(enCours.etape.nom) + '</h3>' +
          '<p class="doux petit">Jour ' + jourN + ' sur ' + enCours.total + ' · départ le ' + esc(dCourt(enCours.depart)) + '</p></div></div>';
        if (duJour.length) {
          html += '<ul class="activites">' + duJour.map(function (ev) { return '<li>' + (ev.heure ? '<b>' + esc(ev.heure) + '</b> ' : '') + esc(ev.titre) + '</li>'; }).join('') + '</ul>';
        }
        html += '<div class="boutons"><button class="bouton plein" data-fiche="' + esc(enCours.etape.id) + '">Voir la fiche</button></div></div>';
      }
    } else {
      html += '<div class="bloc"><p class="surtitre">Voyage terminé</p><h3>Bon retour !</h3></div>';
    }

    if (prochain) {
      html += '<div class="bloc"><p class="surtitre">Prochain événement</p>' +
        '<h3>' + esc(prochain.titre) + '</h3>' +
        '<p class="doux">' + esc(dLong(prochain.quand)) + (prochain.heure ? ' à ' + esc(prochain.heure) : '') +
        (prochain.provisoire && donnees.voyage.datesProvisoires ? ' <span class="badge option">date provisoire</span>' : '') + '</p>';
      if (prochain.resa) html += detailsResa(prochain.resa);
      if (prochain.etape) html += '<div class="boutons"><button class="bouton" data-fiche="' + esc(prochain.etape) + '">Voir l\'étape</button></div>';
      html += '</div>';
    }

    var total = Math.round((cal.fin - cal.debut) / JOUR);
    html += '<div class="bloc"><p class="surtitre">Le voyage en bref</p>' +
      '<p>' + esc(dCourt(cal.debut)) + ' → ' + esc(dCourt(cal.fin)) + ' · <b>' + jours(total) + '</b> · ' + pluriel(cal.etapes.length, 'étape') + '</p>' +
      bilanPays(cal).map(lignePays).join('') +
      '<div class="boutons"><a class="bouton plein" href="#planifier">Ajuster les dates</a><a class="bouton" href="#carte">Voir la carte</a></div></div>';

    if (donnees.voyage.datesProvisoires) {
      html += '<p class="doux petit">Les dates sont provisoires : elles sont calculées à partir de la durée de chaque étape. Réglez-les dans l\'onglet « Dates ».</p>';
    }
    $('#accueil').innerHTML = html;
  }

  function lignePays(b) {
    var depasse = b.prevus != null && b.total > b.prevus;
    var badge = b.prevus == null ? '' : (depasse
      ? '<span class="badge alerte">+' + jours(b.total - b.prevus) + '</span>'
      : '<span class="badge ok">' + (b.prevus - b.total === 0 ? 'pile' : 'reste ' + jours(b.prevus - b.total)) + '</span>');
    var pct = b.prevus ? Math.min(100, Math.round(b.total / b.prevus * 100)) : 0;
    return '<div style="margin-top:10px"><div class="ligne entre"><span><b>' + esc(b.pays.drapeau) + ' ' + esc(b.pays.nom) + '</b> · ' + jours(b.total) +
      (b.prevus != null ? ' <span class="doux">/ ' + b.prevus + ' prévus</span>' : '') + '</span>' + badge + '</div>' +
      (b.prevus ? '<div class="jauge' + (depasse ? ' depasse' : '') + '"><span style="width:' + pct + '%"></span></div>' : '') + '</div>';
  }

  /* ---------- Étapes ---------- */
  function rendreEtapes() {
    var cal = calendrier();
    var html = '';
    donnees.pays.forEach(function (p) {
      var et = cal.etapes.filter(function (x) { return x.etape.pays === p.id; });
      if (!et.length) return;
      var tot = et.reduce(function (s, x) { return s + x.total; }, 0);
      html += '<div class="pays-titre"><h3>' + esc(p.drapeau + ' ' + p.nom) + '</h3><span class="doux petit">' +
        esc(dCourt(et[0].arrivee)) + ' → ' + esc(dCourt(et[et.length - 1].depart)) + ' · ' + jours(tot) + '</span></div>';
      et.forEach(function (x) {
        var h = x.etape.hebergement;
        html += '<button class="etape-carte" data-fiche="' + esc(x.etape.id) + '">' +
          '<span class="num" style="background:' + esc(p.couleur) + '">' + x.num + '</span>' +
          '<span class="etape-corps"><h4>' + esc(x.etape.nom) + '</h4>' +
          '<p class="petit">' + esc(dJour(x.arrivee)) + ' → ' + esc(dJour(x.depart)) + ' · <b>' + jours(x.total) + '</b></p>' +
          '<p class="petit doux">🛏️ ' + (h && h.nom ? esc(h.nom) : 'Hébergement à trouver') + '</p>' +
          (x.activites.length ? '<p class="petit doux">' + esc(x.activites.map(function (a) { return a.nom; }).join(' · ')) + '</p>' : '') +
          (x.etape.notes ? '<p class="petit doux">📝 ' + esc(x.etape.notes) + '</p>' : '') +
          '</span><span class="chevron" aria-hidden="true">›</span></button>';
      });
    });
    $('#liste-etapes').innerHTML = html;
  }

  /* ---------- Fiche d'une étape ---------- */
  function ouvrirFiche(id) {
    var cal = calendrier();
    var x = cal.etapes.filter(function (y) { return y.etape.id === id; })[0];
    if (!x) return;
    var e = x.etape, p = paysDe(e.pays), h = e.hebergement;
    var resas = reservationsTriees().filter(function (r) { return r.etape === id; });
    var acts = (e.activites || []).slice().sort(function (a, b) { return (activiteChoisie(b) ? 1 : 0) - (activiteChoisie(a) ? 1 : 0); });

    var html = '<div class="fiche-poignee" aria-hidden="true"></div>' +
      '<div class="fiche-tete"><span class="num" style="background:' + esc(p.couleur) + '">' + x.num + '</span>' +
      '<div><p class="surtitre">' + esc(p.drapeau + ' ' + p.nom) + '</p><h2 id="fiche-titre">' + esc(e.nom) + '</h2></div>' +
      '<button class="fermer" data-fermer aria-label="Fermer">×</button></div>' +
      '<div class="infos">' +
      '<div class="info"><b>Dates</b>' + esc(dJour(x.arrivee)) + ' → ' + esc(dJour(x.depart)) + '</div>' +
      '<div class="info"><b>Durée</b>' + jours(x.total) + '</div>' +
      (e.altitude ? '<div class="info"><b>Altitude</b>' + e.altitude.toLocaleString('fr-FR') + ' m</div>' : '') +
      '<div class="info"><b>Hébergement</b>' + (h && h.nom ? esc(h.nom) : 'À trouver') + '</div>' +
      '</div>';
    if (h && (h.adresse || h.notes)) html += '<p class="petit">' + esc(h.adresse || '') + (h.notes ? '<br><span class="doux">' + esc(h.notes) + '</span>' : '') + '</p>';
    if (e.notes) html += '<p>📝 ' + esc(e.notes) + '</p>';

    if (acts.length) {
      html += '<h3>Activités</h3><ul class="activites">' + acts.map(function (a) {
        var ch = activiteChoisie(a);
        return '<li class="' + (ch ? '' : 'act-non') + '"><div class="ligne entre"><span class="nom">' + (ch ? '✓ ' : '') + esc(a.nom) + '</span>' +
          '<span class="badge ' + esc(a.statut) + '">' + esc(STATUTS[a.statut] || a.statut) + '</span></div>' +
          '<p class="desc">' + (a.jours ? '+' + jours(a.jours) + ' · ' : 'Dans la journée · ') + esc(a.description || '') + '</p></li>';
      }).join('') + '</ul>';
    }
    if (resas.length) {
      html += '<h3>Réservations</h3>' + resas.map(carteResa).join('');
    }
    html += '<div class="boutons"><button class="bouton plein" data-carte="' + esc(e.id) + '">Voir sur la carte</button>' +
      '<a class="bouton" href="#planifier" data-fermer>Ajuster la durée</a></div>';

    $('#fiche-contenu').innerHTML = html;
    var d = $('#fiche');
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }
  function fermerFiche() {
    var d = $('#fiche');
    if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); }
  }

  /* ---------- Calculateur de dates ---------- */
  function rendrePlanificateur() {
    var cal = calendrier();
    var total = Math.round((cal.fin - cal.debut) / JOUR);
    var html = '<div class="bloc resume-plan">' +
      '<label class="champ">Date de départ<input type="date" id="plan-debut" value="' + esc(versIso(cal.debut)) + '"></label>' +
      '<p style="margin:10px 0 0">Fin : <b>' + esc(dLong(cal.fin)) + '</b> · ' + jours(total) + '</p>' +
      bilanPays(cal).map(lignePays).join('') + '</div>';

    html += '<p class="doux petit">Les « jours de base » couvrent l\'arrivée, la visite de la ville et le repos. Chaque activité cochée ajoute sa durée. Vos réglages restent sur ce téléphone.</p>';

    cal.etapes.forEach(function (x) {
      var e = x.etape, p = paysDe(e.pays);
      html += '<div class="bloc"><div class="plan-etape-tete"><span class="num" style="background:' + esc(p.couleur) + '">' + x.num + '</span>' +
        '<div><h4>' + esc(e.nom) + '</h4><p class="petit doux" style="margin:0">' + esc(dJour(x.arrivee)) + ' → ' + esc(dJour(x.depart)) + ' · <b>' + jours(x.total) + '</b></p></div></div>' +
        '<div class="base"><span class="petit">Jours de base</span><span class="compteur">' +
        '<button type="button" data-moins="' + esc(e.id) + '" aria-label="Un jour de moins à ' + esc(e.nom) + '">−</button>' +
        '<output aria-live="polite">' + joursBase(e) + '</output>' +
        '<button type="button" data-plus="' + esc(e.id) + '" aria-label="Un jour de plus à ' + esc(e.nom) + '">+</button></span></div>';
      (e.activites || []).forEach(function (a) {
        html += '<label class="case"><input type="checkbox" data-act="' + esc(a.id) + '"' + (activiteChoisie(a) ? ' checked' : '') + '>' +
          '<span>' + esc(a.nom) + ' <span class="badge ' + esc(a.statut) + '">' + esc(STATUTS[a.statut] || a.statut) + '</span></span>' +
          '<span class="duree">' + (a.jours ? '+' + a.jours + ' j' : 'inclus') + '</span></label>';
      });
      html += '</div>';
    });

    html += '<div class="boutons"><button type="button" class="bouton plein" id="plan-copier">Copier le résumé</button>' +
      '<button type="button" class="bouton" id="plan-reset">Revenir aux valeurs de départ</button></div>' +
      '<p class="doux petit">« Copier le résumé » prépare un texte à me renvoyer pour figer ces dates dans le fichier du voyage.</p>';

    var zone = $('#planificateur');
    var y = window.scrollY;
    zone.innerHTML = html;
    window.scrollTo(0, y);
    majSousTitre();
  }

  function majSousTitre() {
    var cal = calendrier();
    $('#sous-titre').textContent = dCourt(cal.debut) + ' → ' + dCourt(cal.fin) + ' · ' +
      donnees.pays.map(function (p) { return p.drapeau; }).join(' ') + (donnees.voyage.datesProvisoires ? ' · dates provisoires' : '');
  }

  function resumeTexte() {
    var cal = calendrier();
    var lignes = ['Plan du voyage : départ ' + versIso(cal.debut) + ', fin ' + versIso(cal.fin) + ' (' + jours(Math.round((cal.fin - cal.debut) / JOUR)) + ')'];
    cal.etapes.forEach(function (x) {
      lignes.push(x.num + '. ' + x.etape.nom + ' : ' + versIso(x.arrivee) + ' → ' + versIso(x.depart) + ' (' + jours(x.total) + ', base ' + joursBase(x.etape) + ')' +
        (x.activites.length ? ' — ' + x.activites.map(function (a) { return a.nom; }).join(', ') : ''));
    });
    return lignes.join('\n');
  }

  function copier(texte) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texte).then(function () { toast('Résumé copié'); }, function () { secours(); });
    } else secours();
    function secours() {
      var t = document.createElement('textarea');
      t.value = texte; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); toast('Résumé copié'); } catch (e) { toast('Copie impossible'); }
      t.remove();
    }
  }

  /* ---------- Réservations ---------- */
  var filtreResa = 'tout';
  function detailsResa(r) {
    var lieu = r.lieu ? esc(r.lieu) + (r.arrivee ? ' → ' + esc(r.arrivee) : '') : '';
    return (lieu ? '<p class="petit" style="margin:4px 0 0">📍 ' + lieu + '</p>' : '') +
      (r.compagnie ? '<p class="petit doux" style="margin:2px 0 0">' + esc(r.compagnie) + '</p>' : '') +
      (r.numero ? '<p class="petit" style="margin:6px 0 0">N° <span class="code">' + esc(r.numero) + '</span> <button class="puce" data-copier="' + esc(r.numero) + '">Copier</button></p>' : '') +
      (r.notes ? '<p class="petit doux" style="margin:6px 0 0">' + esc(r.notes) + '</p>' : '') +
      (lienDriveSur(r.lienDrive) ? '<div class="boutons"><a class="bouton" href="' + esc(r.lienDrive) + '" target="_blank" rel="noopener noreferrer">Ouvrir le PDF (Drive)</a></div>' : '');
  }
  function carteResa(r) {
    var t = TYPES[r.type] || TYPES.autre;
    return '<div class="bloc"><div class="ligne" style="align-items:flex-start"><span class="resa-type" aria-hidden="true">' + t.ico + '</span>' +
      '<div style="flex:1;min-width:0"><p class="surtitre">' + esc(t.nom) + '</p><h3>' + esc(r.titre) + '</h3>' +
      '<p class="petit">' + esc(dLong(versDate(r.date))) + (r.heure ? ' à <b>' + esc(r.heure) + '</b>' : '') + '</p>' +
      detailsResa(r) + '</div></div></div>';
  }
  function rendreReservations() {
    var toutes = reservationsTriees();
    if (!toutes.length) {
      $('#reservations').innerHTML = '<div class="bloc vide"><p style="font-size:2rem;margin:0">🗂️</p><h3>Aucune réservation pour l\'instant</h3>' +
        '<p class="doux">Dictez-moi vos réservations (vols, bus, trains, voiture, visites) : date, heure, lieu, numéro et lien Drive du PDF. Elles apparaîtront ici et sur l\'accueil.</p></div>';
      return;
    }
    var types = Object.keys(TYPES).filter(function (k) { return toutes.some(function (r) { return (r.type || 'autre') === k; }); });
    var html = '<div class="filtres" role="group" aria-label="Filtrer par type">' +
      '<button class="puce" data-filtre="tout" aria-pressed="' + (filtreResa === 'tout') + '">Tout</button>' +
      types.map(function (k) { return '<button class="puce" data-filtre="' + k + '" aria-pressed="' + (filtreResa === k) + '">' + TYPES[k].ico + ' ' + esc(TYPES[k].nom) + '</button>'; }).join('') + '</div>';
    var auj = aujourdhui();
    var liste = toutes.filter(function (r) { return filtreResa === 'tout' || (r.type || 'autre') === filtreResa; });
    var avenir = liste.filter(function (r) { return versDate(r.date) >= auj; });
    var passees = liste.filter(function (r) { return versDate(r.date) < auj; });
    html += avenir.map(carteResa).join('');
    if (passees.length) html += '<h3 class="doux">Passées</h3>' + passees.map(carteResa).join('');
    $('#reservations').innerHTML = html;
  }

  /* ---------- Carte ---------- */
  function initCarte() {
    if (carte || typeof L === 'undefined') {
      if (typeof L === 'undefined') $('#carte-etat').textContent = 'La carte n\'a pas pu se charger. Ouvrez l\'appli une fois avec du réseau.';
      return;
    }
    carte = L.map('carte', { zoomControl: true, attributionControl: true });
    L.tileLayer(TUILES, {
      maxZoom: 18, crossOrigin: '',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(carte);

    var cal = calendrier();
    var points = cal.etapes.map(function (x) { return [x.etape.lat, x.etape.lng]; });
    L.polyline(points, { color: '#b9532f', weight: 3, opacity: .85, dashArray: '6 6' }).addTo(carte);

    coucheActivites = L.layerGroup();
    cal.etapes.forEach(function (x) {
      var e = x.etape, p = paysDe(e.pays);
      var m = L.marker([e.lat, e.lng], {
        title: x.num + '. ' + e.nom,
        icon: L.divIcon({ className: '', html: '<span class="marqueur" style="background:' + esc(p.couleur) + '">' + x.num + '</span>', iconSize: [30, 30], iconAnchor: [15, 15] })
      }).addTo(carte);
      m.on('click', function () { ouvrirFiche(e.id); });
      marqueurs[e.id] = m;

      (e.activites || []).forEach(function (a) {
        if (typeof a.lat !== 'number') return;
        var coul = activiteChoisie(a) ? '#2f7a45' : (a.statut === 'suggestion' ? '#6d4ea0' : '#8a6a14');
        L.marker([a.lat, a.lng], {
          title: a.nom,
          icon: L.divIcon({ className: '', html: '<span class="point-activite" style="background:' + coul + '"></span>', iconSize: [12, 12], iconAnchor: [6, 6] })
        }).bindPopup('<b>' + esc(a.nom) + '</b><br><span>' + esc(STATUTS[a.statut] || '') + ' · ' + esc(e.nom) + '</span><br>' +
          '<button class="bouton" data-fiche="' + esc(e.id) + '">Voir l\'étape</button>').addTo(coucheActivites);
      });
    });
    coucheActivites.addTo(carte);
    vueEnsemble();
  }
  function vueEnsemble() {
    if (!carte) return;
    var pts = donnees.etapes.map(function (e) { return [e.lat, e.lng]; });
    carte.fitBounds(pts, { padding: [40, 40] });
  }

  /* Pré-chargement léger des fonds de carte autour des étapes et activités.
     Volume volontairement limité, conformément aux règles d'OpenStreetMap. */
  function tuile(lat, lng, z) {
    var n = Math.pow(2, z);
    var x = Math.floor((lng + 180) / 360 * n);
    var r = lat * Math.PI / 180;
    var y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    return [x, y];
  }
  function listeTuiles() {
    var vues = {};
    function ajouter(lat, lng, z, rayon) {
      var t = tuile(lat, lng, z);
      for (var dx = -rayon; dx <= rayon; dx++) for (var dy = -rayon; dy <= rayon; dy++) {
        vues[z + '/' + (t[0] + dx) + '/' + (t[1] + dy)] = 1;
      }
    }
    donnees.etapes.forEach(function (e) {
      for (var z = 5; z <= 7; z++) ajouter(e.lat, e.lng, z, 1);
      for (z = 8; z <= 13; z++) ajouter(e.lat, e.lng, z, 1);
      ajouter(e.lat, e.lng, 14, 2);
      (e.activites || []).forEach(function (a) {
        if (typeof a.lat === 'number') { ajouter(a.lat, a.lng, 11, 1); ajouter(a.lat, a.lng, 13, 1); }
      });
    });
    return Object.keys(vues).map(function (k) {
      var p = k.split('/');
      return TUILES.replace('{z}', p[0]).replace('{x}', p[1]).replace('{y}', p[2]);
    });
  }
  function prechargerCarte() {
    var etat = $('#carte-etat');
    if (!navigator.onLine) { etat.textContent = 'Pas de réseau : réessayez en wifi.'; return; }
    if (!('caches' in window)) { etat.textContent = 'Ce navigateur ne permet pas la carte hors ligne.'; return; }
    var urls = listeTuiles();
    if (!confirm('Télécharger environ ' + urls.length + ' morceaux de carte (≈ ' + Math.round(urls.length * 0.02) + ' Mo) autour des étapes ? À faire en wifi.')) return;
    var fait = 0, erreurs = 0, i = 0, actifs = 0;
    caches.open('tuiles-prechargees').then(function (cache) {
      function suivant() {
        if (i >= urls.length && actifs === 0) {
          etat.textContent = 'Carte hors ligne prête : ' + fait + ' morceaux enregistrés' + (erreurs ? ', ' + erreurs + ' échecs' : '') + '.';
          setTimeout(function () { etat.textContent = ''; }, 6000);
          return;
        }
        while (actifs < 2 && i < urls.length) {
          var url = urls[i++]; actifs++;
          (function (u) {
            cache.match(u).then(function (deja) {
              if (deja) return;
              return fetch(u, { mode: 'cors' }).then(function (rep) { if (rep.ok) return cache.put(u, rep); throw new Error(); });
            }).then(function () { fait++; }, function () { erreurs++; }).then(function () {
              actifs--;
              etat.textContent = 'Téléchargement de la carte… ' + Math.round((fait + erreurs) / urls.length * 100) + ' %';
              suivant();
            });
          })(url);
        }
      }
      suivant();
    });
  }

  /* ---------- Navigation ---------- */
  var VUES = ['accueil', 'carte', 'etapes', 'planifier', 'resas'];
  function afficherVue() {
    var v = location.hash.replace('#', '') || 'accueil';
    if (VUES.indexOf(v) < 0) v = 'accueil';
    majSousTitre();
    VUES.forEach(function (n) { $('#vue-' + n).hidden = n !== v; });
    document.querySelectorAll('.onglets a').forEach(function (a) {
      if (a.getAttribute('data-vue') === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (v === 'accueil') rendreAccueil();
    if (v === 'etapes') rendreEtapes();
    if (v === 'planifier') rendrePlanificateur();
    if (v === 'resas') rendreReservations();
    if (v === 'carte') { initCarte(); if (carte) setTimeout(function () { carte.invalidateSize(); }, 50); }
    if (v !== 'carte') window.scrollTo(0, 0);
  }

  function evenements() {
    document.addEventListener('click', function (ev) {
      var c = ev.target.closest('[data-fiche],[data-fermer],[data-carte],[data-moins],[data-plus],[data-copier],[data-filtre],#plan-copier,#plan-reset,#bouton-activites,#bouton-ensemble,#bouton-hors-ligne');
      if (!c) return;
      if (c.hasAttribute('data-fiche')) { carte && carte.closePopup(); ouvrirFiche(c.getAttribute('data-fiche')); }
      else if (c.hasAttribute('data-fermer')) fermerFiche();
      else if (c.hasAttribute('data-carte')) {
        var id = c.getAttribute('data-carte');
        fermerFiche(); location.hash = '#carte';
        setTimeout(function () {
          var e = donnees.etapes.filter(function (x) { return x.id === id; })[0];
          if (carte && e) carte.setView([e.lat, e.lng], 11);
        }, 120);
      }
      else if (c.hasAttribute('data-moins') || c.hasAttribute('data-plus')) {
        var eid = c.getAttribute('data-moins') || c.getAttribute('data-plus');
        var et = donnees.etapes.filter(function (x) { return x.id === eid; })[0];
        var v = joursBase(et) + (c.hasAttribute('data-plus') ? 1 : -1);
        plan.jours[eid] = Math.max(0, Math.min(60, v));
        sauverPlan(); rendrePlanificateur();
        var b = document.querySelector('[data-' + (c.hasAttribute('data-plus') ? 'plus' : 'moins') + '="' + eid + '"]');
        if (b) b.focus();
      }
      else if (c.hasAttribute('data-copier')) copier(c.getAttribute('data-copier'));
      else if (c.hasAttribute('data-filtre')) { filtreResa = c.getAttribute('data-filtre'); rendreReservations(); }
      else if (c.id === 'plan-copier') copier(resumeTexte());
      else if (c.id === 'plan-reset') {
        if (confirm('Revenir aux durées et activités de départ ?')) { plan = { debut: null, jours: {}, activites: {} }; sauverPlan(); rendrePlanificateur(); toast('Valeurs de départ rétablies'); }
      }
      else if (c.id === 'bouton-activites') {
        var on = c.getAttribute('aria-pressed') !== 'true';
        c.setAttribute('aria-pressed', String(on));
        if (carte) { if (on) coucheActivites.addTo(carte); else carte.removeLayer(coucheActivites); }
      }
      else if (c.id === 'bouton-ensemble') vueEnsemble();
      else if (c.id === 'bouton-hors-ligne') prechargerCarte();
    });

    document.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.id === 'plan-debut' && t.value) { plan.debut = t.value; sauverPlan(); rendrePlanificateur(); }
      else if (t.hasAttribute && t.hasAttribute('data-act')) {
        plan.activites[t.getAttribute('data-act')] = t.checked;
        sauverPlan(); rendrePlanificateur();
        var cb = document.querySelector('[data-act="' + t.getAttribute('data-act') + '"]');
        if (cb) cb.focus();
      }
    });

    var d = $('#fiche');
    d.addEventListener('click', function (ev) { if (ev.target === d) fermerFiche(); });

    window.addEventListener('hashchange', afficherVue);
    function reseau() { $('#hors-ligne').hidden = navigator.onLine; }
    window.addEventListener('online', reseau);
    window.addEventListener('offline', reseau);
    reseau();
  }

  /* ---------- Démarrage ---------- */
  function demarrer() {
    evenements();
    fetch('data/voyage.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        donnees = d;
        $('#titre-voyage').textContent = d.voyage.titre;
        afficherVue();
      })
      .catch(function () {
        $('#accueil').innerHTML = '<div class="bloc"><h3>Données introuvables</h3><p>Ouvrez l\'appli une première fois avec du réseau pour l\'enregistrer sur le téléphone.</p></div>';
      });

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* ignoré */ });
    }
  }

  demarrer();
})();
