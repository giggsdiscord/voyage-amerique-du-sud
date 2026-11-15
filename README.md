# Voyage Amérique du Sud (oct. 2027 – mars 2028)

Appli web hors ligne (PWA) pour le voyage : carte, étapes, calculateur de dates et réservations.
Site statique sans build, déployé par Netlify depuis la branche `main`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `data/voyage.json` | **Toutes les données** : pays, étapes, activités, réservations |
| `index.html`, `css/style.css`, `js/app.js` | L'appli |
| `sw.js` | Service worker (hors ligne). Changer `VERSION` après une modification du code |
| `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil |
| `netlify.toml`, `robots.txt` | Publication et `noindex` |

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
  "numero": "ABC123",
  "lienDrive": "https://drive.google.com/file/d/…/view",
  "etape": "huaraz",
  "notes": ""
}
```

- `type` : `vol`, `bus`, `train`, `voiture`, `activite`, `hebergement` ou `autre`.
- `lienDrive` : seulement un lien `drive.google.com` ou `docs.google.com`, jamais le PDF lui-même.
- `etape` (facultatif) : affiche la réservation dans la fiche de cette étape.

**Ne jamais mettre** de numéro de passeport, de carte bancaire ni de QR code dans ce dépôt.

## Astuce

Ajouter `?date=2027-11-02` à l'adresse simule un jour du voyage sur l'accueil.
