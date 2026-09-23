# graphrag-hse

Collecte minimale d’un article via l’**API Légifrance** exposée sur **PISTE** (OAuth2 `client_credentials`), sous Windows (PowerShell), sans Docker ni WSL.

Périmètre actuel : collecte uniquement (pas de Neo4j, embeddings, IA ni interface).

## Prérequis

- Node.js 18+ (testé avec Node 24)
- Compte et application sur [PISTE](https://piste.gouv.fr)
- API **Légifrance** rattachée à votre application (sandbox et/ou production)
- CGU Légifrance acceptées sur le portail

## Installation (PowerShell)

```powershell
cd C:\Users\erwan\code\poc-hse
npm install
Copy-Item .env.example .env
notepad .env
```

Renseignez dans `.env` :

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
3. Dans l’URL du navigateur, repérez un segment du type `LEGIARTI` suivi de chiffres, par exemple dans un chemin `/codes/article_lc/LEGIARTI…` ou équivalent.
4. Copiez **exactement** cet identifiant dans `LEGIFRANCE_ARTICLE_ID`.

Alternative via l’API (une fois authentifié) : la méthode documentée `POST /search` permet d’obtenir un `LEGIARTI…`, puis `POST /consult/getArticle` en consomme le contenu. Cette étape du projet n’implémente que `getArticle`.

Références officielles :

- FAQ / exemples API Légifrance : [Open data et API](https://www.legifrance.gouv.fr/contenu/menu/autour-de-la-loi/open-data-et-api) (documentation DILA, dont `POST /consult/getArticle` avec corps `{ "id": "LEGIARTI…" }`)
- Portail PISTE : [piste.gouv.fr](https://piste.gouv.fr)
- OAuth sandbox : `POST https://sandbox-oauth.piste.gouv.fr/api/oauth/token` (`grant_type=client_credentials`, `scope=openid`)
- API sandbox : base `https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app`
- Production : `https://oauth.piste.gouv.fr/api/oauth/token` et `https://api.piste.gouv.fr/dila/legifrance/lf-engine-app`

## Commandes

```powershell
# Vérification TypeScript
npm run typecheck

# Collecte d’un article
npm run collect
```

## Comportement de la collecte

1. Lecture de `.env`
2. Obtention d’un jeton OAuth2 (`client_credentials`) — le jeton n’est **jamais** affiché ni sauvegardé
3. Appel `POST …/consult/getArticle` avec `{ "id": "<LEGIFRANCE_ARTICLE_ID>" }`
4. En cas de succès uniquement :
   - corps JSON **brut** enregistré sous `data/bodies/<sha256>.json` (déduplication par empreinte)
   - métadonnées sous `data/collections/<horodatage-UTC>_<id>.json` (une trace par collecte réussie)
5. Résumé console : identifiant, numéro d’article, champs de version présents, chemins des fichiers

Une collecte échouée (auth, quota HTTP 429, réseau, timeout, JSON invalide, `article` absent) se termine avec un code de sortie non nul et **n’écrit pas** de succès.

## Structure des données

```
data/
  bodies/          # corps bruts, nommés par SHA-256 (pas de doublon de contenu)
  collections/     # une métadonnée JSON par collecte réussie
```

Métadonnées : date UTC, environnement, identifiant demandé, URL appelée, statut HTTP, SHA-256 du corps, chemins relatifs.

`.env` et `data/` sont exclus via `.gitignore`.
