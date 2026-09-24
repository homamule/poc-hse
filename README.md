# graphrag-hse

Collecte et normalisation locale d’articles via l’**API Légifrance** (PISTE), sous Windows (PowerShell), sans Docker ni WSL.

Périmètre actuel : **collecte** + **normalisation** + **lot** + **comparaison** + **inventaire de relations** + **projection graphe JSON** + **import Neo4j contrôlé** + **texte des articles dans Neo4j** + **passages locaux sourcés** (pas d’embeddings ni d’extraction d’obligations).

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
| `HSE_NEO4J_URI` | `graph:import --apply`, `graph:content --apply` | URI bolt/neo4j (non lue en aperçu) |
| `HSE_NEO4J_USER` | `graph:import --apply`, `graph:content --apply` | Utilisateur Neo4j |
| `HSE_NEO4J_PASSWORD` | `graph:import --apply`, `graph:content --apply` | Mot de passe (jamais affiché) |
| `HSE_NEO4J_DATABASE` | `graph:import --apply`, `graph:content --apply` | Base ciblée (défaut `neo4j`) |

## Commandes

```powershell
npm run typecheck
npm test

# Collecte unitaire (nécessite LEGIFRANCE_ARTICLE_ID)
npm run collect

# Lot pilote — 3 versions historiques de L4121-1 (pas de LEGIFRANCE_ARTICLE_ID)
npm run collect:batch -- --input "config/articles-pilot.json"
# Lot corpus prévention — 4 articles distincts (voir docs/corpus-prevention.md)
npm run collect:batch -- --input "config/articles-prevention.json"
# option : --delay-ms 1000 (défaut ; entier ≥ 0 ; réglage pilote, pas une affirmation de quota PISTE)

# Normalisation locale (aucun réseau, ne charge pas .env)
npm run normalize -- --collection "data/collections/<fichier>.json"

# Comparaison locale de deux collectes (aucun réseau, ne charge pas .env)
npm run compare -- --before "data/collections/<premiere>.json" --after "data/collections/<seconde>.json"

# Inventaire local des relations (rapport de lot prévention ; aucun réseau / .env)
npm run relations:inventory -- --batch "data/batches/<batchId>.json"

# Projection graphe JSON locale (depuis un inventaire ; aucun réseau / Neo4j / .env)
npm run graph:build -- --inventory "data/relation-inventories/<id>.json"

# Import Neo4j contrôlé — aperçu local (aucune connexion, aucun identifiant lu)
npm run graph:import -- --graph "data/graphs/<id>.json"
# Import Neo4j contrôlé — application (lit HSE_NEO4J_* ; pilote officiel)
npm run graph:import -- --graph "data/graphs/<id>.json" --apply
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

### Corpus prévention (`config/articles-prevention.json`)

Quatre **articles distincts** du Code du travail (L4121-1, L4121-2, L4121-3, R4121-1). Détail et sources officielles : [`docs/corpus-prevention.md`](docs/corpus-prevention.md).

```powershell
npm run collect:batch -- --input "config/articles-prevention.json"
```

Contrôle manuel après exécution :

1. Quatre articles collectés **et** normalisés (bilan de lot + fichiers sous `data/`)
2. Correspondance `article.id` / numéro (`num`) avec le tableau de `docs/corpus-prevention.md`
3. Rattachement au Code du travail (`LEGITEXT000006072050`) dans le contexte source
4. Examen des warnings de normalisation et des relations présentes dans les corps collectés

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

## Comparaison locale (étape 4)

Compare **syntaxiquement** deux corps JSON de collecte d’une **même** version d’article (`article.id`) et d’un **même** environnement. Aucun réseau, aucun `.env`, aucun LLM.

```powershell
npm run compare -- --before "data/collections\<premiere>.json" --after "data/collections\<seconde>.json"
```

Contraintes d’entrée : `before.collectedAtUtc ≤ after.collectedAtUtc` (auto-comparaison acceptée). Identifiants LEGIARTI ou environnements différents → refus. Les fichiers de collecte / normalisation ne sont **pas** modifiés.

### Politique de classement (`comparisonPolicyVersion` 1.0.0)

Diff structurelle exhaustive (ordre des clés ignoré ; ordre / doublons des tableaux conservés — un réordonnancement = différence). Chemins en JSON Pointer. Catégories :

| Catégorie | Racines (et descendants pour context / versions / relations) |
|---|---|
| `content` | `/article/texte`, `texteHtml`, `nota`, `notaHtml` |
| `dates_state` | `etat`, dates, `conditionDiffere` |
| `identity` | `id`, `cid`, `num`, `origine`, `nature`, `type`, `versionArticle` |
| `context` | `context`, `textTitles`, ids texte / section parent, titres |
| `versions` | `articleVersions`, `versionPrecedente` |
| `relations` | `lienCitations`, `lienModifications`, `lienConcordes`, `lienAutres` |
| `technical` | `/executionTime`, `/article/refInjection`, `/article/idTechInjection` uniquement |
| `other` | tout chemin non couvert |

`technical` est une **convention du comparateur**, pas une lecture juridique de l’API. Un champ inconnu n’est **jamais** classé automatiquement en `technical`.

### Empreintes

Pour chaque côté : `bodySha256` (fichier brut), `structuralSha256` (JSON canonisé — clés triées, tableaux préservés), `watchSha256` (même canonisation après retrait des **seuls** trois chemins `technical`). Les champs inconnus participent à `watchSha256`. Associées à la version de politique ; `watchSha256` n’est **pas** une preuve d’équivalence juridique.

### Statuts globaux (exclusifs)

| Statut | Signification |
|---|---|
| `identical` | Corps bruts identiques |
| `serialization_only` | Corps différents, JSON structurellement identiques (espaces, ordre des clés…) |
| `technical_only` | Différences structurelles, toutes `technical` |
| `review_required` | Au moins une différence hors `technical` (y compris `other`) |

Le rapport **ne** produit **jamais** de formulation du type « nouvelle obligation », « changement applicable » ou « conformité modifiée ».

Sortie : `data/comparisons/<comparisonId>.json` (publication exclusive via `fs.link`). Code de sortie `0` si la comparaison s’exécute, y compris en `review_required`.

### Limites

- Même version d’article et même environnement uniquement
- Comparaison **syntaxique** des corps originaux (pas le document normalisé)
- Aucune qualification juridique ni surveillance automatique

## Inventaire des relations (étape 6)

Lit un rapport de lot **prévention** (4 succès) et les fichiers normalisés référencés. Aucun réseau, aucun `.env`. Inventaire des données source uniquement — pas de Neo4j, d’embeddings ni d’interprétation juridique.

```powershell
npm run relations:inventory -- --batch "data/batches\<batchId>.json"
```

Parcourt `lienCitations`, `lienModifications`, `lienConcordes`, `lienAutres`. Chaque entrée conserve les valeurs brutes (`linkType`, `linkOrientation`, etc.) **sans** déduire « A cite B » à partir de `linkOrientation`.

### Classes de correspondance (identifiant exact uniquement)

| Classe | Signification |
|---|---|
| `version_collectee` | `articleId` = `identity.id` d’un des quatre fichiers du corpus |
| `autre_version_connue` | `articleId` figure dans `versions.articleVersions` d’un article du corpus, mais cette version n’est pas collectée |
| `non_resolue` | aucun des deux cas (y compris `articleId` absent ou inattendu, avec raison) |

Aucun appariement sur le seul numéro d’article (`L4121-1`…) ni sur le `cid`.

Sortie : `data/relation-inventories/<inventoryId>.json` (publication exclusive). Relance identique → « déjà présent » ; contenu différent au même emplacement → refus.

## Projection graphe locale (étape 7)

Construit un graphe **JSON déterministe** à partir d’un inventaire de relations. Aucun Neo4j, aucun réseau, aucun `.env`. Les liens techniques décrivent la structure des données ; ils **n’affirment pas** le sens juridique de « cite ».

```powershell
npm run graph:build -- --inventory "data/relation-inventories\de11015b82fde062558e4659332f960a328999ae2283b75e20e78d61caccdef9.json"
```

### Modèle (politique 1.0.0)

| Élément | Rôle |
|---|---|
| `ArticleVersion` (collected=true) | Une version effectivement collectée (`identity.id`) |
| `ArticleVersion` (collected=false) | Version historique pointée par `autre_version_connue`, confirmée dans `articleVersions` — sans texte / état / date inventés |
| `RelationSource` | Une entrée d’inventaire `version_collectee` ou `autre_version_connue` |
| `OBSERVATION_DANS` | ArticleVersion collecté → RelationSource |
| `REFERENCE_IDENTIFIANT` | RelationSource → ArticleVersion référencé (id exact de l’entrée) |

Pas de lien direct « CITE » entre articles à cette étape. Les entrées `non_resolue` ne deviennent pas des nœuds ; leur décompte reste dans `metadata.nonResolueCount`. Aucune fusion sur `num` ou `cid`.

Sortie : `data/graphs/<graphId>.json` (publication exclusive). Relance identique → « déjà présent ».

## Import Neo4j contrôlé (étape 8)

Import du graphe JSON vers Neo4j via le pilote officiel `neo4j-driver`. Labels dédiés `HseArticleVersion` et `HseRelationSource` ; clé unique `graphId:idJSON`. Les types de liens restent `OBSERVATION_DANS` et `REFERENCE_IDENTIFIANT` — **pas** de relation juridique `CITE`.

```powershell
# Aperçu : validation locale uniquement (aucune connexion Neo4j)
npm run graph:import -- --graph "data/graphs\166b806665c9e232c138c800f7b1593cbf9de5c5a5eb82eff563e6c00215ebff.json"

# Application : contraintes IF NOT EXISTS, transaction d'écriture, lecture de contrôle
npm run graph:import -- --graph "data/graphs\166b806665c9e232c138c800f7b1593cbf9de5c5a5eb82eff563e6c00215ebff.json" --apply
```

Sans `--apply` : aucun accès aux variables `HSE_NEO4J_*`. Avec `--apply` : base ciblée par `HSE_NEO4J_DATABASE` ; conflit de propriétés sur une même `key` → échec explicite et annulation (pas d’écrasement silencieux). Relance idempotente sans doublons. Aucune suppression de données Neo4j. Les messages d’erreur de connexion ne exposent ni mot de passe ni URI credentialisée.

Lecture Cypher limitée à un `graphId` :

```cypher
MATCH (a:HseArticleVersion {graphId: $graphId})
OPTIONAL MATCH (a)-[r:OBSERVATION_DANS|REFERENCE_IDENTIFIANT]->(b)
RETURN a, r, b
LIMIT 50;
```

## Structure des données

```
config/
  articles-pilot.json       # lot pilote (versions L4121-1)
  articles-prevention.json  # corpus prévention (4 articles)
data/
  bodies/
  collections/
  normalized/
  batches/                  # rapports de lot <batchId>.json
  comparisons/              # rapports de comparaison <comparisonId>.json
  relation-inventories/     # inventaires de relations <inventoryId>.json
  graphs/                   # graphes JSON locaux <graphId>.json
  passages/                 # passages JSON locaux <passageSetId>.json
```

`.env` et `data/` sont exclus via `.gitignore`.

## Texte des articles dans Neo4j

Après `graph:import --apply`, préparer l'enrichissement depuis les documents normalisés :

```powershell
npm run graph:content -- --graph "data/graphs/<graphId>.json"
```

L'aperçu vérifie localement les identifiants, la collecte, l'empreinte du corps et
la présence de `content.texte` ; il ne contacte pas Neo4j. Pour enrichir les nœuds
collectés de cette instance (avec les mêmes variables `HSE_NEO4J_*` que l'import) :

```powershell
npm run graph:content -- --graph "data/graphs/<graphId>.json" --apply
```

Le texte est repris sans transformation depuis `content.texte`, avec `texteSha256`
et `texteSource`. Le graphe JSON et son identifiant restent inchangés. Les versions
historiques n'ont pas de texte. L'import est transactionnel et refuse un contenu
déjà présent mais différent.

Lecture dans Aura Query :

```cypher
MATCH (a:HseArticleVersion {graphId: '<graphId>', collected: true})
RETURN a.num AS article, a.texte AS texte, a.texteSha256 AS empreinte,
       a.collectionId AS collecte, a.bodySha256 AS corpsSource
ORDER BY article
```

## Passages sourcés (projection locale)

```powershell
npm run graph:passages -- --graph "data/graphs/<graphId>.json"
```

Cette commande découpe le texte brut des articles collectés selon les paragraphes
de `content.texteHtml`. Le HTML sert seulement à trouver les frontières : chaque
passage est une sous-chaîne exacte de `content.texte`, avec offsets, SHA-256,
identifiant déterministe et référence à sa version d'article et sa collecte.
Le découpage est refusé si HTML et texte brut divergent. La sortie est publiée
de façon exclusive dans `data/passages/<passageSetId>.json` ; la relance identique
ne réécrit rien. Aucun appel réseau, aucune modification du graphe ni d'AuraDB.
Les passages ne sont pas des obligations juridiques interprétées.
