# Voyage Amérique du Sud (oct. 2027 – mars 2028)

Appli web hors ligne (PWA) pour le voyage : carte, étapes, calculateur de dates et réservations.
Site statique sans build, publié par GitHub Pages depuis la branche `main` :
https://giggsdiscord.github.io/voyage-amerique-du-sud/

**Dépôt public** : ne jamais y mettre de numéro de réservation, de passeport, de carte bancaire ni de QR code.
Pour les réservations, seulement les liens Drive (qui demandent la connexion Google).

## Fichiers

| Fichier | Rôle |
|---|---|
| `data/voyage.json` | **Toutes les données** : pays, étapes, activités, réservations |
| `index.html`, `css/style.css`, `js/app.js` | L'appli |
| `sw.js` | Service worker (hors ligne). Changer `VERSION` après une modification du code |
| `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil |
| `robots.txt`, balise `robots` dans `index.html` | `noindex` (pas de référencement) |
| `.nojekyll` | Publication telle quelle par GitHub Pages |

## Ajouter une étape

Dans `data/voyage.json`, ajouter un objet dans `etapes`, **à sa place dans l'ordre du voyage** :

```json
{
  "id": "uyuni",
  "pays": "bolivie",
  "nom": "Uyuni",
  "lat": -20.4630, "lng": -66.8250,
  "altitude": 3660,
  "jours": 2,
  "hebergement": { "nom": "Hostal X", "adresse": "…", "notes": "réservé" },
  "notes": "",
  "activites": [
    { "id": "salar", "nom": "Salar d'Uyuni", "jours": 3, "statut": "prevu", "lat": -20.13, "lng": -67.49, "description": "Tour de 3 jours en 4x4." }
  ]
}
```

- `jours` : jours de base (arrivée, ville, repos). Chaque activité cochée ajoute ses `jours` (0 = dans la journée).
- `statut` d'une activité : `prevu` (cochée par défaut), `option` ou `suggestion` (décochées).
- Nouveau pays : l'ajouter aussi dans `pays`, avec `fenetre` (période prévue) et une `couleur`.

## Trajet pour arriver à une étape

Chaque étape peut avoir un champ `trajet` (comment on y arrive depuis l'étape précédente) :

```json
"trajet": { "modes": ["bus"], "resume": "Bus de nuit, environ 9 h", "details": "Cruz del Sur", "statut": "choisi" }
```

- `modes` : `vol`, `bus`, `train`, `voiture`, `colectivo`, `tour`, `taxi`, `bateau`, `marche`, `velo` (plusieurs possibles).
- `statut` : `propose`, `choisi` ou `reserve`. Sur la carte, un trajet choisi ou réservé est tracé plus épais.

## Sections du voyage et conseils

- `pays` sert aussi de section : « Patagonie » regroupe les étapes chiliennes et argentines du sud (le vrai pays est indiqué par 🇨🇱 / 🇦🇷 dans les notes). `fenetre` = période prévue, comparée au calculateur.
- `conseils` : liste de fiches `{ "id", "icone", "titre", "resume", "points": [...] }` affichées dans l'onglet Conseils.

## Budget (calculé automatiquement)

- `budget.parJour` : fourchette de dépenses quotidiennes par section, en € par personne.
- `cout: [min, max]` sur une activité (comptée seulement si elle est cochée) ou sur un `trajet`.
- `budget.fixes` : vols internationaux, assurance, locations…
- L'onglet Plus → Budget additionne tout selon les durées et activités du calculateur.

## Ajouter une réservation

Dans `reservations` :

```json
{
  "type": "bus",
  "titre": "Lima → Huaraz",
  "date": "2027-10-27",
  "heure": "21:30",
  "lieu": "Terminal Cruz del Sur, Lima",
  "arrivee": "Huaraz",
  "compagnie": "Cruz del Sur",
  "lienDrive": "https://drive.google.com/file/d/…/view",
  "etape": "huaraz",
  "notes": ""
}
```

- `type` : `vol`, `bus`, `train`, `voiture`, `activite`, `hebergement` ou `autre`.
- `lienDrive` : seulement un lien `drive.google.com` ou `docs.google.com`, jamais le PDF lui-même.
- Pas de champ `numero` : le dépôt est public, le numéro reste dans le PDF du Drive.
- `etape` (facultatif) : affiche la réservation dans la fiche de cette étape.

**Ne jamais mettre** de numéro de passeport, de carte bancaire ni de QR code dans ce dépôt.

## Données gardées sur chaque téléphone

Cases cochées, réglages du calculateur, dépenses, journal de bord, bagages, notes d'étape et taux de change
restent dans le `localStorage` du téléphone (clés `voyage-…`) : rien n'est envoyé au dépôt.
Plus → « Sauvegarder mes données » en fait une copie en fichier, « Restaurer une sauvegarde » la recharge.

- `delai` sur une ligne de `aFaire` : nombre de jours avant la date concernée pour l'échéance conseillée (sinon délai par défaut selon la catégorie, `DELAIS` dans `js/app.js`).
- `paysReel` sur chaque étape (`argentine`, `chili`, `bolivie`, `perou`) : relie l'étape à sa fiche de `fichesPays`.
- `activites` sur une proposition : identifiants des activités cochées ou décochées quand on la retient ou non dans l'appli.
- `bagages` dans `voyage.json` : liste de base du sac, par catégorie (`{ "id", "icone", "titre", "items": [{ "id", "nom", "detail" }] }`).
- Convertisseur : taux du jour pris sur `open.er-api.com` quand il y a du réseau, taux de secours dans `DEVISES` (`js/app.js`).

## Astuce

Ajouter `?date=2027-11-02` à l'adresse simule un jour du voyage sur l'accueil.
