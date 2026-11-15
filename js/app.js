/* Voyage Amérique du Sud : appli hors ligne.
   Toutes les données viennent de data/voyage.json.
   Les réglages, cases cochées, dépenses, journal et notes restent sur le téléphone (localStorage). */
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
  var fmtJourCourt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });
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
        var ee = enCours.etape, hh = ee.hebergement, suivante = cal.etapes[enCours.num], points = [];
        // Le fil de la journée : trajet d'arrivée, réservations, hébergement, activités, note, départ du lendemain
        if (auj === enCours.arrivee && ee.trajet) points.push(['<span aria-hidden="true">' + icones(ee.trajet) + '</span>', '<b>Trajet du jour</b><br><span class="doux">' + esc(ee.trajet.resume || nomsModes(ee.trajet)) + '</span>']);
        duJour.filter(function (ev) { return ev.resa; }).forEach(function (ev) {
          points.push(['<span aria-hidden="true">' + (TYPES[ev.resa.type] || TYPES.autre).ico + '</span>', '<b>' + (ev.heure ? esc(ev.heure) + ' · ' : '') + esc(ev.resa.titre) + '</b>' +
            (ev.resa.lieu ? '<br><span class="doux">' + esc(ev.resa.lieu) + '</span>' : '') +
            (lienDriveSur(ev.resa.lienDrive) ? '<br><a href="' + esc(ev.resa.lienDrive) + '" target="_blank" rel="noopener noreferrer">Ouvrir le billet (Drive)</a>' : '')]);
        });
        points.push(['🛏️', hh && hh.nom ? '<b>' + esc(hh.nom) + '</b>' + (hh.adresse ? '<br><a href="' + esc(lienMaps(0, 0, hh.nom + ' ' + hh.adresse)) + '" target="_blank" rel="noopener noreferrer">' + esc(hh.adresse) + '</a>' : '')
          : '<b>Hébergement à trouver</b>']);
        if (enCours.activites.length) points.push(['🎟️', '<b>À faire ici</b><br><span class="doux">' + esc(enCours.activites.map(function (a) { return a.nom; }).join(' · ')) + '</span>']);
        if (notesPerso[ee.id]) points.push(['🗒️', '<span class="texte-journal">' + esc(notesPerso[ee.id]) + '</span>']);
        var mto = ligneMeteo(ee);
        if (mto) points.push(mto);
        if (suivante && auj + JOUR === enCours.depart && !enCours.marge) {
          var td = suivante.etape.trajet;
          points.push(['🧳', '<b>Demain : départ pour ' + esc(suivante.etape.nom) + '</b>' + (td ? '<br><span class="doux">' + esc(td.resume || nomsModes(td)) + '</span>' : '')]);
        }
        html += '<ul class="fil-jour">' + points.map(function (pt) { return '<li><span class="fil-ico">' + pt[0] + '</span><span class="petit">' + pt[1] + '</span></li>'; }).join('') + '</ul>';
        if (suivante) {
          var ts = suivante.etape.trajet;
          html += '<p class="ensuite petit"><b>Ensuite</b> · ' + (ts ? '<span aria-hidden="true">' + icones(ts) + '</span> ' : '') + esc(suivante.etape.nom) +
            ' <span class="doux">le ' + esc(dJour(suivante.arrivee)) + '</span></p>';
        }
        var iti = suivante && lienItineraire(ee, suivante.etape);
        html += '<div class="boutons"><button class="bouton plein" data-fiche="' + esc(ee.id) + '">Voir la fiche</button>' +
          '<a class="bouton" href="' + esc(lienMaps(ee.lat, ee.lng)) + '" target="_blank" rel="noopener noreferrer">Ouvrir dans Maps</a>' +
          (iti ? '<a class="bouton" href="' + esc(iti) + '" target="_blank" rel="noopener noreferrer">Trajet vers ' + esc(suivante.etape.nom) + '</a>' : '') + '</div></div>';
        chargerMeteo(ee, function () { if (vueCourante() === 'accueil') rafraichir(); });
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

    // Les prochaines choses à faire, cochables directement
    var priorites = prioritesAFaire(3);
    if (priorites.length) {
      html += '<div class="bloc"><div class="ligne entre"><p class="surtitre">À faire en priorité</p><a class="petit lien-discret" href="#afaire">Tout voir ›</a></div>' +
        priorites.map(caseAFaire).join('') + '</div>';
    }

    // Raccourcis
    var aDecider = nbPropositionsADecider();
    function raccourci(lien, ico, titre, sous, jauge) {
      return '<a class="raccourci" href="' + lien + '"><span class="ico" aria-hidden="true">' + ico + '</span><b>' + esc(titre) + '</b><span class="doux">' + esc(sous) + '</span>' +
        (jauge == null ? '' : '<span class="jauge"><span style="width:' + Math.round(jauge * 100) + '%"></span></span>') + '</a>';
    }
    var txtResas = (donnees.reservations || []).length ? pluriel(donnees.reservations.length, 'réservation') : 'Aucune pour l\'instant';
    if (auj >= cal.debut && auj < cal.fin) {
      // Pendant le voyage : ce qui sert tous les jours
      var depJour = depenses.filter(function (d) { return d.date === versIso(auj); }).reduce(function (t, d) { return t + d.eur; }, 0);
      html += '<div class="raccourcis">' +
        raccourci('#depenses', '🧾', 'Noter une dépense', depJour ? eurosPrecis(depJour) + ' aujourd\'hui' : 'Rien noté aujourd\'hui') +
        raccourci('#devises', '💱', 'Convertisseur', '1 € = ' + fmtNombre.format(tauxDe(DEVISES[taux.devise] ? taux.devise : 'ARS')) + ' ' + (DEVISES[taux.devise] ? taux.devise : 'ARS')) +
        raccourci('#journal', '📓', 'Journal', journal[versIso(auj)] ? 'Page du jour écrite ✓' : 'Écrire la page du jour') +
        raccourci('#resas', '🎫', 'Réservations', txtResas) + '</div>';
    } else {
      var lf = listeAFaire(), nf = lf.filter(function (a) { return a.coche; }).length;
      var sac = listeBagages().reduce(function (t, c) { return t.concat(c.items); }, []), ns = sac.filter(function (i) { return bagages.coches[i.id]; }).length;
      html += '<div class="raccourcis">' +
        raccourci('#afaire', '✅', 'À faire', nf + ' sur ' + lf.length + ' faits', nf / Math.max(1, lf.length)) +
        raccourci('#bagages', '🎒', 'Bagages', ns + ' sur ' + sac.length + ' dans le sac', ns / Math.max(1, sac.length)) +
        raccourci('#propositions', '💡', 'Propositions', aDecider ? pluriel(aDecider, 'idée') + ' à décider' : 'Tout est décidé') +
        raccourci('#conseils', '🧭', 'Conseils', pluriel((donnees.conseils || []).length, 'fiche')) + '</div>';
    }

    var total = dureeTotale;
    html += '<div class="bloc"><p class="surtitre">Le voyage en bref</p>' +
      '<p>' + esc(dCourt(cal.debut)) + ' → ' + esc(dCourt(cal.fin)) + ' · <b>' + jours(total) + '</b> · ' + pluriel(cal.etapes.length, 'étape') + '</p>' +
      frise(cal, auj) +
      bilanPays(cal).map(lignePays).join('') +
      (function () { var b = calculBudget(); return '<p style="margin:14px 0 0">💶 Budget estimé : <b>' + euros(b.total[0]) + ' à ' + euros(b.total[1]) + '</b> par personne</p>'; })() +
      '<div class="boutons"><a class="bouton plein" href="#planifier">Ajuster les dates</a><a class="bouton" href="#budget">Voir le budget</a></div></div>';

    if (donnees.voyage.datesProvisoires) {
      html += '<p class="doux petit">Les dates sont provisoires : elles sont calculées à partir de la durée de chaque étape. Réglez-les dans l\'onglet « Dates ».</p>';
    }
    $('#accueil').innerHTML = html;
  }

  /* Frise du voyage : une bande par section, large selon sa durée, avec un repère « aujourd'hui » pendant le voyage. */
  function frise(cal, auj) {
    var duree = cal.fin - cal.debut;
    if (duree <= 0) return '';
    var segments = bilanPays(cal).filter(function (b) { return b.total; }).map(function (b) {
      return '<a href="#etapes" data-aller-section="' + esc(b.pays.id) + '" style="flex:' + b.total + ';background:' + esc(b.pays.couleur) + '" title="' + esc(b.pays.nom + ' : ' + jours(b.total)) + '">' +
        '<span class="sr-only">' + esc(b.pays.nom + ' : ' + jours(b.total)) + '</span></a>';
    }).join('');
    var repere = (auj >= cal.debut && auj < cal.fin)
      ? '<i class="frise-auj" style="left:' + ((auj - cal.debut) / duree * 100).toFixed(1) + '%" aria-hidden="true"></i>' : '';
    return '<div class="frise">' + segments + repere + '</div>' +
      '<div class="ligne entre petit doux frise-dates"><span>' + esc(dCourt(cal.debut)) + '</span><span>' + esc(dCourt(cal.fin)) + '</span></div>';
  }

  function lienMaps(lat, lng, texte) {
    return 'https://www.google.com/maps/search/?api=1&query=' + (texte ? encodeURIComponent(texte) : lat + ',' + lng);
  }

  /* Itinéraire routier d'une étape à la suivante dans Maps (pas pour les vols ni les bateaux). */
  function lienItineraire(a, b) {
    var modes = (b.trajet && b.trajet.modes) || [];
    if (!modes.length || modes[0] === 'vol' || modes[0] === 'bateau' || (a.lat === b.lat && a.lng === b.lng)) return null;
    var mode = modes[0] === 'marche' ? 'walking' : (modes[0] === 'velo' ? 'bicycling' : 'driving');
    return 'https://www.google.com/maps/dir/?api=1&origin=' + a.lat + ',' + a.lng + '&destination=' + b.lat + ',' + b.lng + '&travelmode=' + mode;
  }
  function distanceKm(a, b) {
    var r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 12742 * Math.asin(Math.sqrt(h));
  }

  /* ---------- Météo de l'étape (Open-Meteo, gratuit et sans compte ; seules les coordonnées de l'étape sont envoyées) ---------- */
  var CLE_METEO = 'voyage-meteo-v1';
  var meteo = (function () { try { return JSON.parse(localStorage.getItem(CLE_METEO)) || {}; } catch (e) { return {}; } })();
  var meteoEnCours = {}, meteoOuverte = false;
  var CIEL = [[0, '☀️', 'Ciel dégagé'], [1, '🌤️', 'Peu nuageux'], [2, '⛅', 'Éclaircies'], [3, '☁️', 'Couvert'], [48, '🌫️', 'Brouillard'], [57, '🌦️', 'Bruine'],
    [67, '🌧️', 'Pluie'], [77, '🌨️', 'Neige'], [82, '🌧️', 'Averses'], [86, '🌨️', 'Averses de neige'], [99, '⛈️', 'Orage']];
  function ciel(code) {
    for (var i = 0; i < CIEL.length; i++) if (code <= CIEL[i][0]) return CIEL[i];
    return [0, '🌡️', ''];
  }
  function chargerMeteo(e, puis) {
    var m = meteo[e.id];
    if ((m && Date.now() - m.t < 3 * 3600000) || meteoEnCours[e.id] || !navigator.onLine) return;
    meteoEnCours[e.id] = true;
    fetch('https://api.open-meteo.com/v1/forecast?latitude=' + e.lat + '&longitude=' + e.lng +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset&timezone=auto&forecast_days=5')
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) {
        if (!d || !d.daily || !d.daily.time) throw new Error();
        meteo[e.id] = { t: Date.now(), d: d.daily };
        // Ne garder que les étapes consultées récemment
        Object.keys(meteo).sort(function (a, b) { return meteo[b].t - meteo[a].t; }).slice(8).forEach(function (k) { delete meteo[k]; });
        try { localStorage.setItem(CLE_METEO, JSON.stringify(meteo)); } catch (err) { /* ignoré */ }
        delete meteoEnCours[e.id];
        puis();
      }).catch(function () { meteoEnCours[e.id] = 'echec'; });
  }
  function ageMeteo(m) {
    var h = Math.round((Date.now() - m.t) / 3600000);
    return h < 1 ? 'à l\'instant' : (h < 24 ? 'il y a ' + h + ' h' : 'il y a ' + pluriel(Math.round(h / 24), 'jour'));
  }
  /* Prévisions à 5 jours dans la fiche d'une étape */
  function blocMeteo(e) {
    var m = meteo[e.id];
    if (!m) return '<p class="petit doux">' + (navigator.onLine && meteoEnCours[e.id] !== 'echec' ? 'Chargement de la météo…' : 'Météo indisponible sans réseau.') + '</p>';
    var d = m.d;
    return '<div class="meteo">' + d.time.map(function (jour, i) {
      var c = ciel(d.weather_code[i]);
      return '<div class="meteo-jour"><span class="petit doux">' + esc(i === 0 ? 'Auj.' : fmtJourCourt.format(versDate(jour))) + '</span>' +
        '<span class="meteo-ico" title="' + esc(c[2]) + '"><span aria-hidden="true">' + c[1] + '</span><span class="sr-only">' + esc(c[2]) + '</span></span>' +
        '<b>' + Math.round(d.temperature_2m_max[i]) + '°</b><span class="doux">' + Math.round(d.temperature_2m_min[i]) + '°</span>' +
        '<span class="petit doux">💧' + (d.precipitation_probability_max[i] == null ? '–' : d.precipitation_probability_max[i] + ' %') + '</span>' +
        '<span class="petit doux">💨' + Math.round(d.wind_speed_10m_max[i]) + '</span></div>';
    }).join('') + '</div>' +
      '<p class="petit doux" style="margin:8px 0 0">🌅 Lever ' + esc(String(d.sunrise[0]).slice(11, 16)) + ' · 🌇 coucher ' + esc(String(d.sunset[0]).slice(11, 16)) +
      ' (heure locale) · vent en km/h · mis à jour ' + esc(ageMeteo(m)) + '</p>';
  }
  /* Une ligne pour le bloc « Aujourd'hui » de l'accueil */
  function ligneMeteo(e) {
    var m = meteo[e.id];
    if (!m || Date.now() - m.t > 36 * 3600000) return null;
    var d = m.d, c = ciel(d.weather_code[0]);
    return ['<span aria-hidden="true">' + c[1] + '</span>', '<b>' + esc(c[2]) + ' · ' + Math.round(d.temperature_2m_min[0]) + '° à ' + Math.round(d.temperature_2m_max[0]) + '°</b>' +
      '<br><span class="doux">Vent jusqu\'à ' + Math.round(d.wind_speed_10m_max[0]) + ' km/h · lever ' + esc(String(d.sunrise[0]).slice(11, 16)) + ', coucher ' + esc(String(d.sunset[0]).slice(11, 16)) + '</span>'];
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
    var auj = aujourdhui();
    var enVoyage = auj >= cal.debut && auj < cal.fin;
    var html = '<div class="barre-sections"><div class="defile" role="group" aria-label="Aller à une section">' +
      (enVoyage ? '<button type="button" class="puce puce-auj" data-section="aujourdhui">📍 Aujourd\'hui</button>' : '') +
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
        var maNote = notesPerso[x.etape.id];
        var cherchable = [x.etape.nom, p.nom, x.etape.notes, maNote, h && h.nom, t && t.resume, t && nomsModes(t)]
          .concat((x.etape.activites || []).map(function (a) { return a.nom + ' ' + (a.description || ''); })).join(' ');
        var fin = x.finMarge || x.depart;
        var etat = !enVoyage ? '' : (auj >= fin ? ' passee' : (auj >= x.arrivee ? ' en-cours' : ''));
        html += '<div class="groupe-etape' + etat + '"' + (etat === ' en-cours' ? ' id="section-aujourdhui"' : '') + ' data-pays="' + esc(p.id) + '" data-recherche="' + esc(normaliser(cherchable)) + '">';
        if (t) {
          html += '<button class="trajet" data-fiche="' + esc(x.etape.id) + '" aria-label="Trajet vers ' + esc(x.etape.nom) + '">' +
            '<span class="trajet-ico" aria-hidden="true">' + icones(t) + '</span>' +
            '<span class="trajet-texte">' + esc(t.resume || nomsModes(t)) + '</span>' + badgeTrajet(t) + '</button>';
        }
        html += '<button class="etape-carte" data-fiche="' + esc(x.etape.id) + '">' +
          '<span class="num" style="background:' + esc(p.couleur) + '">' + x.num + '</span>' +
          '<span class="etape-corps"><h4>' + esc(x.etape.nom) + (etat === ' en-cours' ? ' <span class="badge ok">Vous êtes ici</span>' : '') + '</h4>' +
          '<p class="petit">' + esc(dJour(x.arrivee)) + ' → ' + esc(dJour(x.depart)) + ' · <b>' + jours(x.total) + '</b></p>' +
          '<p class="petit doux">🛏️ ' + (h && h.nom ? esc(h.nom) : 'Hébergement à trouver') + '</p>' +
          (x.activites.length ? '<p class="petit doux">' + esc(x.activites.map(function (a) { return a.nom; }).join(' · ')) + '</p>' : '') +
          (x.etape.notes ? '<p class="petit doux">📝 ' + notes(x.etape.notes) + '</p>' : '') +
          (maNote ? '<p class="petit note-apercu">🗒️ ' + esc(maNote.length > 90 ? maNote.slice(0, 90) + '…' : maNote) + '</p>' : '') +
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
      (v.details ? '<details class="plus-info"><summary>Conseils pour ce vol</summary><p class="petit doux">' + esc(v.details) + '</p></details>' : '') + '</div></div></div>';
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
  var ficheOuverte = null;
  var ORDRE_STATUT = { prevu: 0, option: 1, suggestion: 2 };
  function ouvrirFiche(id, garderPosition) {
    var cal = calendrier();
    var x = cal.etapes.filter(function (y) { return y.etape.id === id; })[0];
    if (!x) return;
    var e = x.etape, p = paysDe(e.pays), h = e.hebergement;
    var resas = reservationsTriees().filter(function (r) { return r.etape === id; });
    // Ordre fixe (prévu, option, suggestion) : les lignes ne bougent pas quand on coche
    var acts = (e.activites || []).slice().sort(function (a, b) { return (ORDRE_STATUT[a.statut] || 0) - (ORDRE_STATUT[b.statut] || 0); });

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
    if (h && (h.adresse || h.notes)) html += '<p class="petit">' + esc(h.adresse || '') + (h.notes ? '<br><span class="doux">' + esc(h.notes) + '</span>' : '') +
      (h.adresse ? '<br><a href="' + esc(lienMaps(0, 0, (h.nom || '') + ' ' + h.adresse)) + '" target="_blank" rel="noopener noreferrer">Itinéraire vers l\'hébergement</a>' : '') + '</p>';
    if (e.notes) html += '<p>📝 ' + notes(e.notes) + '</p>';

    if (e.trajet) {
      var t = e.trajet, prec = x.num > 1 ? cal.etapes[x.num - 2].etape.nom : null;
      html += '<h3>Pour venir' + (prec ? ' depuis ' + esc(prec) : '') + '</h3>' +
        '<div class="info"><div class="ligne entre"><span><span aria-hidden="true">' + icones(t) + '</span> <strong>' + esc(nomsModes(t)) + '</strong></span>' + badgeTrajet(t) + '</div>' +
        '<p style="margin:6px 0 0">' + esc(t.resume || '') + '</p>' +
        (t.details ? '<p class="petit doux" style="margin:4px 0 0">' + esc(t.details) + '</p>' : '') +
        (function () {
          var l = x.num > 1 && lienItineraire(cal.etapes[x.num - 2].etape, e);
          return l ? '<p class="petit" style="margin:8px 0 0"><a href="' + esc(l) + '" target="_blank" rel="noopener noreferrer">Voir le trajet dans Maps</a></p>' : '';
        })() + '</div>';
    }
    html += '<details class="plus-info" id="meteo-fiche"' + (meteoOuverte ? ' open' : '') + '><summary>🌤️ Météo sur place (5 jours)</summary><div id="meteo-contenu">' + (meteoOuverte ? blocMeteo(e) : '') + '</div></details>';
    if (meteoOuverte) chargerMeteo(e, majMeteoFiche);

    if (acts.length) {
      html += '<h3>Activités</h3><p class="petit doux" style="margin:-4px 0 4px">Cochez ce que vous voulez faire : les dates et le budget suivent.</p>' +
        '<div class="activites">' + acts.map(function (a) {
        var ch = activiteChoisie(a);
        return '<label class="case' + (ch ? '' : ' act-non') + '"><input type="checkbox" data-act="' + esc(a.id) + '"' + (ch ? ' checked' : '') + '>' +
          '<span class="case-corps"><span class="ligne entre"><span class="nom">' + esc(a.nom) + '</span>' +
          '<span class="badge ' + esc(a.statut) + '">' + esc(STATUTS[a.statut] || a.statut) + '</span></span>' +
          '<span class="desc"><b>' + (a.jours ? '+' + jours(a.jours) : 'Dans la journée') + (a.cout ? ' · ' + fourchette(a.cout) : '') + '</b>' +
          (a.description ? ' · ' + esc(a.description) : '') + '</span></span></label>';
      }).join('') + '</div>';
    }
    if (resas.length) {
      html += '<h3>Réservations</h3>' + resas.map(carteResa).join('');
    }
    html += '<h3><label for="note-etape">Mes notes</label></h3>' +
      '<textarea class="note-etape" id="note-etape" data-note="' + esc(e.id) + '" rows="3" placeholder="Adresses, bons plans, choses à ne pas oublier…">' + esc(notesPerso[e.id] || '') + '</textarea>' +
      '<p class="petit doux" style="margin:4px 0 0">Enregistré automatiquement sur ce téléphone.</p>';
    html += '<div class="boutons"><button class="bouton plein" data-carte="' + esc(e.id) + '">Voir sur la carte</button>' +
      '<a class="bouton" href="' + esc(lienMaps(e.lat, e.lng)) + '" target="_blank" rel="noopener noreferrer">Ouvrir dans Maps</a>' +
      '<a class="bouton" href="#planifier" data-fermer data-plan-ouvrir="' + esc(e.pays) + '">Ajuster la durée</a></div>';

    // Passer d'une étape à l'autre sans refermer la fiche
    var avant = cal.etapes[x.num - 2], apres = cal.etapes[x.num];
    html += '<div class="fiche-nav">' +
      (avant ? '<button class="bouton" data-fiche="' + esc(avant.etape.id) + '"><span aria-hidden="true">‹</span><span class="fiche-nav-nom">' + esc(avant.etape.nom) + '</span></button>' : '<span></span>') +
      (apres ? '<button class="bouton" data-fiche="' + esc(apres.etape.id) + '"><span class="fiche-nav-nom">' + esc(apres.etape.nom) + '</span><span aria-hidden="true">›</span></button>' : '<span></span>') +
      '</div>';

    var d = $('#fiche');
    var position = garderPosition ? d.scrollTop : 0;
    $('#fiche-contenu').innerHTML = html;
    ficheOuverte = id;
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
    d.scrollTop = position;
  }
  function majMeteoFiche() {
    var zone = $('#meteo-contenu');
    var e = ficheOuverte && donnees.etapes.filter(function (y) { return y.id === ficheOuverte; })[0];
    if (zone && e) zone.innerHTML = blocMeteo(e);
  }
  function fermerFiche() {
    ficheOuverte = null;
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

  function copier(texte, message) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texte).then(function () { toast(message || 'Résumé copié'); }, function () { secours(); });
    } else secours();
    function secours() {
      var t = document.createElement('textarea');
      t.value = texte; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); toast(message || 'Résumé copié'); } catch (e) { toast('Copie impossible'); }
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
        return deroulant(esc(c.icone || '💡'), esc(c.titre), esc(c.resume || ''), puces(c.points), '',
          ' data-recherche="' + esc(normaliser([k, c.titre, c.resume].concat(c.points || []).join(' '))) + '"');
      }).join('');
    }).join('') + '<div class="bloc vide" id="aucun-conseil" hidden><p style="font-size:2rem;margin:0">🔍</p><h3>Aucun conseil trouvé</h3><p class="doux">Essayez un autre mot : altitude, argent, frontière…</p></div>';
    filtrerConseils();
  }
  function filtrerConseils() {
    var q = normaliser($('#recherche-conseils').value).trim();
    var mots = q ? q.split(/\s+/) : [];
    var n = 0, titre = null, vus = 0;
    function clore() { if (titre) titre.hidden = !vus; }
    Array.prototype.forEach.call($('#conseils').children, function (el) {
      if (el.classList.contains('categorie')) { clore(); titre = el; vus = 0; return; }
      if (!el.hasAttribute('data-recherche')) return;
      var texte = el.getAttribute('data-recherche');
      var ok = mots.every(function (m) { return texte.indexOf(m) >= 0; });
      el.hidden = !ok;
      if (ok) { n++; vus++; }
    });
    clore();
    var vide = $('#aucun-conseil');
    if (vide) vide.hidden = !q || n > 0;
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
  /* Les prochaines choses à faire : d'abord ce qui se réserve très tôt, puis par date. */
  function prioritesAFaire(n) {
    return listeAFaire().filter(function (a) { return !a.coche && a.categorie !== 'hebergement'; }).sort(function (a, b) {
      return (b.tot ? 1 : 0) - (a.tot ? 1 : 0) || (a.date || 0) - (b.date || 0);
    }).slice(0, n);
  }
  function caseAFaire(a) {
    return '<label class="case' + (a.coche ? ' fait' : '') + '"><input type="checkbox" data-fait="' + esc(a.id) + '"' + (a.coche ? ' checked' : '') + '>' +
      '<span class="case-corps"><b>' + esc(a.titre) + '</b>' + (a.tot ? ' <span class="badge alerte">Très tôt</span>' : '') +
      (a.detail ? '<br><span class="petit doux">' + esc(a.detail) + '</span>' : '') + '</span>' +
      (a.date ? '<span class="duree">' + esc(dCourt(a.date)) + '</span>' : '') + '</label>';
  }
  var CLE_MASQUER = 'voyage-afaire-masquer-v1';
  var masquerFaits = (function () { try { return localStorage.getItem(CLE_MASQUER) === '1'; } catch (e) { return false; } })();

  function rendreAFaire() {
    var l = listeAFaire();
    var nbFaits = l.filter(function (a) { return a.coche; }).length;
    var html = '<div class="bloc"><div class="ligne entre"><b>' + nbFaits + ' sur ' + l.length + ' faits</b><span class="doux petit">Cochez au fur et à mesure</span></div>' +
      '<div class="jauge"><span style="width:' + Math.round(nbFaits / Math.max(1, l.length) * 100) + '%"></span></div>' +
      '<p class="doux petit" style="margin:8px 0 0">Les cases cochées restent sur ce téléphone. Pour les partager avec l\'autre téléphone, dites-moi ce qui est fait et je le note dans le fichier du voyage.</p>' +
      (nbFaits ? '<div class="boutons"><button type="button" class="puce" id="afaire-masquer" aria-pressed="' + masquerFaits + '">Masquer ce qui est fait</button></div>' : '') + '</div>';
    CATS_AFAIRE.forEach(function (c) {
      var items = l.filter(function (a) { return a.categorie === c[0]; }).sort(function (a, b) { return (a.date || 0) - (b.date || 0); });
      if (!items.length) return;
      var n = items.filter(function (a) { return a.coche; }).length;
      var corps = items.filter(function (a) { return !masquerFaits || !a.coche; }).map(caseAFaire).join('') ||
        '<p class="petit doux" style="margin:10px 0 0">Tout est fait dans cette catégorie ✓</p>';
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

  /* ================================================================
     Outils personnels : dépenses, convertisseur, bagages, journal, notes d'étape.
     Tout reste sur ce téléphone (localStorage). « Sauvegarder mes données » en fait une copie.
     ================================================================ */
  var CLES = { depenses: 'voyage-depenses-v1', taux: 'voyage-taux-v1', bagages: 'voyage-bagages-v1', journal: 'voyage-journal-v1', notes: 'voyage-notes-v1' };
  function lire(cle, defaut) {
    try { var v = JSON.parse(localStorage.getItem(cle)); return v == null ? defaut : v; } catch (e) { return defaut; }
  }
  function ecrire(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); } catch (e) { toast('Enregistrement impossible sur ce téléphone'); } }
  function nombre(s) { var n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; }
  var fmtNombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  var fmtEntier = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  function eurosPrecis(n) { return (Math.abs(n) >= 100 ? fmtEntier.format(n) : fmtNombre.format(Math.round(n * 100) / 100)) + ' €'; }
  function isoAuj() { return versIso(aujourdhui()); }

  /* Section du voyage (pays) et étape correspondant à une date */
  function situer(ms, cal) {
    if (ms < cal.debut) return { id: 'avant', nom: 'Avant le départ' };
    for (var i = 0; i < cal.etapes.length; i++) {
      var x = cal.etapes[i];
      if (ms < (x.finMarge || x.depart)) return { id: x.etape.pays, nom: paysDe(x.etape.pays).nom, etape: x, jour: Math.round((ms - cal.debut) / JOUR) + 1 };
    }
    return { id: 'apres', nom: 'Après le retour' };
  }

  /* ---------- Devises ---------- */
  /* Taux de secours, très approximatifs : remplacés par les taux du jour dès qu'il y a du réseau,
     ou par le taux saisi à la main (utile en Argentine et en Bolivie, où le taux réel diffère souvent). */
  var DEVISES = {
    ARS: { nom: 'Peso argentin', court: 'pesos argentins', secours: 1600 },
    CLP: { nom: 'Peso chilien', court: 'pesos chiliens', secours: 1050 },
    BOB: { nom: 'Boliviano', court: 'bolivianos', secours: 8 },
    PEN: { nom: 'Sol péruvien', court: 'soles', secours: 4 },
    USD: { nom: 'Dollar américain', court: 'dollars', secours: 1.1 }
  };
  var SOURCE_TAUX = 'https://open.er-api.com/v6/latest/EUR';
  var taux = lire(CLES.taux, { auto: {}, date: null, manuel: {}, devise: 'ARS' });
  function tauxDe(code) {
    if (code === 'EUR') return 1;
    return taux.manuel[code] || taux.auto[code] || DEVISES[code].secours;
  }
  function origineTaux(code) {
    if (taux.manuel[code]) return 'taux saisi par vous';
    if (taux.auto[code] && taux.date) return 'taux du ' + dCourt(versDate(taux.date));
    return 'taux approximatif, pas encore mis à jour';
  }
  var majTauxEnCours = false;
  function majTaux(force) {
    if (majTauxEnCours || !navigator.onLine) { if (force && !navigator.onLine) toast('Pas de réseau : taux inchangés'); return; }
    if (!force && taux.date === versIso(Date.now())) return;
    majTauxEnCours = true;
    fetch(SOURCE_TAUX).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (d) {
      if (!d || !d.rates) throw new Error();
      Object.keys(DEVISES).forEach(function (k) { if (typeof d.rates[k] === 'number' && d.rates[k] > 0) taux.auto[k] = d.rates[k]; });
      taux.date = versIso(Date.now());
      ecrire(CLES.taux, taux);
      if (force) toast('Taux mis à jour ✓');
      if (vueCourante() === 'devises') rendreDevises();
    }).catch(function () { if (force) toast('Mise à jour des taux impossible'); }).then(function () { majTauxEnCours = false; });
  }

  function rendreDevises() {
    var code = DEVISES[taux.devise] ? taux.devise : 'ARS', d = DEVISES[code], t = tauxDe(code);
    var html = '<div class="defile" role="group" aria-label="Monnaie">' + Object.keys(DEVISES).map(function (k) {
      return '<button type="button" class="puce" data-devise="' + k + '" aria-pressed="' + (k === code) + '">' + esc(DEVISES[k].nom) + '</button>';
    }).join('') + '</div>';
    html += '<div class="bloc"><label class="champ">Montant en ' + esc(d.court) + ' (' + code + ')' +
      '<input type="text" inputmode="decimal" id="conv-local" autocomplete="off" placeholder="0"></label>' +
      '<p class="conv-egal" aria-hidden="true">=</p>' +
      '<label class="champ">Montant en euros<input type="text" inputmode="decimal" id="conv-eur" autocomplete="off" placeholder="0"></label>' +
      '<p class="petit doux" style="margin:12px 0 0">1 € = <b>' + fmtNombre.format(t) + ' ' + code + '</b> · ' + esc(origineTaux(code)) + '</p></div>';

    // Repères : montants ronds dans la monnaie locale
    var ordre = Math.pow(10, Math.round(Math.log(t) / Math.LN10));
    html += '<div class="bloc"><p class="surtitre">Repères</p><div class="reperes">' + [1, 2, 5, 10, 20, 50, 100, 200].map(function (m) {
      var v = m * ordre;
      return '<span>' + fmtNombre.format(v) + ' ' + code + '</span><b>' + eurosPrecis(v / t) + '</b>';
    }).join('') + '</div></div>';

    html += '<div class="bloc"><p class="surtitre">Taux</p>' +
      '<label class="champ">Taux obtenu sur place (' + code + ' pour 1 €)' +
      '<input type="text" inputmode="decimal" id="taux-manuel" autocomplete="off" placeholder="Laisser vide pour le taux automatique" value="' + (taux.manuel[code] ? esc(fmtNombre.format(taux.manuel[code]).replace(/\s/g, '')) : '') + '"></label>' +
      '<p class="petit doux" style="margin:8px 0 0">À remplir si le taux que vous obtenez vraiment (bureau de change, retrait) est différent du taux officiel. Il sert aussi pour vos dépenses.</p>' +
      '<div class="boutons"><button type="button" class="bouton" id="taux-maj">Mettre à jour les taux</button></div>' +
      '<p class="petit doux" style="margin:8px 0 0">Les taux se mettent à jour tout seuls quand il y a du réseau, et restent disponibles hors ligne.</p></div>';
    $('#devises').innerHTML = html;
  }

  /* ---------- Dépenses réelles ---------- */
  var CATS_DEPENSE = [['hebergement', '🛏️', 'Hébergement'], ['repas', '🍽️', 'Repas'], ['transport', '🚌', 'Transport'], ['activite', '🎟️', 'Activités'], ['autre', '🛍️', 'Autre']];
  var depenses = lire(CLES.depenses, []);
  var dernierChoix = { devise: 'EUR', cat: 'repas' };
  function catDepense(id) { return CATS_DEPENSE.filter(function (c) { return c[0] === id; })[0] || CATS_DEPENSE[4]; }

  function rendreDepenses() {
    var cal = calendrier(), auj = aujourdhui();
    var nb = (donnees.budget && donnees.budget.personnes) || 1;
    var total = depenses.reduce(function (s, d) { return s + d.eur; }, 0);
    var html = '<div class="bloc bloc-heros"><p class="surtitre">Dépensé jusqu\'ici</p>' +
      '<p class="grand-chiffre" style="font-size:2.2rem">' + eurosPrecis(total) + '</p>' +
      (nb > 1 ? '<p class="doux" style="margin:8px 0 0">Soit <b style="color:#fff">' + eurosPrecis(total / nb) + '</b> par personne</p>' : '') + '</div>';

    // Saisie
    var ici = situer(auj, cal);
    if (dernierChoix.devise === 'EUR' && !depenses.length && taux.devise && ici.etape) dernierChoix.devise = taux.devise;
    html += '<form class="bloc" id="form-depense" novalidate><p class="surtitre">Ajouter une dépense</p>' +
      '<div class="rangee"><label class="champ" style="flex:2">Montant<input type="text" inputmode="decimal" name="montant" autocomplete="off" placeholder="0" required></label>' +
      '<label class="champ" style="flex:1">Monnaie<select name="devise">' + ['EUR'].concat(Object.keys(DEVISES)).map(function (k) {
        return '<option value="' + k + '"' + (k === dernierChoix.devise ? ' selected' : '') + '>' + k + '</option>';
      }).join('') + '</select></label></div>' +
      '<div class="choix" role="radiogroup" aria-label="Catégorie">' + CATS_DEPENSE.map(function (c) {
        return '<label><input type="radio" name="cat" value="' + c[0] + '"' + (c[0] === dernierChoix.cat ? ' checked' : '') + '><span>' + c[1] + ' ' + esc(c[2]) + '</span></label>';
      }).join('') + '</div>' +
      '<div class="rangee"><label class="champ" style="flex:1">Date<input type="date" name="date" value="' + esc(isoAuj()) + '"></label></div>' +
      '<label class="champ">Note (facultatif)<input type="text" name="note" autocomplete="off" maxlength="80" placeholder="Restaurant, bus pour…"></label>' +
      '<p class="petit doux" style="margin:10px 0 0">Notez le montant payé pour vous ' + (nb > 1 ? nb : '') + ' : l\'appli calcule la part par personne.</p>' +
      '<div class="boutons"><button type="submit" class="bouton plein">Ajouter</button></div></form>';

    if (!depenses.length) {
      html += '<div class="bloc vide"><p style="font-size:2rem;margin:0">🧾</p><h3>Aucune dépense notée</h3><p class="doux">Notez vos dépenses au fur et à mesure pour les comparer au budget prévu.</p></div>';
      $('#depenses').innerHTML = html;
      return;
    }

    // Par section : dépensé, moyenne par jour et par personne, comparée au budget quotidien prévu
    var parSection = {}, ordreSections = [];
    depenses.forEach(function (d) {
      var s = situer(versDate(d.date), cal);
      if (!parSection[s.id]) { parSection[s.id] = { nom: s.nom, total: 0 }; ordreSections.push(s.id); }
      parSection[s.id].total += d.eur;
    });
    var bilans = bilanPays(cal), parJour = (donnees.budget && donnees.budget.parJour) || {};
    html += '<div class="bloc"><p class="surtitre">Par section</p>' + ['avant'].concat(donnees.pays.map(function (p) { return p.id; }), ['apres']).filter(function (id) { return parSection[id]; }).map(function (id) {
      var s = parSection[id], b = bilans.filter(function (y) { return y.pays.id === id; })[0], pj = parJour[id], ligne = '';
      if (b && b.debut != null) {
        var ecoules = Math.max(1, Math.min(b.total, Math.round((Math.min(auj + JOUR, b.fin) - b.debut) / JOUR)));
        var moyenne = s.total / nb / ecoules;
        ligne = '<p class="petit doux" style="margin:2px 0 0">' + eurosPrecis(moyenne) + ' par jour et par personne sur ' + jours(ecoules) +
          (pj ? ' · prévu ' + pj[0] + ' à ' + pj[1] + ' € (hors excursions et grands trajets)' : '') + '</p>';
        if (pj) ligne += '<div class="jauge' + (moyenne > pj[1] ? ' depasse' : '') + '"><span style="width:' + Math.min(100, Math.round(moyenne / pj[1] * 100)) + '%"></span></div>';
      }
      return '<div style="margin-top:12px"><div class="ligne entre"><b>' + esc(s.nom) + '</b><b>' + eurosPrecis(s.total) + '</b></div>' + ligne + '</div>';
    }).join('') + '</div>';

    // Par catégorie
    html += '<div class="bloc"><p class="surtitre">Par catégorie</p>' + CATS_DEPENSE.map(function (c) {
      var t = depenses.filter(function (d) { return catDepense(d.cat)[0] === c[0]; }).reduce(function (s, d) { return s + d.eur; }, 0);
      if (!t) return '';
      return '<div style="margin-top:10px"><div class="ligne entre"><span>' + c[1] + ' <b>' + esc(c[2]) + '</b></span><span class="petit">' + eurosPrecis(t) + ' · ' + Math.round(t / total * 100) + ' %</span></div>' +
        '<div class="jauge"><span style="width:' + Math.round(t / total * 100) + '%;background:var(--accent)"></span></div></div>';
    }).join('') + '</div>';

    // Liste, la plus récente en premier
    var liste = depenses.slice().sort(function (a, b) { return b.date.localeCompare(a.date) || b.id - a.id; });
    var jourCourant = null;
    html += '<div class="bloc"><div class="ligne entre"><p class="surtitre">Toutes les dépenses (' + liste.length + ')</p><button type="button" class="puce" id="depenses-copier">Copier</button></div>' +
      liste.map(function (d) {
        var c = catDepense(d.cat), tete = '';
        if (d.date !== jourCourant) { jourCourant = d.date; tete = '<p class="jour-liste">' + esc(dJour(versDate(d.date))) + '</p>'; }
        return tete + '<div class="ligne-depense"><span class="resa-type" aria-hidden="true">' + c[1] + '</span>' +
          '<span class="case-corps"><b>' + esc(d.note || c[2]) + '</b>' + (d.devise !== 'EUR' ? '<br><span class="petit doux">' + fmtNombre.format(d.montant) + ' ' + esc(d.devise) + '</span>' : '') + '</span>' +
          '<b style="white-space:nowrap">' + eurosPrecis(d.eur) + '</b>' +
          '<button type="button" class="suppr" data-suppr-depense="' + d.id + '" aria-label="Supprimer : ' + esc(d.note || c[2]) + '">×</button></div>';
      }).join('') + '</div>';
    $('#depenses').innerHTML = html;
  }
  function ajouterDepense(f) {
    var m = nombre(f.montant.value);
    if (!m || m <= 0) { toast('Indiquez un montant'); f.montant.focus(); return; }
    var devise = f.devise.value, cat = f.cat.value || 'autre';
    depenses.push({ id: Date.now(), date: f.date.value || isoAuj(), montant: m, devise: devise, eur: m / tauxDe(devise), cat: cat, note: f.note.value.trim() });
    dernierChoix = { devise: devise, cat: cat };
    ecrire(CLES.depenses, depenses);
    rendreDepenses();
    toast('Dépense ajoutée ✓');
  }
  function texteDepenses() {
    return ['Date;Catégorie;Note;Montant;Monnaie;Euros'].concat(depenses.slice().sort(function (a, b) { return a.date.localeCompare(b.date) || a.id - b.id; }).map(function (d) {
      return [d.date, catDepense(d.cat)[2], (d.note || '').replace(/;/g, ','), String(d.montant).replace('.', ','), d.devise, (Math.round(d.eur * 100) / 100).toFixed(2).replace('.', ',')].join(';');
    })).join('\n');
  }

  /* ---------- Bagages ---------- */
  var bagages = lire(CLES.bagages, { coches: {}, perso: [] });
  function listeBagages() {
    var cats = (donnees.bagages || []).map(function (c) {
      return { id: c.id, icone: c.icone, titre: c.titre, items: (c.items || []).map(function (i) { return { id: i.id, nom: i.nom, detail: i.detail }; }) };
    });
    bagages.perso.forEach(function (p) {
      var c = cats.filter(function (x) { return x.id === p.cat; })[0] || cats.filter(function (x) { return x.id === 'perso'; })[0];
      if (!c) { c = { id: 'perso', icone: '➕', titre: 'Mes ajouts', items: [] }; cats.push(c); }
      c.items.push({ id: p.id, nom: p.nom, perso: true });
    });
    return cats;
  }
  var bagagesOuverts = {};
  function rendreBagages() {
    var cats = listeBagages();
    var tous = cats.reduce(function (l, c) { return l.concat(c.items); }, []);
    var n = tous.filter(function (i) { return bagages.coches[i.id]; }).length;
    var html = '<div class="bloc"><div class="ligne entre"><b>' + n + ' sur ' + tous.length + ' dans le sac</b>' +
      (n ? '<button type="button" class="puce" id="bagages-vider">Tout décocher</button>' : '') + '</div>' +
      '<div class="jauge"><span style="width:' + Math.round(n / Math.max(1, tous.length) * 100) + '%"></span></div>' +
      '<p class="doux petit" style="margin:8px 0 0">La liste resservira à chaque fois que vous refaites le sac : « Tout décocher » la remet à zéro.</p></div>';
    cats.forEach(function (c) {
      var k = c.items.filter(function (i) { return bagages.coches[i.id]; }).length;
      var corps = c.items.map(function (i) {
        return '<label class="case' + (bagages.coches[i.id] ? ' fait' : '') + '"><input type="checkbox" data-bagage="' + esc(i.id) + '"' + (bagages.coches[i.id] ? ' checked' : '') + '>' +
          '<span class="case-corps"><b>' + esc(i.nom) + '</b>' + (i.detail ? '<br><span class="petit doux">' + esc(i.detail) + '</span>' : '') + '</span>' +
          (i.perso ? '<button type="button" class="suppr" data-suppr-bagage="' + esc(i.id) + '" aria-label="Retirer ' + esc(i.nom) + ' de la liste">×</button>' : '') + '</label>';
      }).join('');
      html += deroulant(esc(c.icone || '🎒'), esc(c.titre), k + ' sur ' + c.items.length, corps,
        '<span class="badge ' + (k === c.items.length ? 'ok' : 'a-decider') + '">' + k + '/' + c.items.length + '</span>',
        ' data-bagages-cat="' + esc(c.id) + '"' + (bagagesOuverts[c.id] ? ' open' : ''));
    });
    html += '<form class="bloc" id="form-bagage" novalidate><p class="surtitre">Ajouter un objet</p>' +
      '<div class="rangee"><label class="champ" style="flex:2">Objet<input type="text" name="nom" autocomplete="off" maxlength="60" placeholder="Jumelles, carnet…"></label>' +
      '<label class="champ" style="flex:1.4">Catégorie<select name="cat">' + (donnees.bagages || []).map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.titre) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="boutons"><button type="submit" class="bouton plein">Ajouter</button></div></form>';
    $('#bagages').innerHTML = html;
  }

  /* ---------- Journal de bord ---------- */
  var HUMEURS = [['5', '😍', 'Génial'], ['4', '🙂', 'Bien'], ['3', '😐', 'Moyen'], ['2', '😕', 'Difficile'], ['1', '😫', 'Très dur']];
  var journal = lire(CLES.journal, {});
  var dateJournal = null;
  function humeur(v) { return HUMEURS.filter(function (h) { return h[0] === String(v); })[0]; }
  function rendreJournal() {
    var cal = calendrier();
    var date = dateJournal || isoAuj(), e = journal[date] || {};
    var s = situer(versDate(date), cal);
    var html = '<form class="bloc" id="form-journal" novalidate><p class="surtitre">' + (journal[date] ? 'Modifier la page' : 'Écrire la page du jour') + '</p>' +
      '<label class="champ">Jour<input type="date" name="date" id="journal-date" value="' + esc(date) + '"></label>' +
      '<p class="petit doux" style="margin:6px 0 0">' + esc(dLong(versDate(date))) + (s.etape ? ' · jour ' + s.jour + ' · ' + esc(s.etape.etape.nom) : '') + '</p>' +
      '<div class="choix humeurs" role="radiogroup" aria-label="Humeur du jour">' + HUMEURS.map(function (h) {
        return '<label><input type="radio" name="humeur" value="' + h[0] + '"' + (String(e.humeur) === h[0] ? ' checked' : '') + '><span title="' + esc(h[2]) + '"><span aria-hidden="true">' + h[1] + '</span><span class="sr-only">' + esc(h[2]) + '</span></span></label>';
      }).join('') + '</div>' +
      '<label class="champ">Ce qu\'on a fait, vu, mangé…<textarea name="texte" rows="5" placeholder="Quelques lignes suffisent.">' + esc(e.texte || '') + '</textarea></label>' +
      '<div class="boutons"><button type="submit" class="bouton plein">Enregistrer</button></div></form>';

    var dates = Object.keys(journal).sort().reverse();
    if (!dates.length) {
      html += '<div class="bloc vide"><p style="font-size:2rem;margin:0">📓</p><h3>Le journal est vide</h3><p class="doux">Une note par jour, même courte : dans cinq mois, ce sera le meilleur souvenir du voyage.</p></div>';
    } else {
      html += '<div class="ligne entre" style="margin:18px 4px 8px"><h3 class="categorie" style="margin:0">' + pluriel(dates.length, 'page') + '</h3><button type="button" class="puce" id="journal-copier">Copier tout</button></div>' +
        dates.map(function (d) {
          var j = journal[d], h = humeur(j.humeur), x = situer(versDate(d), cal);
          return '<div class="bloc page-journal"><div class="ligne entre"><p class="surtitre">' + esc(dJour(versDate(d))) + (x.etape ? ' · J' + x.jour + ' · ' + esc(x.etape.etape.nom) : '') + '</p>' +
            (h ? '<span class="humeur" title="' + esc(h[2]) + '">' + h[1] + '</span>' : '') + '</div>' +
            (j.texte ? '<p class="texte-journal">' + esc(j.texte) + '</p>' : '') +
            '<div class="boutons"><button type="button" class="puce" data-journal-modifier="' + esc(d) + '">Modifier</button>' +
            '<button type="button" class="puce" data-journal-supprimer="' + esc(d) + '">Supprimer</button></div></div>';
        }).join('');
    }
    $('#journal').innerHTML = html;
  }
  function texteJournal() {
    var cal = calendrier();
    return Object.keys(journal).sort().map(function (d) {
      var j = journal[d], h = humeur(j.humeur), x = situer(versDate(d), cal);
      return dLong(versDate(d)) + (x.etape ? ' · jour ' + x.jour + ' · ' + x.etape.etape.nom : '') + (h ? ' ' + h[1] : '') + '\n' + (j.texte || '');
    }).join('\n\n');
  }

  /* ---------- Notes personnelles par étape ---------- */
  var notesPerso = lire(CLES.notes, {});

  /* ---------- Export vers l'agenda (.ics) ---------- */
  function telecharger(nom, contenu, type) {
    var url = URL.createObjectURL(new Blob([contenu], { type: type }));
    var a = document.createElement('a');
    a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function exporterAgenda() {
    var cal = calendrier();
    function jourIcs(ms) { return versIso(ms).replace(/-/g, ''); }
    function texte(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
    function plier(l) { var r = []; while (l.length > 60) { r.push(l.slice(0, 60)); l = ' ' + l.slice(60); } r.push(l); return r.join('\r\n'); }
    var tampon = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    var lignes = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Voyage Amerique du Sud//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + texte(donnees.voyage.titre)];
    function evenement(uid, debut, fin, titre, description, lieu) {
      lignes.push('BEGIN:VEVENT', 'UID:' + uid + '@voyage-amerique-du-sud', 'DTSTAMP:' + tampon, debut, fin, 'SUMMARY:' + texte(titre));
      if (description) lignes.push('DESCRIPTION:' + texte(description));
      if (lieu) lignes.push('LOCATION:' + texte(lieu));
      lignes.push('TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    function journee(uid, debut, fin, titre, description, lieu) {
      evenement(uid, 'DTSTART;VALUE=DATE:' + jourIcs(debut), 'DTEND;VALUE=DATE:' + jourIcs(Math.max(fin, debut + JOUR)), titre, description, lieu);
    }
    ['aller', 'retour'].forEach(function (k) {
      var v = (donnees.vols || {})[k];
      if (v) journee('vol-' + k, dateVol(k, cal), dateVol(k, cal) + JOUR, '✈️ ' + v.titre, [v.duree, v.details].filter(Boolean).join('\n'));
    });
    cal.etapes.forEach(function (x) {
      var e = x.etape, h = e.hebergement, t = e.trajet;
      journee('etape-' + e.id, x.arrivee, x.depart, x.num + '. ' + e.nom,
        [t && t.resume ? 'Pour venir : ' + t.resume : '', h && h.nom ? 'Hébergement : ' + h.nom : '', x.activites.length ? 'Activités : ' + x.activites.map(function (a) { return a.nom; }).join(', ') : '', e.notes, notesPerso[e.id]].filter(Boolean).join('\n'),
        (h && h.adresse) || e.nom);
      if (x.marge) journee('marge-' + e.id, x.depart, x.finMarge, '⏳ Marge ' + paysDe(e.pays).nom, 'Météo, repos, imprévus');
    });
    reservationsTriees().forEach(function (r, i) {
      var titre = (TYPES[r.type] || TYPES.autre).ico + ' ' + r.titre, d = versDate(r.date);
      var desc = [r.compagnie, r.notes, lienDriveSur(r.lienDrive) ? r.lienDrive : ''].filter(Boolean).join('\n');
      if (/^\d{2}:\d{2}$/.test(r.heure || '')) {
        // Heure locale du lieu, sans fuseau : l'agenda l'affiche telle quelle
        var hh = r.heure.replace(':', ''), fin = ('0' + Math.min(23, +hh.slice(0, 2) + 1)).slice(-2) + hh.slice(2);
        evenement('resa-' + i + '-' + r.date, 'DTSTART:' + jourIcs(d) + 'T' + hh + '00', 'DTEND:' + jourIcs(d) + 'T' + fin + '00', titre, desc, r.lieu);
      } else journee('resa-' + i + '-' + r.date, d, d + JOUR, titre, desc, r.lieu);
    });
    lignes.push('END:VCALENDAR');
    telecharger('voyage-amerique-du-sud.ics', lignes.map(plier).join('\r\n') + '\r\n', 'text/calendar;charset=utf-8');
    toast('Fichier agenda créé');
  }

  /* ---------- Sauvegarde et restauration des données du téléphone ---------- */
  function sauvegarder() {
    var copie = {};
    try {
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf('voyage-') === 0) copie[k] = localStorage.getItem(k); }
    } catch (e) { toast('Sauvegarde impossible'); return; }
    telecharger('voyage-sauvegarde-' + versIso(Date.now()) + '.json', JSON.stringify({ appli: 'voyage-amerique-du-sud', date: new Date().toISOString(), donnees: copie }, null, 1), 'application/json');
    toast('Sauvegarde créée');
  }
  function restaurer(fichier) {
    var lecteur = new FileReader();
    lecteur.onload = function () {
      var s;
      try { s = JSON.parse(lecteur.result); } catch (e) { s = null; }
      if (!s || s.appli !== 'voyage-amerique-du-sud' || !s.donnees) { toast('Ce fichier n\'est pas une sauvegarde de l\'appli'); return; }
      if (!confirm('Remplacer les données de ce téléphone (cases cochées, dépenses, journal, notes) par celles de la sauvegarde du ' + dCourt(Date.parse(s.date)) + ' ?')) return;
      try {
        Object.keys(s.donnees).forEach(function (k) { if (k.indexOf('voyage-') === 0 && typeof s.donnees[k] === 'string') localStorage.setItem(k, s.donnees[k]); });
      } catch (e) { toast('Restauration impossible'); return; }
      location.reload();
    };
    lecteur.readAsText(fichier);
  }

  /* ---------- Le voyage en chiffres ---------- */
  function rendreBilan() {
    var cal = calendrier(), auj = aujourdhui(), E = cal.etapes;
    var enVoyage = auj >= cal.debut, fini = auj >= cal.fin;
    var km = 0, kmFaits = 0, parMode = {}, nbTrajets = {};
    E.forEach(function (x, i) {
      if (i === 0) return;
      var d = distanceKm(E[i - 1].etape, x.etape), mode = ((x.etape.trajet && x.etape.trajet.modes) || ['autre'])[0];
      km += d; parMode[mode] = (parMode[mode] || 0) + d; nbTrajets[mode] = (nbTrajets[mode] || 0) + 1;
      if (auj >= x.arrivee) kmFaits += d;
    });
    var vols = donnees.vols || {}, kmVols = 0;
    ['aller', 'retour'].forEach(function (k) { var pts = (vols[k] || {}).points || []; for (var i = 1; i < pts.length; i++) kmVols += distanceKm(pts[i - 1], pts[i]); });
    var haut = E.slice().sort(function (a, b) { return (b.etape.altitude || 0) - (a.etape.altitude || 0); })[0];
    var sud = E.slice().sort(function (a, b) { return a.etape.lat - b.etape.lat; })[0], nord = E.slice().sort(function (a, b) { return b.etape.lat - a.etape.lat; })[0];
    var longue = E.slice().sort(function (a, b) { return b.total - a.total; })[0];
    var nbActs = E.reduce(function (s, x) { return s + x.activites.length; }, 0);
    var etapesFaites = E.filter(function (x) { return auj >= x.arrivee; }).length;
    var joursTotal = Math.round((cal.fin - cal.debut) / JOUR), joursFaits = Math.max(0, Math.min(joursTotal, Math.round((auj - cal.debut) / JOUR) + 1));
    function rond(n) { return fmtEntier.format(Math.round(n / 10) * 10); }
    function tuile(ico, chiffre, texte) { return '<div class="tuile"><span class="ico" aria-hidden="true">' + ico + '</span><b>' + chiffre + '</b><span class="petit doux">' + texte + '</span></div>'; }

    var html = '<div class="bloc bloc-heros"><p class="surtitre">' + (fini ? 'Le voyage en chiffres' : (enVoyage ? 'Jusqu\'ici' : 'Ce qui vous attend')) + '</p>' +
      '<p class="grand-chiffre" style="font-size:2.2rem">' + rond(enVoyage && !fini ? kmFaits : km) + ' km</p>' +
      '<p class="doux" style="margin:8px 0 0">' + (enVoyage && !fini ? 'parcourus sur ' + rond(km) + ' km prévus · jour ' + joursFaits + ' sur ' + joursTotal
        : 'entre les étapes, à vol d\'oiseau · ' + jours(joursTotal)) + '</p>' +
      (enVoyage && !fini ? '<div class="progression"><span style="width:' + Math.round(kmFaits / Math.max(1, km) * 100) + '%"></span></div>' : '') + '</div>';

    html += '<div class="tuiles">' +
      tuile('📍', (enVoyage && !fini ? etapesFaites + ' / ' : '') + E.length, 'étapes') +
      tuile('🗓️', (enVoyage && !fini ? joursFaits + ' / ' : '') + joursTotal, 'jours de voyage') +
      tuile('🎟️', nbActs, 'activités prévues') +
      tuile('⛰️', (haut.etape.altitude || 0).toLocaleString('fr-FR') + ' m', 'point le plus haut : ' + esc(haut.etape.nom)) +
      tuile('🧭', Math.abs(sud.etape.lat).toFixed(1).replace('.', ',') + '° S', 'le plus au sud : ' + esc(sud.etape.nom)) +
      tuile('🌎', rond(distanceKm(sud.etape, nord.etape)) + ' km', 'du sud au nord : ' + esc(sud.etape.nom) + ' → ' + esc(nord.etape.nom)) +
      tuile('🛋️', jours(longue.total), 'la plus longue étape : ' + esc(longue.etape.nom)) +
      (kmVols ? tuile('✈️', rond(kmVols) + ' km', 'en vols depuis et vers la France') : '') + '</div>';

    // Transports
    html += '<div class="bloc"><p class="surtitre">Sur la route</p>' + Object.keys(parMode).sort(function (a, b) { return parMode[b] - parMode[a]; }).map(function (m) {
      var M = MODES[m] || { ico: '📍', nom: 'Autre' };
      return '<div style="margin-top:10px"><div class="ligne entre"><span>' + M.ico + ' <b>' + esc(M.nom) + '</b> <span class="doux petit">· ' + pluriel(nbTrajets[m], 'trajet') + '</span></span><span class="petit">' + rond(parMode[m]) + ' km</span></div>' +
        '<div class="jauge"><span style="width:' + Math.round(parMode[m] / km * 100) + '%;background:var(--accent)"></span></div></div>';
    }).join('') + '<p class="petit doux" style="margin:12px 0 0">Distances en ligne droite entre les étapes : les routes réelles sont plus longues.</p></div>';

    // Argent
    var b = calculBudget(), nb = b.personnes, depense = depenses.reduce(function (s, d) { return s + d.eur; }, 0);
    html += '<div class="bloc"><p class="surtitre">Argent</p>' +
      '<div class="ligne entre" style="margin-top:8px"><span>Budget prévu par personne</span><b>' + euros(b.total[0]) + ' à ' + euros(b.total[1]) + '</b></div>' +
      '<div class="ligne entre" style="margin-top:8px"><span>Dépensé par personne</span><b>' + (depenses.length ? eurosPrecis(depense / nb) : 'rien de noté') + '</b></div>' +
      (depenses.length ? '<div class="jauge' + (depense / nb > b.total[1] ? ' depasse' : '') + '"><span style="width:' + Math.min(100, Math.round(depense / nb / b.total[1] * 100)) + '%"></span></div>' +
        (function () {
          var g = depenses.slice().sort(function (x, y) { return y.eur - x.eur; })[0];
          return '<p class="petit doux" style="margin:10px 0 0">Plus grosse dépense : ' + esc(g.note || catDepense(g.cat)[2]) + ', ' + eurosPrecis(g.eur) + ' le ' + esc(dCourt(versDate(g.date))) + '.</p>';
        })() : '') + '</div>';

    // Journal
    var pages = Object.keys(journal).sort();
    if (pages.length) {
      var notees = pages.filter(function (d) { return journal[d].humeur; });
      var moyenne = notees.length ? notees.reduce(function (s, d) { return s + (+journal[d].humeur); }, 0) / notees.length : 0;
      var top = notees.filter(function (d) { return String(journal[d].humeur) === '5'; }).slice(-5).reverse();
      html += '<div class="bloc"><p class="surtitre">Journal de bord</p>' +
        '<p style="margin:6px 0 0"><b>' + pluriel(pages.length, 'page') + '</b> écrite' + (pages.length > 1 ? 's' : '') +
        (moyenne ? ' · humeur moyenne ' + (humeur(Math.round(moyenne)) || [0, ''])[1] : '') + '</p>' +
        (top.length ? '<p class="surtitre" style="margin-top:14px">Les meilleures journées</p>' + top.map(function (d) {
          var x = situer(versDate(d), cal), t = journal[d].texte || '';
          return '<p class="petit" style="margin:6px 0 0">😍 <b>' + esc(dCourt(versDate(d))) + (x.etape ? ' · ' + esc(x.etape.etape.nom) : '') + '</b>' +
            (t ? '<br><span class="doux">' + esc(t.length > 120 ? t.slice(0, 120) + '…' : t) + '</span>' : '') + '</p>';
        }).join('') : '') + '</div>';
    }
    $('#bilan').innerHTML = html;
  }

  /* ---------- Menu « Plus » ---------- */
  function rendrePlus() {
    var l = listeAFaire();
    var nbFaits = l.filter(function (a) { return a.coche; }).length;
    var aD = nbPropositionsADecider();
    var sac = listeBagages().reduce(function (t, c) { return t.concat(c.items); }, []);
    var nbSac = sac.filter(function (i) { return bagages.coches[i.id]; }).length;
    var totalDepense = depenses.reduce(function (s, d) { return s + d.eur; }, 0);
    var nbPages = Object.keys(journal).length;
    var groupes = [
      ['Préparer', [
        ['#afaire', '✅', 'À faire', nbFaits + ' sur ' + l.length + ' faits : réservations, billets, locations…'],
        ['#bagages', '🎒', 'Bagages', nbSac + ' sur ' + sac.length + ' dans le sac'],
        ['#propositions', '💡', 'Propositions', aD ? pluriel(aD, 'idée') + ' à décider' : 'Tout est décidé'],
        ['#conseils', '🧭', 'Conseils', pluriel((donnees.conseils || []).length, 'fiche') + ' : santé, argent, équipement…']
      ]],
      ['Argent', [
        ['#budget', '💶', 'Budget prévu', (function () { var b = calculBudget(); return euros(b.total[0]) + ' à ' + euros(b.total[1]) + ' par personne'; })()],
        ['#depenses', '🧾', 'Dépenses réelles', depenses.length ? eurosPrecis(totalDepense) + ' · ' + pluriel(depenses.length, 'dépense') : 'À noter au fur et à mesure'],
        ['#devises', '💱', 'Convertisseur', 'Pesos, bolivianos, soles ↔ euros, même hors ligne']
      ]],
      ['Pendant le voyage', [
        ['#resas', '🎫', 'Réservations', (donnees.reservations || []).length ? pluriel(donnees.reservations.length, 'réservation') : 'Aucune pour l\'instant'],
        ['#journal', '📓', 'Journal de bord', nbPages ? pluriel(nbPages, 'page') : 'Une note et une humeur par jour'],
        ['#bilan', '🏆', 'Le voyage en chiffres', 'Kilomètres, altitude, transports, budget, meilleures journées']
      ]]
    ];
    function bouton(id, ico, titre, sous) {
      return '<button type="button" id="' + id + '"><span class="ico" aria-hidden="true">' + ico + '</span><span><b>' + esc(titre) + '</b><span class="petit doux">' + esc(sous) + '</span></span></button>';
    }
    $('#menu-plus').innerHTML = groupes.map(function (g) {
      return '<h3 class="categorie">' + esc(g[0]) + '</h3>' + g[1].map(function (i) {
        return '<a href="' + i[0] + '"><span class="ico" aria-hidden="true">' + i[1] + '</span><span><b>' + esc(i[2]) + '</b><span class="petit doux">' + esc(i[3]) + '</span></span><span class="chevron" aria-hidden="true">›</span></a>';
      }).join('');
    }).join('') +
      '<h3 class="categorie">Outils</h3>' +
      bouton('agenda', '📅', 'Ajouter à l\'agenda', 'Fichier avec les étapes, les vols et les réservations') +
      bouton('partager', '📲', 'Partager l\'appli', 'Envoyer le lien pour l\'installer sur un autre téléphone') +
      bouton('sauvegarder', '💾', 'Sauvegarder mes données', 'Cases cochées, dépenses, journal, notes : une copie en fichier') +
      '<label class="bouton-menu"><span class="ico" aria-hidden="true">♻️</span><span><b>Restaurer une sauvegarde</b><span class="petit doux">Reprendre les données d\'un fichier de sauvegarde</span></span>' +
      '<input type="file" id="restaurer" accept="application/json,.json" class="sr-only"></label>';
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

    // Pastilles d'icônes (bus, avion, voiture…) au milieu des trajets, au-dessus des lignes mais sous les étapes
    carte.createPane('icones-trajets').style.zIndex = 550;

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
      var popupTrajet = '<b>' + icones(t) + ' ' + esc(a.nom) + ' → ' + esc(b.nom) + '</b><br>' + esc(t.resume || 'Trajet à définir') +
        '<br><span>' + esc(STATUTS_TRAJET[t.statut] || '') + '</span>';
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#000', weight: 22, opacity: 0 }).bindPopup(popupTrajet).addTo(carte);
      // Pastille avec l'icône du moyen de transport, au milieu du trajet
      if ((t.modes || []).length && (a.lat !== b.lat || a.lng !== b.lng)) {
        L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], {
          pane: 'icones-trajets', title: nomsModes(t) + ' : ' + a.nom + ' → ' + b.nom,
          icon: L.divIcon({ className: '', html: '<span class="pastille-trajet" style="border-color:' + m.couleur + '">' + icones(t) + '</span>', iconSize: [0, 0] })
        }).bindPopup(popupTrajet).addTo(carte);
      }
    });

    // Les étapes numérotées passent toujours au-dessus des centres d'intérêt (mais sous les étiquettes et les bulles)
    carte.createPane('etapes').style.zIndex = 620;

    coucheActivites = L.layerGroup();
    cal.etapes.forEach(function (x) {
      var e = x.etape, p = paysDe(e.pays);
      var m = L.marker([e.lat, e.lng], {
        pane: 'etapes',
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
    function etiquettes() {
      carte.getContainer().classList.toggle('sans-etiquettes', carte.getZoom() < 8);
      carte.getContainer().classList.toggle('icones-petites', carte.getZoom() <= 4);
      // Vue de loin : centres d'intérêt réduits à de petits points pour laisser lire les numéros d'étape
      carte.getContainer().classList.toggle('points-petits', carte.getZoom() <= 6);
    }
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
        // Avion au milieu de chaque arc
        L.marker(seg[20], { pane: 'icones-trajets', title: vol.titre,
          icon: L.divIcon({ className: '', html: '<span class="pastille-trajet" style="border-color:#2b6cb0">✈️</span>', iconSize: [0, 0] })
        }).bindPopup(popup).addTo(coucheVols);
      }
      vol.points.forEach(function (p) {
        // Escale (Buenos Aires) : petit avion pour montrer d'où part le vol intérieur
        if (p.nom === 'Buenos Aires') {
          L.marker([p.lat, p.lng], { title: 'Escale : Buenos Aires',
            icon: L.divIcon({ className: '', html: '<span class="marqueur marqueur-vol petit-vol">✈</span>', iconSize: [24, 24], iconAnchor: [12, 12] })
          }).bindPopup('<b>✈️ Escale à Buenos Aires</b><br>' + esc(vol.details || '')).addTo(coucheVols);
          return;
        }
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
  /* Position du téléphone sur la carte (fonctionne aussi sans réseau, grâce au GPS). */
  var marqueurPosition = null;
  function localiser() {
    var etat = $('#carte-etat');
    if (!carte) return;
    if (!navigator.geolocation) { etat.textContent = 'Ce téléphone ne donne pas sa position.'; return; }
    etat.textContent = 'Recherche de votre position…';
    carte.once('locationfound', function (ev) {
      etat.textContent = '';
      if (marqueurPosition) carte.removeLayer(marqueurPosition);
      marqueurPosition = L.layerGroup([
        L.circle(ev.latlng, { radius: ev.accuracy, color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }),
        L.circleMarker(ev.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).bindPopup('Vous êtes ici')
      ]).addTo(carte);
    });
    carte.once('locationerror', function () {
      etat.textContent = 'Position introuvable : autorisez la localisation pour ce site.';
      setTimeout(function () { etat.textContent = ''; }, 5000);
    });
    carte.locate({ setView: true, maxZoom: 12, enableHighAccuracy: true, timeout: 15000 });
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
  var VUES = ['accueil', 'carte', 'etapes', 'planifier', 'plus', 'resas', 'conseils', 'propositions', 'afaire', 'budget', 'depenses', 'devises', 'bagages', 'journal', 'bilan'];
  var SOUS_PLUS = ['resas', 'conseils', 'propositions', 'afaire', 'budget', 'depenses', 'devises', 'bagages', 'journal', 'bilan'];
  var RENDUS = {
    accueil: rendreAccueil, etapes: rendreEtapes, planifier: rendrePlanificateur, plus: rendrePlus, resas: rendreReservations,
    conseils: rendreConseils, propositions: rendrePropositions, afaire: rendreAFaire, budget: rendreBudget,
    depenses: rendreDepenses, devises: rendreDevises, bagages: rendreBagages, journal: rendreJournal, bilan: rendreBilan
  };
  function vueCourante() {
    var v = location.hash.replace('#', '') || 'accueil';
    return VUES.indexOf(v) < 0 ? 'accueil' : v;
  }
  /* Après un changement (case cochée, durée modifiée) : redessiner l'écran affiché et la fiche ouverte, sans bouger. */
  function rafraichir() {
    var y = window.scrollY, v = vueCourante();
    if (RENDUS[v]) RENDUS[v]();
    window.scrollTo(0, y);
    majSousTitre();
    if (ficheOuverte && $('#fiche').open) ouvrirFiche(ficheOuverte, true);
  }
  function refocus(selecteur) {
    var el = (ficheOuverte && $('#fiche').querySelector(selecteur)) || $('#vue-' + vueCourante()).querySelector(selecteur);
    if (el) el.focus({ preventScroll: true });
  }

  /* Dans la liste des étapes, la puce de la section affichée est mise en avant. */
  var suiviPrevu = false;
  function suivreSection() {
    suiviPrevu = false;
    if (vueCourante() !== 'etapes') return;
    var barre = document.querySelector('#liste-etapes .barre-sections');
    if (!barre || barre.hidden) return;
    var seuil = barre.getBoundingClientRect().bottom + 40, actif = null;
    document.querySelectorAll('#liste-etapes [data-section-titre]').forEach(function (t) {
      if (!t.hidden && t.getBoundingClientRect().top <= seuil) actif = t.getAttribute('data-section-titre');
    });
    barre.querySelectorAll('.puce').forEach(function (b) {
      var oui = b.getAttribute('data-section') === actif;
      if (oui && !b.classList.contains('active')) {
        var d = b.parentNode;
        d.scrollLeft = b.offsetLeft - (d.clientWidth - b.offsetWidth) / 2;
      }
      b.classList.toggle('active', oui);
    });
  }
  window.addEventListener('scroll', function () {
    if (!suiviPrevu) { suiviPrevu = true; requestAnimationFrame(suivreSection); }
  }, { passive: true });

  function afficherVue() {
    var v = vueCourante();
    majSousTitre();
    majPastille();
    VUES.forEach(function (n) { $('#vue-' + n).hidden = n !== v; });
    var onglet = SOUS_PLUS.indexOf(v) >= 0 ? 'plus' : v;
    document.querySelectorAll('.onglets a').forEach(function (a) {
      if (a.getAttribute('data-vue') === onglet) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (v !== 'journal') dateJournal = null;
    if (RENDUS[v]) RENDUS[v]();
    if (v === 'devises' || v === 'depenses') majTaux(false);
    suivreSection();
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
      var c = ev.target.closest('[data-fiche],[data-fermer],[data-carte],[data-moins],[data-plus],[data-marge-moins],[data-marge-plus],[data-copier],[data-filtre],[data-section],[data-aller-section],#plan-copier,#plan-reset,#bouton-activites,#bouton-ensemble,#bouton-hors-ligne,#bouton-position,#afaire-masquer,#partager,#agenda,#sauvegarder,#taux-maj,#depenses-copier,#journal-copier,#bagages-vider,[data-devise],[data-suppr-depense],[data-suppr-bagage],[data-journal-modifier],[data-journal-supprimer]');
      if (!c) return;
      if (c.hasAttribute('data-plan-ouvrir')) sectionsOuvertes[c.getAttribute('data-plan-ouvrir')] = true;
      if (c.hasAttribute('data-aller-section')) {
        // Depuis la frise de l'accueil : ouvrir les étapes directement à la bonne section
        var sec = c.getAttribute('data-aller-section');
        setTimeout(function () { var t = document.getElementById('section-' + sec); if (t) t.scrollIntoView({ block: 'start' }); }, 60);
        return;
      }
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
        sauverPlan(); rafraichir();
        refocus('[data-' + (c.hasAttribute('data-plus') ? 'plus' : 'moins') + '="' + eid + '"]');
      }
      else if (c.hasAttribute('data-marge-moins') || c.hasAttribute('data-marge-plus')) {
        var plus = c.hasAttribute('data-marge-plus');
        var pid = c.getAttribute(plus ? 'data-marge-plus' : 'data-marge-moins');
        plan.marges[pid] = Math.max(0, Math.min(60, margePays(pid) + (plus ? 1 : -1)));
        sauverPlan(); rafraichir();
        refocus('[data-marge-' + (plus ? 'plus' : 'moins') + '="' + pid + '"]');
      }
      else if (c.hasAttribute('data-copier')) copier(c.getAttribute('data-copier'));
      else if (c.hasAttribute('data-filtre')) { filtreResa = c.getAttribute('data-filtre'); rendreReservations(); }
      else if (c.id === 'plan-copier') copier(resumeTexte());
      else if (c.id === 'plan-reset') {
        if (confirm('Revenir aux durées et activités de départ ?')) { plan = { debut: null, jours: {}, activites: {}, marges: {} }; sauverPlan(); rafraichir(); toast('Valeurs de départ rétablies'); }
      }
      else if (c.id === 'bouton-activites') {
        var on = c.getAttribute('aria-pressed') !== 'true';
        c.setAttribute('aria-pressed', String(on));
        if (carte) { if (on) coucheActivites.addTo(carte); else carte.removeLayer(coucheActivites); }
      }
      else if (c.id === 'bouton-ensemble') vueEnsemble();
      else if (c.id === 'bouton-position') localiser();
      else if (c.id === 'afaire-masquer') {
        masquerFaits = !masquerFaits;
        try { localStorage.setItem(CLE_MASQUER, masquerFaits ? '1' : '0'); } catch (e) { /* ignoré */ }
        rendreAFaire(); refocus('#afaire-masquer');
      }
      else if (c.id === 'agenda') {
        if (!donnees.voyage.datesProvisoires || confirm('Les dates sont encore provisoires : l\'agenda ne se mettra pas à jour tout seul si elles changent. Créer le fichier quand même ?')) exporterAgenda();
      }
      else if (c.id === 'sauvegarder') sauvegarder();
      else if (c.id === 'taux-maj') majTaux(true);
      else if (c.id === 'depenses-copier') copier(texteDepenses(), 'Dépenses copiées');
      else if (c.id === 'journal-copier') copier(texteJournal(), 'Journal copié');
      else if (c.id === 'bagages-vider') {
        if (confirm('Décocher tous les objets pour refaire le sac ?')) { bagages.coches = {}; ecrire(CLES.bagages, bagages); rendreBagages(); }
      }
      else if (c.hasAttribute('data-devise')) { taux.devise = c.getAttribute('data-devise'); ecrire(CLES.taux, taux); rendreDevises(); refocus('[data-devise="' + taux.devise + '"]'); }
      else if (c.hasAttribute('data-suppr-depense')) {
        if (confirm('Supprimer cette dépense ?')) {
          var did = +c.getAttribute('data-suppr-depense');
          depenses = depenses.filter(function (d) { return d.id !== did; });
          ecrire(CLES.depenses, depenses); rafraichir();
        }
      }
      else if (c.hasAttribute('data-suppr-bagage')) {
        ev.preventDefault();
        var bid = c.getAttribute('data-suppr-bagage');
        bagages.perso = bagages.perso.filter(function (b) { return b.id !== bid; });
        delete bagages.coches[bid];
        ecrire(CLES.bagages, bagages); rafraichir();
      }
      else if (c.hasAttribute('data-journal-modifier')) { dateJournal = c.getAttribute('data-journal-modifier'); rendreJournal(); window.scrollTo(0, 0); }
      else if (c.hasAttribute('data-journal-supprimer')) {
        var jd = c.getAttribute('data-journal-supprimer');
        if (confirm('Supprimer la page du ' + dCourt(versDate(jd)) + ' ?')) { delete journal[jd]; ecrire(CLES.journal, journal); rafraichir(); }
      }
      else if (c.id === 'partager') {
        var adresse = location.origin + location.pathname;
        if (navigator.share) navigator.share({ title: donnees.voyage.titre, url: adresse }).catch(function () { /* partage annulé */ });
        else copier(adresse, 'Lien copié');
      }
      else if (c.id === 'bouton-hors-ligne') prechargerCarte();
    });

    document.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.id === 'plan-debut' && t.value) { plan.debut = t.value; sauverPlan(); rafraichir(); }
      else if (t.hasAttribute && t.hasAttribute('data-act')) {
        plan.activites[t.getAttribute('data-act')] = t.checked;
        sauverPlan(); rafraichir();
        refocus('[data-act="' + t.getAttribute('data-act') + '"]');
      }
      else if (t.id === 'journal-date' && t.value) { dateJournal = t.value; rendreJournal(); refocus('#journal-date'); }
      else if (t.id === 'restaurer' && t.files && t.files[0]) restaurer(t.files[0]);
      else if (t.id === 'taux-manuel') {
        var tm = nombre(t.value), code = taux.devise;
        if (tm && tm > 0) taux.manuel[code] = tm; else delete taux.manuel[code];
        ecrire(CLES.taux, taux); rendreDevises();
        toast(tm && tm > 0 ? 'Votre taux est utilisé' : 'Retour au taux automatique');
      }
      else if (t.hasAttribute && t.hasAttribute('data-bagage')) {
        var gid = t.getAttribute('data-bagage');
        if (t.checked) bagages.coches[gid] = true; else delete bagages.coches[gid];
        ecrire(CLES.bagages, bagages); rafraichir();
        refocus('[data-bagage="' + gid + '"]');
      }
      else if (t.hasAttribute && t.hasAttribute('data-fait')) {
        var fid = t.getAttribute('data-fait');
        faits[fid] = t.checked;
        sauverFaits(); rafraichir();
        refocus('[data-fait="' + fid + '"]');
        if (t.checked) toast('C\'est fait ✓');
      }
    });

    // Saisie en direct : convertisseur (les deux champs se répondent) et notes d'étape
    document.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.id === 'conv-local' || t.id === 'conv-eur') {
        var v = nombre(t.value), tx = tauxDe(taux.devise), autre = $(t.id === 'conv-local' ? '#conv-eur' : '#conv-local');
        autre.value = v == null ? '' : fmtNombre.format(t.id === 'conv-local' ? v / tx : v * tx);
      }
      else if (t.hasAttribute && t.hasAttribute('data-note')) {
        var nid = t.getAttribute('data-note');
        if (t.value.trim()) notesPerso[nid] = t.value; else delete notesPerso[nid];
        ecrire(CLES.notes, notesPerso);
      }
    });
    document.addEventListener('submit', function (ev) {
      var f = ev.target;
      if (f.id === 'form-depense') { ev.preventDefault(); ajouterDepense(f); }
      else if (f.id === 'form-bagage') {
        ev.preventDefault();
        var nom = f.nom.value.trim();
        if (!nom) { f.nom.focus(); return; }
        bagages.perso.push({ id: 'perso-' + Date.now(), nom: nom, cat: f.cat.value });
        bagagesOuverts[f.cat.value] = true;
        ecrire(CLES.bagages, bagages); rendreBagages(); toast('Ajouté à la liste');
      }
      else if (f.id === 'form-journal') {
        ev.preventDefault();
        var jd = f.date.value || isoAuj(), txt = f.texte.value.trim(), hum = f.humeur.value;
        if (!txt && !hum) { toast('Écrivez quelques mots ou choisissez une humeur'); return; }
        journal[jd] = { humeur: hum || null, texte: txt };
        ecrire(CLES.journal, journal); dateJournal = null; rendreJournal(); toast('Page enregistrée ✓');
      }
    });

    // Recherche dans les étapes
    $('#bouton-recherche').addEventListener('click', function () { basculerRecherche(); });
    $('#recherche-etapes').addEventListener('input', filtrerEtapes);
    $('#recherche-conseils').addEventListener('input', filtrerConseils);
    $('#recherche-etapes').addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') basculerRecherche(false);
      if (ev.key === 'Enter') ev.target.blur();
    });

    // Mémoriser les sections dépliées pour les garder ouvertes après un recalcul
    document.addEventListener('toggle', function (ev) {
      var el = ev.target;
      if (!el.getAttribute) return;
      if (el.id === 'meteo-fiche') {
        meteoOuverte = el.open;
        var em = ficheOuverte && donnees.etapes.filter(function (y) { return y.id === ficheOuverte; })[0];
        if (el.open && em) { majMeteoFiche(); chargerMeteo(em, majMeteoFiche); setTimeout(majMeteoFiche, 6000); }
        return;
      }
      var s = el.getAttribute('data-plan-section'), a = el.getAttribute('data-afaire-cat'), g = el.getAttribute('data-bagages-cat');
      if (g) bagagesOuverts[g] = el.open;
      if (s) sectionsOuvertes[s] = el.open;
      if (a) afaireOuvertes[a] = el.open;
    }, true);

    var d = $('#fiche');
    d.addEventListener('click', function (ev) { if (ev.target === d) fermerFiche(); });
    // À la fermeture (bouton, touche Échap, geste retour) : la liste des étapes affiche la note qu'on vient d'écrire
    d.addEventListener('close', function () {
      ficheOuverte = null;
      if (vueCourante() === 'etapes') { var yy = window.scrollY; rendreEtapes(); window.scrollTo(0, yy); }
    });

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

    // Demander au téléphone de ne pas effacer les données de l'appli quand il manque de place
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { /* ignoré */ });

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      // Quand une nouvelle version est publiée, le nouveau service worker prend la main :
      // on recharge une fois pour afficher tout de suite la nouvelle version (sauf à la toute première installation).
      var dejaControle = !!navigator.serviceWorker.controller, recharge = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!dejaControle || recharge) return;
        recharge = true;
        try { sessionStorage.setItem('voyage-maj', '1'); } catch (e) { /* ignoré */ }
        location.reload();
      });
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        // Vérifier les mises à jour à chaque ouverture et quand l'appli revient au premier plan
        reg.update();
        document.addEventListener('visibilitychange', function () { if (!document.hidden) reg.update(); });
      }).catch(function () { /* ignoré */ });
      try {
        if (sessionStorage.getItem('voyage-maj')) { sessionStorage.removeItem('voyage-maj'); setTimeout(function () { toast('Appli mise à jour ✓'); }, 600); }
      } catch (e) { /* ignoré */ }
    }
  }

  demarrer();
})();
