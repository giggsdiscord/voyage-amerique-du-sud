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

  /* Moyens de transport entre les étapes (champ "trajet" de chaque étape). */
  var MODES = {
    vol: { ico: '✈️', nom: 'Avion', couleur: '#2b6cb0', tirets: '2 8' },
    bus: { ico: '🚌', nom: 'Bus', couleur: '#b9532f', tirets: '8 6' },
    train: { ico: '🚆', nom: 'Train', couleur: '#5b3f8c', tirets: null },
    voiture: { ico: '🚗', nom: 'Voiture', couleur: '#2f7a45', tirets: null },
    colectivo: { ico: '🚐', nom: 'Colectivo', couleur: '#b9532f', tirets: '8 6' },
    tour: { ico: '🚐', nom: 'Excursion organisée', couleur: '#b9532f', tirets: '8 6' },
    taxi: { ico: '🚕', nom: 'Taxi', couleur: '#b9532f', tirets: '8 6' },
    bateau: { ico: '⛴️', nom: 'Bateau', couleur: '#1f8fa6', tirets: '2 8' },
    marche: { ico: '🥾', nom: 'À pied', couleur: '#6b7280', tirets: '1 6' },
    velo: { ico: '🚲', nom: 'Vélo', couleur: '#6b7280', tirets: '1 6' }
  };
  var STATUTS_TRAJET = { propose: 'Proposé', choisi: 'Choisi', reserve: 'Réservé' };
  var CLASSE_TRAJET = { propose: 'suggestion', choisi: 'option', reserve: 'prevu' };

  function icones(t) {
    return (t.modes || []).map(function (m) { return (MODES[m] || { ico: '📍' }).ico; }).join(' ');
  }
  function nomsModes(t) {
    return (t.modes || []).map(function (m) { return (MODES[m] || { nom: m }).nom; }).join(' + ');
  }
  function badgeTrajet(t) {
    var s = t.statut || 'propose';
    return '<span class="badge ' + (CLASSE_TRAJET[s] || 'suggestion') + '">' + esc(STATUTS_TRAJET[s] || s) + '</span>';
  }

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
      if (p && typeof p === 'object') return { debut: p.debut || null, jours: p.jours || {}, activites: p.activites || {}, marges: p.marges || {} };
    } catch (e) { /* stockage indisponible */ }
    return { debut: null, jours: {}, activites: {}, marges: {} };
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

  /* Jours de marge (météo, repos, imprévus) ajoutés à la fin de chaque section (champ "marge" du pays). */
  function margePays(pid) {
    var v = plan.marges[pid];
    if (typeof v === 'number') return v;
    var p = donnees.pays.filter(function (x) { return x.id === pid; })[0];
    return (p && p.marge) || 0;
  }

  /* Calcule les dates de chaque étape, à la suite, depuis la date de départ.
     La dernière étape d'une section porte la marge de cette section (champs marge et finMarge). */
  function calendrier() {
    var debut = versDate(plan.debut || donnees.voyage.debut);
    var cur = debut;
    var liste = donnees.etapes.map(function (e, i) {
      var acts = (e.activites || []).filter(activiteChoisie);
      var total = joursBase(e) + acts.reduce(function (s, a) { return s + (a.jours || 0); }, 0);
      var r = { etape: e, num: i + 1, arrivee: cur, depart: cur + total * JOUR, total: total, activites: acts };
      cur = r.depart;
      var suiv = donnees.etapes[i + 1];
      if (!suiv || suiv.pays !== e.pays) {
        r.marge = margePays(e.pays);
        r.finMarge = cur + r.marge * JOUR;
        cur = r.finMarge;
      }
      return r;
    });
    return { debut: debut, fin: cur, etapes: liste };
  }

  /* Petits drapeaux dessinés : Windows n'affiche pas les emojis de drapeaux (il montre « PE », « BO »…). */
  var DRAPEAUX = {
    perou: '<rect width="3" height="2" fill="#d91023"/><rect x="1" width="1" height="2" fill="#fff"/>',
    bolivie: '<rect width="3" height="2" fill="#007934"/><rect width="3" height="1.333" fill="#f9e300"/><rect width="3" height=".667" fill="#d52b1e"/>',
    chili: '<rect width="3" height="2" fill="#d52b1e"/><rect width="3" height="1" fill="#fff"/><rect width="1" height="1" fill="#0039a6"/><circle cx=".5" cy=".5" r=".2" fill="#fff"/>',
    argentine: '<rect width="3" height="2" fill="#74acdf"/><rect y=".667" width="3" height=".667" fill="#fff"/><circle cx="1.5" cy="1" r=".2" fill="#f6b40e"/>'
  };
  function drapeau(p) {
    var d = DRAPEAUX[p.id];
    if (d) return '<svg class="drapeau" viewBox="0 0 3 2" aria-hidden="true">' + d + '</svg>';
    return '<span aria-hidden="true">' + esc(p.drapeau || '') + '</span>';
  }

  // Texte des notes avec les emojis de drapeaux remplacés par les drapeaux dessinés
  function notes(s) {
    return esc(s).replace(/🇨🇱/g, drapeau({ id: 'chili' })).replace(/🇦🇷/g, drapeau({ id: 'argentine' }))
      .replace(/🇵🇪/g, drapeau({ id: 'perou' })).replace(/🇧🇴/g, drapeau({ id: 'bolivie' }));
  }

  function paysDe(id) {
    for (var i = 0; i < donnees.pays.length; i++) if (donnees.pays[i].id === id) return donnees.pays[i];
    return { id: id, nom: id, drapeau: '', couleur: '#1f5f66' };
  }

  function bilanPays(cal) {
    return donnees.pays.map(function (p) {
      var et = cal.etapes.filter(function (x) { return x.etape.pays === p.id; });
      var marge = et.reduce(function (s, x) { return s + (x.marge || 0); }, 0);
      var total = et.reduce(function (s, x) { return s + x.total; }, 0) + marge;
      var prevus = p.fenetre ? Math.round((versDate(p.fenetre.fin) - versDate(p.fenetre.debut)) / JOUR) + 1 : null;
      var der = et[et.length - 1];
      return {
        pays: p, total: total, marge: marge, prevus: prevus,
        debut: et.length ? et[0].arrivee : null,
        fin: der ? (der.finMarge || der.depart) : null
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
    if (donnees.vols && donnees.vols.aller) evenements.push({ quand: dateVol('aller', cal), heure: '', titre: '✈️ ' + donnees.vols.aller.titre, provisoire: true });
    if (donnees.vols && donnees.vols.retour) evenements.push({ quand: dateVol('retour', cal), heure: '', titre: '✈️ ' + donnees.vols.retour.titre, provisoire: true });
    cal.etapes.forEach(function (x) {
      evenements.push({ quand: x.arrivee, heure: '', titre: 'Arrivée : ' + x.etape.nom, etape: x.etape.id, provisoire: true });
    });
    reservationsTriees().forEach(function (r) {
      evenements.push({ quand: versDate(r.date), heure: r.heure || '', titre: (TYPES[r.type] || TYPES.autre).ico + ' ' + r.titre, resa: r });
    });
    evenements.sort(function (a, b) { return a.quand - b.quand || a.heure.localeCompare(b.heure); });
    var prochain = evenements.filter(function (ev) { return ev.quand > auj; })[0];
    var duJour = evenements.filter(function (ev) { return ev.quand === auj; });

    var dureeTotale = Math.round((cal.fin - cal.debut) / JOUR);
    var depart = dateVol('aller', cal) || cal.debut;
    if (auj < cal.debut) {
      var n = Math.max(0, Math.round((depart - auj) / JOUR));
      html += '<div class="bloc bloc-heros"><p class="surtitre">Avant le départ</p>' +
        '<div class="ligne"><span class="grand-chiffre">' + n + '</span><span>' + (n > 1 ? 'jours avant le départ' : (n === 1 ? 'jour avant le départ' : 'C\'est le jour du départ !')) + '<br><span class="doux petit">✈️ ' + esc(dLong(depart)) + '</span></span></div>' +
        '<p class="doux petit" style="margin:10px 0 0">' + jours(dureeTotale) + ' de voyage · ' + pluriel(cal.etapes.length, 'étape') + ' · ' + donnees.pays.map(drapeau).join(' ') + '</p></div>';
    } else if (auj < cal.fin) {
      var jourVoyage = Math.round((auj - cal.debut) / JOUR) + 1;
      html += '<div class="bloc bloc-heros"><p class="surtitre">En voyage</p><div class="ligne"><span class="grand-chiffre">J' + jourVoyage + '</span>' +
        '<span>sur ' + jours(dureeTotale) + '<br><span class="doux petit">Retour le ' + esc(dLong(cal.fin)) + '</span></span></div>' +
        '<div class="progression"><span style="width:' + Math.round(jourVoyage / dureeTotale * 100) + '%"></span></div></div>';
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
      } else {
        var enMarge = cal.etapes.filter(function (x) { return x.marge && auj >= x.depart && auj < x.finMarge; })[0];
        if (enMarge) {
          html += '<div class="bloc"><p class="surtitre">Aujourd\'hui · ' + esc(dJour(auj)) + '</p>' +
            '<h3>⏳ Jour de marge</h3><p class="doux petit">Après ' + esc(enMarge.etape.nom) + ' · ' + esc(paysDe(enMarge.etape.pays).nom) +
            ' · jusqu\'au ' + esc(dCourt(enMarge.finMarge)) + '</p></div>';
        }
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

    // Raccourcis
    var aDecider = nbPropositionsADecider();
    html += '<div class="raccourcis">' +
      '<a class="raccourci" href="#propositions"><span class="ico" aria-hidden="true">💡</span><b>Propositions</b><span class="doux">' +
        (aDecider ? pluriel(aDecider, 'idée') + ' à décider' : 'Tout est décidé') + '</span></a>' +
      '<a class="raccourci" href="#conseils"><span class="ico" aria-hidden="true">🧭</span><b>Conseils</b><span class="doux">' + pluriel((donnees.conseils || []).length, 'fiche') + '</span></a>' +
      (function () {
        var l = listeAFaire(), n = l.filter(function (a) { return a.coche; }).length;
        return '<a class="raccourci" href="#afaire"><span class="ico" aria-hidden="true">✅</span><b>À faire</b><span class="doux">' + n + ' sur ' + l.length + ' faits</span></a>';
      })() +
      '<a class="raccourci" href="#resas"><span class="ico" aria-hidden="true">🎫</span><b>Réservations</b><span class="doux">' +
        ((donnees.reservations || []).length ? pluriel(donnees.reservations.length, 'réservation') : 'Aucune pour l\'instant') + '</span></a>' +
      '</div>';

    var total = dureeTotale;
    html += '<div class="bloc"><p class="surtitre">Le voyage en bref</p>' +
      '<p>' + esc(dCourt(cal.debut)) + ' → ' + esc(dCourt(cal.fin)) + ' · <b>' + jours(total) + '</b> · ' + pluriel(cal.etapes.length, 'étape') + '</p>' +
      bilanPays(cal).map(lignePays).join('') +
      (function () { var b = calculBudget(); return '<p style="margin:14px 0 0">💶 Budget estimé : <b>' + euros(b.total[0]) + ' à ' + euros(b.total[1]) + '</b> par personne</p>'; })() +
      '<div class="boutons"><a class="bouton plein" href="#planifier">Ajuster les dates</a><a class="bouton" href="#budget">Voir le budget</a></div></div>';

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
    return '<div style="margin-top:10px"><div class="ligne entre"><span><b>' + drapeau(b.pays) + ' ' + esc(b.pays.nom) + '</b> · ' + jours(b.total) +
      (b.prevus != null ? ' <span class="doux">/ ' + b.prevus + ' prévus</span>' : '') + '</span>' + badge + '</div>' +
      (b.prevus ? '<div class="jauge' + (depasse ? ' depasse' : '') + '"><span style="width:' + pct + '%"></span></div>' : '') + '</div>';
  }

  /* ---------- Étapes ---------- */
  function rendreEtapes() {
    var cal = calendrier();
    // Puces pour sauter directement à une section
    var html = '<div class="barre-sections"><div class="defile" role="group" aria-label="Aller à une section">' +
      donnees.pays.map(function (p) {
        return '<button type="button" class="puce" data-section="' + esc(p.id) + '">' + drapeau(p) + ' ' + esc(p.nom) + '</button>';
      }).join('') + '</div></div>';
    html += carteVol('aller', cal);
    donnees.pays.forEach(function (p) {
      var et = cal.etapes.filter(function (x) { return x.etape.pays === p.id; });
      if (!et.length) return;
      var b = bilanPays(cal).filter(function (y) { return y.pays.id === p.id; })[0];
      html += '<div class="pays-titre" id="section-' + esc(p.id) + '" data-section-titre="' + esc(p.id) + '"><h3>' + drapeau(p) + ' ' + esc(p.nom) + '</h3><span class="doux petit">' +
        esc(dCourt(b.debut)) + ' → ' + esc(dCourt(b.fin)) + ' · ' + jours(b.total) + '</span></div>';
      et.forEach(function (x) {
        var h = x.etape.hebergement, t = x.etape.trajet;
        // Texte cherchable : nom, section, notes, hébergement, trajet, toutes les activités (même non cochées)
        var cherchable = [x.etape.nom, p.nom, x.etape.notes, h && h.nom, t && t.resume, t && nomsModes(t)]
          .concat((x.etape.activites || []).map(function (a) { return a.nom + ' ' + (a.description || ''); })).join(' ');
        html += '<div class="groupe-etape" data-pays="' + esc(p.id) + '" data-recherche="' + esc(normaliser(cherchable)) + '">';
        if (t) {
          html += '<button class="trajet" data-fiche="' + esc(x.etape.id) + '" aria-label="Trajet vers ' + esc(x.etape.nom) + '">' +
            '<span class="trajet-ico" aria-hidden="true">' + icones(t) + '</span>' +
            '<span class="trajet-texte">' + esc(t.resume || nomsModes(t)) + '</span>' + badgeTrajet(t) + '</button>';
        }
        html += '<button class="etape-carte" data-fiche="' + esc(x.etape.id) + '">' +
          '<span class="num" style="background:' + esc(p.couleur) + '">' + x.num + '</span>' +
          '<span class="etape-corps"><h4>' + esc(x.etape.nom) + '</h4>' +
          '<p class="petit">' + esc(dJour(x.arrivee)) + ' → ' + esc(dJour(x.depart)) + ' · <b>' + jours(x.total) + '</b></p>' +
          '<p class="petit doux">🛏️ ' + (h && h.nom ? esc(h.nom) : 'Hébergement à trouver') + '</p>' +
          (x.activites.length ? '<p class="petit doux">' + esc(x.activites.map(function (a) { return a.nom; }).join(' · ')) + '</p>' : '') +
          (x.etape.notes ? '<p class="petit doux">📝 ' + notes(x.etape.notes) + '</p>' : '') +
          '</span><span class="chevron" aria-hidden="true">›</span></button>';
        if (x.marge) {
          html += '<div class="marge-ligne">⏳ <b>' + jours(x.marge) + ' de marge</b> · ' + esc(dJour(x.depart)) + ' → ' + esc(dJour(x.finMarge)) +
            '<br><span class="doux">Météo, repos, imprévus</span></div>';
        }
        html += '</div>';
      });
    });
    html += carteVol('retour', cal);
    html += '<div class="bloc vide" id="aucun-resultat" hidden><p style="font-size:2rem;margin:0">🔍</p><h3>Aucune étape trouvée</h3><p class="doux">Essayez un autre mot : une ville, une activité, un trek…</p></div>';
    $('#liste-etapes').innerHTML = html;
    filtrerEtapes();
  }

  /* Date du vol international : la veille du début pour l'aller (décalage), le dernier jour pour le retour */
  function dateVol(k, cal) {
    var v = (donnees.vols || {})[k];
    if (!v) return null;
    return k === 'aller' ? cal.debut + (v.decalage || 0) * JOUR : cal.fin + (v.decalage || 0) * JOUR;
  }
  function carteVol(k, cal) {
    var v = (donnees.vols || {})[k];
    if (!v) return '';
    var date = dateVol(k, cal);
    return '<div class="groupe-etape" data-pays="vols" data-recherche="' + esc(normaliser(v.titre + ' vol avion france ' + (v.details || ''))) + '">' +
      '<div class="vol-carte"><span class="ico" aria-hidden="true">✈</span><div><p class="surtitre" style="margin:0">' + (k === 'aller' ? 'Départ' : 'Retour') + '</p>' +
      '<h4>' + esc(v.titre) + '</h4><p class="petit">' + esc(dLong(date)) + '</p>' +
      (v.duree ? '<p class="petit doux">' + esc(v.duree) + '</p>' : '') +
      (v.details ? '<p class="petit doux">' + esc(v.details) + '</p>' : '') + '</div></div></div>';
  }

  /* ---------- Recherche dans les étapes ---------- */
  function normaliser(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function filtrerEtapes() {
    var champ = $('#recherche-etapes');
    var q = normaliser(champ ? champ.value : '').trim();
    var mots = q ? q.split(/\s+/) : [];
    var groupes = document.querySelectorAll('#liste-etapes .groupe-etape');
    var visibles = {}, n = 0;
    groupes.forEach(function (g) {
      var texte = g.getAttribute('data-recherche');
      var ok = mots.every(function (m) { return texte.indexOf(m) >= 0; });
      g.hidden = !ok;
      if (ok) { n++; visibles[g.getAttribute('data-pays')] = true; }
    });
    document.querySelectorAll('#liste-etapes [data-section-titre]').forEach(function (t) {
      t.hidden = !visibles[t.getAttribute('data-section-titre')];
    });
    var barre = document.querySelector('#liste-etapes .barre-sections');
    if (barre) barre.hidden = !!q;
    var vide = $('#aucun-resultat');
    if (vide) vide.hidden = !q || n > 0;
    $('#resultat-recherche').textContent = q ? (n ? pluriel(n, 'étape') + ' ' + (n > 1 ? 'trouvées' : 'trouvée') : '') : '';
  }
  function basculerRecherche(ouvrir) {
    var zone = $('#zone-recherche'), bouton = $('#bouton-recherche'), champ = $('#recherche-etapes');
    if (ouvrir === undefined) ouvrir = zone.hidden;
    zone.hidden = !ouvrir;
    bouton.setAttribute('aria-expanded', String(ouvrir));
    bouton.setAttribute('aria-label', ouvrir ? 'Fermer la recherche' : 'Rechercher une étape');
    if (ouvrir) champ.focus();
    else { champ.value = ''; filtrerEtapes(); bouton.focus(); }
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
      '<div><p class="surtitre">' + drapeau(p) + ' ' + esc(p.nom) + '</p><h2 id="fiche-titre">' + esc(e.nom) + '</h2></div>' +
      '<button class="fermer" data-fermer aria-label="Fermer">×</button></div>' +
      '<div class="infos">' +
      '<div class="info"><b>Dates</b>' + esc(dJour(x.arrivee)) + ' → ' + esc(dJour(x.depart)) + '</div>' +
      '<div class="info"><b>Durée</b>' + jours(x.total) + '</div>' +
      (e.altitude ? '<div class="info"><b>Altitude</b>' + e.altitude.toLocaleString('fr-FR') + ' m</div>' : '') +
      '<div class="info"><b>Hébergement</b>' + (h && h.nom ? esc(h.nom) : 'À trouver') + '</div>' +
      '</div>';
    if (h && (h.adresse || h.notes)) html += '<p class="petit">' + esc(h.adresse || '') + (h.notes ? '<br><span class="doux">' + esc(h.notes) + '</span>' : '') + '</p>';
    if (e.notes) html += '<p>📝 ' + notes(e.notes) + '</p>';

    if (e.trajet) {
      var t = e.trajet, prec = x.num > 1 ? cal.etapes[x.num - 2].etape.nom : null;
      html += '<h3>Pour venir' + (prec ? ' depuis ' + esc(prec) : '') + '</h3>' +
        '<div class="info"><div class="ligne entre"><span><span aria-hidden="true">' + icones(t) + '</span> <strong>' + esc(nomsModes(t)) + '</strong></span>' + badgeTrajet(t) + '</div>' +
        '<p style="margin:6px 0 0">' + esc(t.resume || '') + '</p>' +
        (t.details ? '<p class="petit doux" style="margin:4px 0 0">' + esc(t.details) + '</p>' : '') + '</div>';
    }

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
  var sectionsOuvertes = {};
  function rendrePlanificateur() {
    var cal = calendrier();
    var total = Math.round((cal.fin - cal.debut) / JOUR);
    var html = '<div class="bloc resume-plan">' +
      '<label class="champ">Date de départ<input type="date" id="plan-debut" value="' + esc(versIso(cal.debut)) + '"></label>' +
      '<p style="margin:10px 0 0">Fin : <b>' + esc(dLong(cal.fin)) + '</b> · ' + jours(total) + '</p>' +
      bilanPays(cal).map(lignePays).join('') + '</div>';

    html += '<p class="doux petit">Touchez une section pour la déplier. Les « jours de base » couvrent l\'arrivée, la visite et le repos ; chaque activité cochée ajoute sa durée. Vos réglages restent sur ce téléphone.</p>';

    var bilans = bilanPays(cal);
    cal.etapes.forEach(function (x, i) {
      var e = x.etape, p = paysDe(e.pays);
      // Ouverture d'une section repliable au début de chaque pays
      if (i === 0 || cal.etapes[i - 1].etape.pays !== e.pays) {
        var b = bilans.filter(function (y) { return y.pays.id === p.id; })[0];
        var depasse = b.prevus != null && b.total > b.prevus;
        html += '<details class="deroulant" data-plan-section="' + esc(p.id) + '"' + (sectionsOuvertes[p.id] ? ' open' : '') + '>' +
          '<summary><span class="ico-rond" aria-hidden="true">' + drapeau(p) + '</span><span><span class="titre-d">' + esc(p.nom) + '</span>' +
          '<span class="sous-d">' + esc(dCourt(b.debut)) + ' → ' + esc(dCourt(b.fin)) + ' · ' + jours(b.total) +
          (b.prevus != null ? ' / ' + b.prevus + ' prévus' : '') + '</span></span>' +
          (b.prevus != null ? '<span class="badge ' + (depasse ? 'alerte' : 'ok') + '">' + (depasse ? '+' + (b.total - b.prevus) + ' j' : (b.prevus - b.total ? '−' + (b.prevus - b.total) + ' j' : 'pile')) + '</span>' : '') +
          '</summary><div class="corps">';
      }
      html += '<div class="plan-etape"><div class="plan-etape-tete"><span class="num" style="background:' + esc(p.couleur) + '">' + x.num + '</span>' +
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
      if (x.marge !== undefined) {
        var pm = paysDe(e.pays);
        html += '<div class="plan-marge"><div class="base" style="margin:0"><span><b>⏳ Marge ' + esc(pm.nom) + '</b><br>' +
          '<span class="petit doux">' + esc(dJour(x.depart)) + ' → ' + esc(dJour(x.finMarge)) + ' · météo, repos, imprévus</span></span>' +
          '<span class="compteur"><button type="button" data-marge-moins="' + esc(pm.id) + '" aria-label="Un jour de marge en moins (' + esc(pm.nom) + ')">−</button>' +
          '<output aria-live="polite">' + x.marge + '</output>' +
          '<button type="button" data-marge-plus="' + esc(pm.id) + '" aria-label="Un jour de marge en plus (' + esc(pm.nom) + ')">+</button></span></div></div>' +
          '</div></details>';
      }
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
    $('#sous-titre').innerHTML = esc(dCourt(cal.debut) + ' → ' + dCourt(cal.fin)) + ' · ' +
      donnees.pays.map(drapeau).join(' ') + (donnees.voyage.datesProvisoires ? ' · dates provisoires' : '');
  }

  function resumeTexte() {
    var cal = calendrier();
    var lignes = ['Plan du voyage : départ ' + versIso(cal.debut) + ', fin ' + versIso(cal.fin) + ' (' + jours(Math.round((cal.fin - cal.debut) / JOUR)) + ')'];
    cal.etapes.forEach(function (x) {
      lignes.push(x.num + '. ' + x.etape.nom + ' : ' + versIso(x.arrivee) + ' → ' + versIso(x.depart) + ' (' + jours(x.total) + ', base ' + joursBase(x.etape) + ')' +
        (x.activites.length ? ' — ' + x.activites.map(function (a) { return a.nom; }).join(', ') : ''));
      if (x.marge) lignes.push('   Marge ' + paysDe(x.etape.pays).nom + ' : ' + jours(x.marge) + ' (' + versIso(x.depart) + ' → ' + versIso(x.finMarge) + ')');
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
        '<p class="doux">Dictez-moi vos réservations (vols, bus, trains, voiture, visites) : date, heure, lieu et lien Drive du PDF. Le numéro de réservation reste dans le PDF : le site est public. Elles apparaîtront ici et sur l\'accueil.</p></div>';
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

  /* ---------- Déroulants réutilisables ---------- */
  function deroulant(ico, titre, sous, corps, droite, attrs) {
    return '<details class="deroulant"' + (attrs || '') + '><summary><span class="ico-rond" aria-hidden="true">' + ico + '</span>' +
      '<span><span class="titre-d">' + titre + '</span>' + (sous ? '<span class="sous-d">' + sous + '</span>' : '') + '</span>' +
      (droite || '') + '</summary><div class="corps">' + corps + '</div></details>';
  }
  function puces(points) {
    return (points || []).length ? '<ul>' + points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '';
  }

  /* ---------- Conseils (groupés par catégorie, déroulants) ---------- */
  function rendreConseils() {
    var liste = donnees.conseils || [];
    if (!liste.length) { $('#conseils').innerHTML = '<div class="bloc vide"><p class="doux">Aucun conseil pour l\'instant.</p></div>'; return; }
    var cats = [];
    liste.forEach(function (c) { var k = c.categorie || 'Divers'; if (cats.indexOf(k) < 0) cats.push(k); });
    $('#conseils').innerHTML = cats.map(function (k) {
      return '<h3 class="categorie">' + esc(k) + '</h3>' + liste.filter(function (c) { return (c.categorie || 'Divers') === k; }).map(function (c) {
        return deroulant(esc(c.icone || '💡'), esc(c.titre), esc(c.resume || ''), puces(c.points));
      }).join('');
    }).join('');
  }

  /* ---------- Propositions ---------- */
  var STATUTS_PROP = { 'a-decider': 'À décider', acceptee: 'Retenue', refusee: 'Pas retenue' };
  function nbPropositionsADecider() {
    return (donnees.propositions || []).filter(function (p) { return p.statut === 'a-decider'; }).length;
  }
  function rendrePropositions() {
    var liste = donnees.propositions || [];
    var groupes = [['a-decider', 'À décider'], ['acceptee', 'Retenues'], ['refusee', 'Pas retenues']];
    $('#propositions').innerHTML = groupes.map(function (g) {
      var l = liste.filter(function (p) { return p.statut === g[0]; });
      if (!l.length) return '';
      return '<h3 class="categorie">' + esc(g[1]) + ' (' + l.length + ')</h3>' + l.map(function (p) {
        var corps = (p.impact ? '<p class="petit"><b>Impact :</b> ' + esc(p.impact) + '</p>' : '') + puces(p.details) +
          (p.statut === 'a-decider' ? '<p class="petit doux">Dites-moi « on retient » ou « on ne retient pas » et je mets l\'itinéraire à jour.</p>' : '');
        var ico = p.statut === 'a-decider' ? '💡' : (p.statut === 'acceptee' ? '✅' : '✖️');
        return deroulant(ico, esc(p.titre), esc(p.resume || ''), corps || '<p class="doux petit">Déjà intégré à l\'itinéraire.</p>',
          '<span class="badge ' + esc(p.statut) + '">' + esc(STATUTS_PROP[p.statut] || p.statut) + '</span>');
      }).join('');
    }).join('');
  }

  /* ---------- À faire : liste à cocher, cochée sur ce téléphone ---------- */
  var CLE_FAIT = 'voyage-afaire-v1';
  var CATS_AFAIRE = [
    ['avant', '📋', 'Avant le départ'], ['vol', '✈️', 'Vols'], ['bus', '🚌', 'Bus et bateaux'], ['train', '🚆', 'Trains'],
    ['activite', '🎟️', 'Billets et excursions'], ['voiture', '🚗', 'Locations de voiture'], ['hebergement', '🛏️', 'Hébergements'], ['sante', '🧪', 'Santé']
  ];
  var faits = (function () { try { return JSON.parse(localStorage.getItem(CLE_FAIT)) || {}; } catch (e) { return {}; } })();
  function sauverFaits() { try { localStorage.setItem(CLE_FAIT, JSON.stringify(faits)); } catch (e) { /* ignoré */ } }

  function listeAFaire() {
    var cal = calendrier();
    var quand = {};
    cal.etapes.forEach(function (x) { quand[x.etape.id] = x; });
    var l = (donnees.aFaire || []).map(function (a) {
      var x = a.etape && quand[a.etape];
      return Object.assign({}, a, { date: x ? (a.fin ? (x.finMarge || x.depart) : x.arrivee) : null });
    });
    // Un hébergement par étape (sauf les nuits comprises dans le circuit du Sud Lípez)
    cal.etapes.forEach(function (x) {
      var e = x.etape;
      if (e.id === 'sud-lipez') return;
      var h = e.hebergement;
      l.push({ id: 'heb-' + e.id, categorie: 'hebergement', titre: e.nom, detail: (h && h.nom) ? h.nom : jours(x.total) + ' sur place',
        date: x.arrivee, fait: !!(h && h.reserve) });
    });
    l.forEach(function (a) { a.coche = Object.prototype.hasOwnProperty.call(faits, a.id) ? !!faits[a.id] : !!a.fait; });
    return l;
  }
  function rendreAFaire() {
    var l = listeAFaire();
    var nbFaits = l.filter(function (a) { return a.coche; }).length;
    var html = '<div class="bloc"><div class="ligne entre"><b>' + nbFaits + ' sur ' + l.length + ' faits</b><span class="doux petit">Cochez au fur et à mesure</span></div>' +
      '<div class="jauge"><span style="width:' + Math.round(nbFaits / Math.max(1, l.length) * 100) + '%"></span></div>' +
      '<p class="doux petit" style="margin:8px 0 0">Les cases cochées restent sur ce téléphone. Pour les partager avec l\'autre téléphone, dites-moi ce qui est fait et je le note dans le fichier du voyage.</p></div>';
    CATS_AFAIRE.forEach(function (c) {
      var items = l.filter(function (a) { return a.categorie === c[0]; }).sort(function (a, b) { return (a.date || 0) - (b.date || 0); });
      if (!items.length) return;
      var n = items.filter(function (a) { return a.coche; }).length;
      var corps = items.map(function (a) {
        return '<label class="case"><input type="checkbox" data-fait="' + esc(a.id) + '"' + (a.coche ? ' checked' : '') + '>' +
          '<span><b' + (a.coche ? ' style="text-decoration:line-through;opacity:.6"' : '') + '>' + esc(a.titre) + '</b>' + (a.tot ? ' <span class="badge alerte">Très tôt</span>' : '') +
          (a.detail ? '<br><span class="petit doux">' + esc(a.detail) + '</span>' : '') + '</span>' +
          (a.date ? '<span class="duree">' + esc(dCourt(a.date)) + '</span>' : '') + '</label>';
      }).join('');
      html += deroulant(c[1], esc(c[2]), n + ' sur ' + items.length + ' faits', corps,
        '<span class="badge ' + (n === items.length ? 'ok' : 'a-decider') + '">' + n + '/' + items.length + '</span>',
        ' data-afaire-cat="' + c[0] + '"' + (afaireOuvertes[c[0]] ? ' open' : ''));
    });
    var y = window.scrollY;
    $('#afaire').innerHTML = html;
    window.scrollTo(0, y);
  }
  var afaireOuvertes = {};

  /* ---------- Budget : recalculé à partir de l'itinéraire et des réglages du calculateur ---------- */
  var fmtEuro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  function euros(n) { return fmtEuro.format(Math.round(n / 10) * 10); }
  function fourchette(c) { return c[0] === c[1] ? euros(c[0]) : euros(c[0]) + ' à ' + euros(c[1]); }

  function calculBudget() {
    var B = donnees.budget || { parJour: {}, fixes: [], personnes: 1 };
    var cal = calendrier();
    var postes = [
      { id: 'vie', ico: '🏠', titre: 'Vie sur place', lignes: [] },
      { id: 'excursions', ico: '🎟️', titre: 'Excursions et entrées', lignes: [] },
      { id: 'transports', ico: '🚌', titre: 'Transports entre étapes', lignes: [] },
      { id: 'fixes', ico: '✈️', titre: 'Vols, assurance, locations', lignes: [] }
    ];
    bilanPays(cal).forEach(function (b) {
      var pj = B.parJour[b.pays.id];
      if (!pj || !b.total) return;
      postes[0].lignes.push({ titre: b.pays.nom + ' : ' + jours(b.total) + ' × ' + pj[0] + ' à ' + pj[1] + ' €', cout: [b.total * pj[0], b.total * pj[1]] });
    });
    cal.etapes.forEach(function (x) {
      x.activites.forEach(function (a) { if (a.cout) postes[1].lignes.push({ titre: a.nom + ' (' + x.etape.nom + ')', cout: a.cout }); });
      var t = x.etape.trajet;
      if (t && t.cout) postes[2].lignes.push({ titre: 'Vers ' + x.etape.nom + ' : ' + nomsModes(t), cout: t.cout });
    });
    (B.fixes || []).forEach(function (fx) { postes[3].lignes.push({ titre: fx.titre, cout: fx.cout }); });
    var total = [0, 0];
    postes.forEach(function (p) {
      p.total = p.lignes.reduce(function (s, l) { return [s[0] + l.cout[0], s[1] + l.cout[1]]; }, [0, 0]);
      total[0] += p.total[0]; total[1] += p.total[1];
    });
    var finVoyage = donnees.voyage.fin ? versDate(donnees.voyage.fin) + JOUR : cal.fin;
    return { postes: postes, total: total, personnes: B.personnes || 1, note: B.note, detailJour: B.parJourDetail,
      joursPlanifies: Math.round((cal.fin - cal.debut) / JOUR), joursLibres: Math.max(0, Math.round((finVoyage - cal.fin) / JOUR)) };
  }

  function rendreBudget() {
    var b = calculBudget(), n = b.personnes;
    var html = '<div class="bloc bloc-heros"><p class="surtitre">Budget estimé par personne</p>' +
      '<p class="grand-chiffre" style="font-size:2rem">' + euros(b.total[0]) + ' à ' + euros(b.total[1]) + '</p>' +
      (n > 1 ? '<p class="doux" style="margin:8px 0 0">Pour ' + n + ' : <b style="color:#fff">' + euros(b.total[0] * n) + ' à ' + euros(b.total[1] * n) + '</b></p>' : '') +
      '<p class="doux petit" style="margin:6px 0 0">Calculé sur ' + jours(b.joursPlanifies) + ' planifiés' +
      (b.joursLibres ? ' · ' + jours(b.joursLibres) + ' pas encore attribués, non comptés' : '') + '</p></div>';

    // Répartition par poste
    html += '<div class="bloc"><p class="surtitre">Répartition</p>' + b.postes.map(function (p) {
      var pct = b.total[1] ? Math.round((p.total[0] + p.total[1]) / (b.total[0] + b.total[1]) * 100) : 0;
      return '<div style="margin-top:10px"><div class="ligne entre"><span>' + p.ico + ' <b>' + esc(p.titre) + '</b></span><span class="petit">' + fourchette(p.total) + '</span></div>' +
        '<div class="jauge"><span style="width:' + pct + '%;background:var(--accent)"></span></div></div>';
    }).join('') + '</div>';

    html += '<p class="intro" style="margin:0 0 10px">Touchez un poste pour voir le détail.</p>';
    html += b.postes.map(function (p) {
      var corps = (p.id === 'vie' && b.detailJour ? '<p class="petit doux">' + esc(b.detailJour) + '</p>' : '') +
        '<ul class="activites">' + p.lignes.map(function (l) {
          return '<li><div class="ligne entre" style="align-items:flex-start"><span class="petit">' + esc(l.titre) + '</span><b class="petit" style="white-space:nowrap">' + fourchette(l.cout) + '</b></div></li>';
        }).join('') + '</ul>';
      return deroulant(p.ico, esc(p.titre), pluriel(p.lignes.length, 'ligne') + ' · ' + fourchette(p.total), corps);
    }).join('');
    html += '<div class="bloc"><p class="petit doux" style="margin:0">' + esc(b.note || '') + ' Le budget se met à jour tout seul quand vous changez les durées ou les activités dans l\'onglet Dates, et quand je modifie l\'itinéraire. Prévoir environ 10 % de réserve.</p></div>';
    $('#budget').innerHTML = html;
  }

  /* ---------- Menu « Plus » ---------- */
  function rendrePlus() {
    var l = listeAFaire();
    var nbFaits = l.filter(function (a) { return a.coche; }).length;
    var aD = nbPropositionsADecider();
    var items = [
      ['#afaire', '✅', 'À faire', nbFaits + ' sur ' + l.length + ' faits : réservations, billets, locations…'],
      ['#budget', '💶', 'Budget', (function () { var b = calculBudget(); return euros(b.total[0]) + ' à ' + euros(b.total[1]) + ' par personne'; })()],
      ['#resas', '🎫', 'Réservations', (donnees.reservations || []).length ? pluriel(donnees.reservations.length, 'réservation') : 'Aucune pour l\'instant'],
      ['#propositions', '💡', 'Propositions', aD ? pluriel(aD, 'idée') + ' à décider' : 'Tout est décidé'],
      ['#conseils', '🧭', 'Conseils', pluriel((donnees.conseils || []).length, 'fiche') + ' : santé, argent, équipement…']
    ];
    $('#menu-plus').innerHTML = items.map(function (i) {
      return '<a href="' + i[0] + '"><span class="ico" aria-hidden="true">' + i[1] + '</span><span><b>' + esc(i[2]) + '</b><span class="petit doux">' + esc(i[3]) + '</span></span><span class="chevron" aria-hidden="true">›</span></a>';
    }).join('');
  }
  function majPastille() {
    var n = nbPropositionsADecider(), p = $('#nb-propositions');
    p.textContent = n; p.hidden = !n;
    p.setAttribute('aria-label', pluriel(n, 'proposition') + ' à décider');
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
      // OpenStreetMap refuse les tuiles demandées sans l'adresse du site.
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(carte);

    var cal = calendrier();
    dessinerFrontieres();

    // Un segment par trajet, dessiné selon le moyen de transport.
    cal.etapes.forEach(function (x, i) {
      if (i === 0) return;
      var a = cal.etapes[i - 1].etape, b = x.etape, t = b.trajet || { modes: [], statut: 'propose' };
      var m = MODES[(t.modes || [])[0]] || { couleur: '#6b7280', tirets: '4 6' };
      var sur = t.statut === 'choisi' || t.statut === 'reserve';
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
        color: m.couleur, weight: sur ? 5 : 4, opacity: sur ? 1 : .8, dashArray: m.tirets, interactive: false
      }).addTo(carte);
      // Zone de clic plus large, invisible, pour le doigt.
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#000', weight: 22, opacity: 0 })
        .bindPopup('<b>' + icones(t) + ' ' + esc(a.nom) + ' → ' + esc(b.nom) + '</b><br>' + esc(t.resume || 'Trajet à définir') +
          '<br><span>' + esc(STATUTS_TRAJET[t.statut] || '') + '</span>')
        .addTo(carte);
    });

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
        var coul = activiteChoisie(a) ? '#2f7a45' : (a.statut === 'suggestion' ? '#6d4ea0' : '#c08a12');
        L.marker([a.lat, a.lng], {
          title: a.nom,
          icon: L.divIcon({ className: '', html: '<span class="point-activite" style="background:' + coul + '">★</span>', iconSize: [24, 24], iconAnchor: [12, 12] })
        }).bindTooltip(esc(a.nom), { permanent: true, direction: 'right', offset: [12, 0], className: 'etiquette' }).bindPopup('<b>' + esc(a.nom) + '</b><br><span>' + esc(STATUTS[a.statut] || '') + ' · ' + esc(e.nom) + '</span><br>' +
          '<button class="bouton" data-fiche="' + esc(e.id) + '">Voir l\'étape</button>').addTo(coucheActivites);
      });
    });
    coucheActivites.addTo(carte);

    // Les noms des points d'intérêt s'affichent dès qu'on zoome un peu.
    function etiquettes() { carte.getContainer().classList.toggle('sans-etiquettes', carte.getZoom() < 8); }
    carte.on('zoomend', etiquettes);

    var legende = L.control({ position: 'bottomleft' });
    legende.onAdd = function () {
      var d = L.DomUtil.create('div', 'legende');
      d.innerHTML = '<span><i style="background:#2f7a45"></i>Prévu</span><span><i style="background:#c08a12"></i>Option</span><span><i style="background:#6d4ea0"></i>Suggestion</span>';
      return d;
    };
    legende.addTo(carte);

    vueEnsemble();
    etiquettes();
    // Les arcs des vols se dessinent une fois la carte positionnée (Leaflet a besoin d'une vue)
    dessinerVols();
  }
  /* Frontières des pays du voyage (data/frontieres.geojson) et nom en grand.
     Couleur et position du nom : champs "couleur" et "etiquette" du pays dans voyage.json. */
  var PAYS_PAR_DEFAUT = {
    perou: { nom: 'Pérou', couleur: '#c8102e', etiquette: [-6.6, -74.4] },
    bolivie: { nom: 'Bolivie', couleur: '#2e7d32', etiquette: [-16.8, -64.6] },
    chili: { nom: 'Chili', couleur: '#1565c0', etiquette: [-24.5, -69.6] },
    argentine: { nom: 'Argentine', couleur: '#4a90c2', etiquette: [-35.5, -65] }
  };
  function dessinerFrontieres() {
    carte.createPane('frontieres').style.zIndex = 350;
    carte.createPane('nomsPays').style.zIndex = 380;
    carte.getPane('nomsPays').style.pointerEvents = 'none';

    fetch('data/frontieres.geojson').then(function (r) { return r.json(); }).then(function (geo) {
      geo.features.forEach(function (f) {
        var id = f.properties.pays;
        var p = donnees.pays.filter(function (x) { return x.id === id; })[0] || {};
        var d = PAYS_PAR_DEFAUT[id] || {};
        var couleur = p.couleur || d.couleur || '#1f5f66';
        L.geoJSON(f, {
          pane: 'frontieres', interactive: false,
          style: { color: couleur, weight: 3, opacity: .9, fillColor: couleur, fillOpacity: .07 }
        }).addTo(carte);
        var pos = p.etiquette || d.etiquette;
        if (pos) {
          L.marker(pos, {
            pane: 'nomsPays', interactive: false, keyboard: false,
            icon: L.divIcon({ className: '', html: '<span class="nom-pays" style="color:' + esc(couleur) + '">' + esc(d.nom || p.nom || f.properties.nom) + '</span>', iconSize: [0, 0] })
          }).addTo(carte);
        }
      });
    }).catch(function () { /* pas de frontières : la carte reste utilisable */ });

    function tailleNoms() {
      var z = carte.getZoom(), c = carte.getContainer();
      c.classList.toggle('noms-petits', z <= 4);
      c.classList.toggle('noms-caches', z >= 9);
    }
    carte.on('zoomend', tailleNoms);
    tailleNoms();
  }

  /* Vols internationaux : arcs en pointillés depuis et vers la France */
  var coucheVols = null;
  function arc(a, b) {
    // Courbe de Bézier entre deux aéroports, légèrement bombée, pour évoquer un trajet aérien
    var lat1 = a.lat, lng1 = a.lng, lat2 = b.lat, lng2 = b.lng;
    var mlat = (lat1 + lat2) / 2, mlng = (lng1 + lng2) / 2;
    var dlat = lat2 - lat1, dlng = lng2 - lng1;
    var k = 0.18;
    var clat = mlat + dlng * k, clng = mlng - dlat * k;
    var pts = [];
    for (var i = 0; i <= 40; i++) {
      var t = i / 40, u = 1 - t;
      pts.push([u * u * lat1 + 2 * u * t * clat + t * t * lat2, u * u * lng1 + 2 * u * t * clng + t * t * lng2]);
    }
    return pts;
  }
  function dessinerVols() {
    var vols = donnees.vols;
    if (!vols) return;
    coucheVols = L.layerGroup();
    var cal = calendrier();
    [['aller', cal.debut + ((vols.aller && vols.aller.decalage) || 0) * JOUR], ['retour', cal.fin]].forEach(function (v) {
      var vol = vols[v[0]];
      if (!vol || !vol.points || vol.points.length < 2) return;
      var popup = '<b>✈️ ' + esc(vol.titre) + '</b><br>' + esc(dLong(v[1])) + '<br><span>' + esc(vol.duree || '') + '</span>';
      for (var i = 0; i < vol.points.length - 1; i++) {
        var seg = arc(vol.points[i], vol.points[i + 1]);
        L.polyline(seg, { color: '#2b6cb0', weight: 3, opacity: .9, dashArray: '2 8', lineCap: 'round', interactive: false }).addTo(coucheVols);
        L.polyline(seg, { color: '#000', weight: 22, opacity: 0 }).bindPopup(popup).addTo(coucheVols);
      }
      vol.points.forEach(function (p) {
        if (p.nom !== 'Paris' || v[0] !== 'aller') return;
        L.marker([p.lat, p.lng], {
          title: 'France',
          icon: L.divIcon({ className: '', html: '<span class="marqueur marqueur-vol">✈</span>', iconSize: [30, 30], iconAnchor: [15, 15] })
        }).bindPopup('<b>✈️ France (Paris)</b><br>Départ le ' + esc(dLong(cal.debut + ((vols.aller && vols.aller.decalage) || 0) * JOUR)) +
          '<br>Retour le ' + esc(dLong(cal.fin))).addTo(coucheVols);
      });
    });
    coucheVols.addTo(carte);
  }
  function voirVols() {
    if (!carte || !donnees.vols) return;
    var pts = [];
    ['aller', 'retour'].forEach(function (k) { ((donnees.vols[k] || {}).points || []).forEach(function (p) { pts.push([p.lat, p.lng]); }); });
    donnees.etapes.forEach(function (e) { pts.push([e.lat, e.lng]); });
    if (coucheVols && !carte.hasLayer(coucheVols)) coucheVols.addTo(carte);
    carte.fitBounds(pts, { padding: [30, 30] });
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
    caches.open('tuiles-prechargees-v2').then(function (cache) {
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
              return fetch(u, { mode: 'cors', referrerPolicy: 'strict-origin-when-cross-origin' }).then(function (rep) {
                // Image de blocage OSM : code 200 mais « no-cache ». On ne l'enregistre pas.
                if (rep.ok && !/no-cache|no-store/i.test(rep.headers.get('Cache-Control') || '')) return cache.put(u, rep);
                throw new Error();
              });
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

  /* La carte occupe exactement l'espace entre l'en-tête et le menu du bas,
     quelle que soit leur hauteur réelle (titre sur deux lignes, encoche, etc.). */
  function ajusterCarte() {
    var haut = $('.entete').getBoundingClientRect().bottom;
    var bas = $('.onglets').getBoundingClientRect().top;
    $('#carte').style.height = Math.max(200, bas - haut) + 'px';
    if (carte) carte.invalidateSize();
  }
  window.addEventListener('resize', function () {
    if (!$('#vue-carte').hidden) ajusterCarte();
  });

  /* ---------- Navigation ---------- */
  var VUES = ['accueil', 'carte', 'etapes', 'planifier', 'plus', 'resas', 'conseils', 'propositions', 'afaire', 'budget'];
  var SOUS_PLUS = ['resas', 'conseils', 'propositions', 'afaire', 'budget'];
  function afficherVue() {
    var v = location.hash.replace('#', '') || 'accueil';
    if (VUES.indexOf(v) < 0) v = 'accueil';
    majSousTitre();
    majPastille();
    VUES.forEach(function (n) { $('#vue-' + n).hidden = n !== v; });
    var onglet = SOUS_PLUS.indexOf(v) >= 0 ? 'plus' : v;
    document.querySelectorAll('.onglets a').forEach(function (a) {
      if (a.getAttribute('data-vue') === onglet) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (v === 'accueil') rendreAccueil();
    if (v === 'etapes') rendreEtapes();
    if (v === 'planifier') rendrePlanificateur();
    if (v === 'plus') rendrePlus();
    if (v === 'resas') rendreReservations();
    if (v === 'conseils') rendreConseils();
    if (v === 'propositions') rendrePropositions();
    if (v === 'afaire') rendreAFaire();
    if (v === 'budget') rendreBudget();
    document.body.classList.toggle('sur-carte', v === 'carte');
    if (v === 'carte') {
      ajusterCarte();
      try { initCarte(); } catch (err) { $('#carte-etat').textContent = 'Erreur carte : ' + (err && err.message); throw err; }
      if (carte) setTimeout(function () { carte.invalidateSize(); }, 50);
    }
    if (v !== 'carte') window.scrollTo(0, 0);
  }

  function evenements() {
    document.addEventListener('click', function (ev) {
      var c = ev.target.closest('[data-fiche],[data-fermer],[data-carte],[data-moins],[data-plus],[data-marge-moins],[data-marge-plus],[data-copier],[data-filtre],[data-section],#plan-copier,#plan-reset,#bouton-activites,#bouton-ensemble,#bouton-hors-ligne,#bouton-vols');
      if (!c) return;
      if (c.hasAttribute('data-section')) {
        var cible = document.getElementById('section-' + c.getAttribute('data-section'));
        if (cible) cible.scrollIntoView({ block: 'start' });
      }
      else if (c.hasAttribute('data-fiche')) { carte && carte.closePopup(); ouvrirFiche(c.getAttribute('data-fiche')); }
      else if (c.hasAttribute('data-fermer')) fermerFiche();
      else if (c.hasAttribute('data-carte')) {
        var id = c.getAttribute('data-carte');
        fermerFiche(); location.hash = '#carte';
        setTimeout(function () {
          var e = donnees.etapes.filter(function (x) { return x.id === id; })[0];
          if (!carte || !e) return;
          // Cadrer l'étape et ses points d'intérêt.
          var pts = [[e.lat, e.lng]].concat((e.activites || []).filter(function (a) { return typeof a.lat === 'number'; }).map(function (a) { return [a.lat, a.lng]; }));
          if (pts.length > 1) carte.fitBounds(pts, { padding: [50, 50], maxZoom: 12 }); else carte.setView([e.lat, e.lng], 11);
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
      else if (c.hasAttribute('data-marge-moins') || c.hasAttribute('data-marge-plus')) {
        var plus = c.hasAttribute('data-marge-plus');
        var pid = c.getAttribute(plus ? 'data-marge-plus' : 'data-marge-moins');
        plan.marges[pid] = Math.max(0, Math.min(60, margePays(pid) + (plus ? 1 : -1)));
        sauverPlan(); rendrePlanificateur();
        var bm = document.querySelector('[data-marge-' + (plus ? 'plus' : 'moins') + '="' + pid + '"]');
        if (bm) bm.focus();
      }
      else if (c.hasAttribute('data-copier')) copier(c.getAttribute('data-copier'));
      else if (c.hasAttribute('data-filtre')) { filtreResa = c.getAttribute('data-filtre'); rendreReservations(); }
      else if (c.id === 'plan-copier') copier(resumeTexte());
      else if (c.id === 'plan-reset') {
        if (confirm('Revenir aux durées et activités de départ ?')) { plan = { debut: null, jours: {}, activites: {}, marges: {} }; sauverPlan(); rendrePlanificateur(); toast('Valeurs de départ rétablies'); }
      }
      else if (c.id === 'bouton-activites') {
        var on = c.getAttribute('aria-pressed') !== 'true';
        c.setAttribute('aria-pressed', String(on));
        if (carte) { if (on) coucheActivites.addTo(carte); else carte.removeLayer(coucheActivites); }
      }
      else if (c.id === 'bouton-ensemble') vueEnsemble();
      else if (c.id === 'bouton-vols') voirVols();
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
      else if (t.hasAttribute && t.hasAttribute('data-fait')) {
        var fid = t.getAttribute('data-fait');
        faits[fid] = t.checked;
        sauverFaits(); rendreAFaire();
        var cf = document.querySelector('[data-fait="' + fid + '"]');
        if (cf) cf.focus();
        if (t.checked) toast('C\'est fait ✓');
      }
    });

    // Recherche dans les étapes
    $('#bouton-recherche').addEventListener('click', function () { basculerRecherche(); });
    $('#recherche-etapes').addEventListener('input', filtrerEtapes);
    $('#recherche-etapes').addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') basculerRecherche(false);
      if (ev.key === 'Enter') ev.target.blur();
    });

    // Mémoriser les sections dépliées pour les garder ouvertes après un recalcul
    document.addEventListener('toggle', function (ev) {
      var el = ev.target;
      if (!el.getAttribute) return;
      var s = el.getAttribute('data-plan-section'), a = el.getAttribute('data-afaire-cat');
      if (s) sectionsOuvertes[s] = el.open;
      if (a) afaireOuvertes[a] = el.open;
    }, true);

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
