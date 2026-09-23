# graphrag-hse

Collecte et normalisation locale d’articles via l’**API Légifrance** (PISTE), sous Windows (PowerShell), sans Docker ni WSL.

Périmètre actuel : **collecte** + **normalisation locale** + **lot séquentiel pilote** (pas de Neo4j, embeddings, extraction d’obligations ni exploration automatique des liens).

## Prérequis

- Node.js 18+ (testé avec Node 24)
- Compte et application sur [PISTE](https://piste.gouv.fr) (pour la collecte uniquement)
- API **Légifrance** rattachée à votre application (sandbox et/ou production)
- CGU Légifrance acceptées sur le portail

## Installation (PowerShell)

```powershell
cd C:\Users\erwan\code\poc-hse
npm install
Copy-Item .env.example .env
notepad .env
```

| Variable | Requis pour | Rôle |
|---|---|---|
| `PISTE_CLIENT_ID` | `collect`, `collect:batch` | Client ID OAuth PISTE |
| `PISTE_CLIENT_SECRET` | `collect`, `collect:batch` | Client secret (ne jamais le committer) |
| `PISTE_ENV` | `collect`, `collect:batch` | `sandbox` ou `production` |
| `LEGIFRANCE_ARTICLE_ID` | `collect` uniquement | Un `LEGIARTI…` — **non utilisé** par `collect:batch` |
| `REQUEST_TIMEOUT_MS` | optionnel | Délai max HTTP (défaut `30000`) |

## Commandes

```powershell
npm run typecheck
npm test

# Collecte unitaire (nécessite LEGIFRANCE_ARTICLE_ID)
npm run collect

# Lot pilote (IDs dans le fichier d'entrée ; pas de LEGIFRANCE_ARTICLE_ID)
npm run collect:batch -- --input "config/articles-pilot.json"
# option : --delay-ms 1000 (défaut ; entier ≥ 0 ; réglage pilote, pas une affirmation de quota PISTE)

# Normalisation locale (aucun réseau, ne charge pas .env)
npm run normalize -- --collection "data/collections/<fichier>.json"
```

## Lot pilote (`collect:batch`)

### Nature des trois identifiants

Le fichier `config/articles-pilot.json` liste **trois versions historiques** du même article **L4121-1** (Code du travail), issues du champ `articleVersions` du corps déjà collecté :

| Ordre | Identifiant | Rôle dans le lot |
|---|---|---|
| 1 | `LEGIARTI000035640828` | Version 3.0 (VIGUEUR au moment de la collecte initiale) |
| 2 | `LEGIARTI000023032086` | Version 2.0 |
| 3 | `LEGIARTI000006903147` | Version 1.0 |

Ce lot teste le traitement de **versions** d’un même article, **pas** trois obligations distinctes ni un corpus représentatif du HSE.

### Déroulement

1. Validation **intégrale** du JSON d’entrée avant tout réseau (`schemaVersion`, tableau non vide, forme `LEGIARTI`+chiffres, max 10, **doublons rejetés** sans correction silencieuse)
2. Un jeton OAuth obtenu **une fois** au début (pas de renouvellement ni retry dans cette étape)
3. Pour chaque ID, dans l’ordre : fetch → stockage corps/métadonnées → normalisation via le **chemin exact** des métadonnées venant d’être créées
4. Pause `--delay-ms` entre articles (sauf après le dernier)
5. Rapport publié sous `data/batches/<batchId>.json` (temporaire + `fs.link`, sans écrasement)

### Politique d’arrêt

| Situation | Comportement |
|---|---|
| `NOT_FOUND` / `INVALID_RESPONSE` (fetch) | Échec de l’article, **poursuite** |
| `AUTH` / `QUOTA` / `NETWORK` / autre erreur HTTP | **Arrêt** ; reste `not_processed` |
| Erreur de stockage ou inattendue | **Arrêt** |
| Erreur de normalisation | Collecte **conservée** (`collectionId` + chemin meta dans le bilan), puis **arrêt** |
| Échec OAuth initial | Bilan `aborted`, tous `not_processed`, erreur globale `oauth` |

Un article non traité n’est **jamais** présenté comme une erreur API.

### Compteurs et statuts

- `collected` : collecte sauvegardée  
- `normalized` : normalisation réussie  
- `failed` : article tenté ayant échoué à une étape  
- `notProcessed` : jamais tenté  

Un article collecté puis non normalisé compte dans **collected** et **failed**, pas dans **normalized**.

Statut global : `completed` | `completed_with_errors` | `aborted`.  
Code de sortie : `0` seulement si tous les articles sont collectés **et** normalisés ; sinon non nul.

### Relance d’une normalisation échouée

Si le bilan conserve `collectionMetaPath` après un échec de normalisation :

```powershell
npm run normalize -- --collection "data/collections/<fichier>.json"
```

### Limite — arrêt brutal

Le rapport final est garanti pour les **erreurs gérées** par le programme. Un kill processus / crash OS peut laisser le lot sans rapport ; cette étape n’ajoute pas de journalisation incrémentale ni de reprise automatique.

## Collecte unitaire

1. Lecture de `.env` (y compris `LEGIFRANCE_ARTICLE_ID`)
2. OAuth2 `client_credentials` — jeton jamais affiché ni sauvegardé
3. `POST …/consult/getArticle`
4. Validation ; échec → code non nul, pas de succès enregistré
5. Succès : `data/bodies/<sha256>.json` (dédup) + `data/collections/<horodatage>_<id>_<collectionId>.json`

## Normalisation (étape 2)

Entrée explicite : fichier de métadonnées. Aucun réseau / `.env`. Corps et métadonnées de collecte **jamais** modifiés.

Publication : temporaire du même dossier → fermeture → **lien physique** `fs.link` (NTFS / même volume ; pas de repli `copyFile`).

Les avertissements de date (`DATE_SENTINEL_2999`, etc.) **ne constituent pas** un échec.

Voir le mapping source → document normalisé dans les versions antérieures du README (inchangé pour cette étape).

### Mapping source → document normalisé

| Zone | Champs source | Destination |
|---|---|---|
| Provenance | métadonnées de collecte | `provenance.*` |
| Identity | `id`, `cid`, `num`, … | `identity.*` (`id` ≠ `cid` implicite) |
| Content | `texte`, `texteHtml`, `nota`, `notaHtml` | `content.*` (pas de texte inventé depuis HTML) |
| Dates | quatre dates principales | `dates.*` (`raw` + `isoUtc` si ms valides) |
| Context / versions / relations | structures source | préservées (ordre, doublons, champs complets) |

## Structure des données

```
config/
  articles-pilot.json   # lot pilote (versions L4121-1)
data/
  bodies/
  collections/
  normalized/
  batches/              # rapports de lot <batchId>.json
```

`.env` et `data/` sont exclus via `.gitignore`.
