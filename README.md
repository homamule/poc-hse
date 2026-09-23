# graphrag-hse

Collecte et normalisation locale d’articles via l’**API Légifrance** (PISTE), sous Windows (PowerShell), sans Docker ni WSL.

Périmètre actuel : **collecte** + **normalisation locale** (pas de Neo4j, embeddings, extraction d’obligations ni interface).

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

Renseignez dans `.env` (collecte uniquement) :

| Variable | Rôle |
|---|---|
| `PISTE_CLIENT_ID` | Client ID OAuth de l’application PISTE |
| `PISTE_CLIENT_SECRET` | Client secret OAuth (ne jamais le committer) |
| `PISTE_ENV` | `sandbox` ou `production` |
| `LEGIFRANCE_ARTICLE_ID` | Identifiant réel `LEGIARTI…` (voir ci-dessous) |
| `REQUEST_TIMEOUT_MS` | Délai max HTTP en ms (défaut `30000`) |

## Choisir un identifiant d’article réel

Ne pas inventer d’identifiant. Procédure recommandée :

1. Ouvrez [Légifrance](https://www.legifrance.gouv.fr).
2. Recherchez l’article souhaité (code, loi, etc.) et ouvrez sa fiche.
3. Dans l’URL du navigateur, repérez un segment du type `LEGIARTI` suivi de chiffres.
4. Copiez **exactement** cet identifiant dans `LEGIFRANCE_ARTICLE_ID`.

Références : [Open data et API](https://www.legifrance.gouv.fr/contenu/menu/autour-de-la-loi/open-data-et-api), [piste.gouv.fr](https://piste.gouv.fr).

## Commandes

```powershell
npm run typecheck
npm test

# Collecte (nécessite .env)
npm run collect

# Normalisation (aucun réseau, ne charge pas .env)
npm run normalize -- --collection "data/collections/2026-09-23T10-50-59-961Z_LEGIARTI000035640828_8fe226e5-09f5-48d8-950e-06f03dc5cb22.json"
```

Remplacez le chemin `--collection` par le fichier de métadonnées effectivement présent sous `data/collections/`. Aucune sélection automatique de la « dernière » collecte.

## Collecte

1. Lecture de `.env`
2. OAuth2 `client_credentials` — jeton jamais affiché ni sauvegardé
3. `POST …/consult/getArticle`
4. Validation ; échec → code non nul, pas de succès enregistré
5. Succès : `data/bodies/<sha256>.json` (dédup) + `data/collections/<horodatage>_<id>_<collectionId>.json`

### Validation de l’article reçu

- `article` objet non nul / non tableau
- `article.id` === identifiant demandé
- contenu exploitable : `texte` **ou** `texteHtml` non vide (schéma Swagger)

## Normalisation (étape 2)

Entrée explicite : fichier de métadonnées de collecte.  
Aucun appel réseau, OAuth, LLM ni base de données. Le `.env` n’est **pas** chargé. Les corps et métadonnées de collecte ne sont **jamais** modifiés.

### Contrôles avant écriture

1. Valider les métadonnées nécessaires (`collectionId`, `bodyPath`, `bodySha256`, etc.)
2. Vérifier l’existence du corps
3. Recalculer le SHA-256 sur les **octets** lus et comparer à `bodySha256`
4. Parser le JSON et réutiliser la validation d’article existante
5. Vérifier `article.id === requestedArticleId`

Échec → diagnostic clair, code de sortie non nul, **aucun** fichier normalisé.

### Sortie

```
data/normalized/<collectionId>_v1.0.0.json
```

- Contenu déterministe (pas d’horodatage courant ni d’UUID aléatoire dans le document)
- Création exclusive (flag `wx`, compatible Windows)
- Fichier déjà présent + contenu identique → succès « déjà normalisé »
- Fichier déjà présent + contenu différent → erreur, pas d’écrasement

Deux collectes du même corps restent distinguées par leur `provenance.collectionId`.

### Mapping source → document normalisé

| Zone | Champs source (article / meta) | Destination |
|---|---|---|
| Provenance | métadonnées de collecte | `provenance.*` (`environment` conservé explicitement, URL = `url`) |
| Identity | `id`, `cid`, `num`, `origine`, `nature`, `type`, `versionArticle`, `etat` | `identity.*` — `id` et `cid` séparés, sans équivalence implicite |
| Content | `texte`, `texteHtml`, `nota`, `notaHtml` | `content.*` — chaînes telles quelles ; **pas** de texte brut inventé depuis le HTML |
| Dates | `dateDebut`, `dateFin`, `dateDebutExtension`, `dateFinExtension` | `dates.*` : `raw` + `isoUtc` si ms valides ; sinon `absent` / `invalid` |
| Context | `idTexte`, `cidTexte`, `textTitles`, `context.titreTxt`, `context.titresTM`, section parente | `context.*` — ordre source ; pas de rattachement choisi silencieusement |
| Versions | `articleVersions`, `versionPrecedente` | `versions.*` |
| Relations | `lienCitations`, `lienModifications`, `lienConcordes`, `lienAutres` | `relations.*` — tous les champs d’entrée, ordre et doublons conservés ; pas de graphe orienté |

**Valeurs absentes** : représentées par `null` dans les champs scalaires normalisés (ou `status: "absent"` pour les dates principales). Les structures imbriquées absentes deviennent `null` ; lorsqu’elles sont présentes, leurs champs non modélisés sont **préservés** tels quels (clone structurel).

**Dates** : seules les quatre dates principales ci-dessus sont converties. Les timestamps des structures imbriquées restent au format source. Exemples : `1506816000000` → `2017-10-01T00:00:00.000Z` ; `32472144000000` → `2999-01-01T00:00:00.000Z` (conservé + avertissement `DATE_SENTINEL_2999`, sans conversion en null ni « durée illimitée »).

**Avertissements** : chaque entrée a `code`, `path`, `message`. Aucune déduction d’obligation, d’applicabilité site ou de conformité. La valeur `etat: "VIGUEUR"` est une donnée **source**, pas une validation juridique effectuée par ce programme.

## Structure des données

```
data/
  bodies/        # corps bruts (SHA-256)
  collections/   # une métadonnée JSON par collecte réussie
  normalized/    # documents normalisés <collectionId>_v1.0.0.json
```

`.env` et `data/` sont exclus via `.gitignore`.
