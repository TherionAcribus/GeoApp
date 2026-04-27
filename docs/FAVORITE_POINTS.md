# Gestion des Points Favoris (PF)

Ce document décrit comment GeoApp récupère et affiche les Points Favoris disponibles pour un compte Geocaching.

## 1. Collecte côté backend

1. **Service** : `gc_backend/services/geocaching_auth.py`
2. Lors d'un rafraîchissement des stats (`/api/auth/profile`), le backend :
   - tente d'abord l'API officielle `/api/proxy/web/v1/users/me` ;
   - en cas d'erreur (500 fréquent), bascule vers un scraping du dashboard `/account/dashboard`.
3. Dans le HTML du dashboard, nous cherchons explicitement les libellés actuels :
   ```js
   favoritePointSummary: {"Total":1875,"Available":36,"LogsNeededToNext":9}
   ```
   C'est la source prioritaire, utilisée par le JavaScript du dashboard pour rendre :
   ```html
   <li>Remaining points: <strong>36</strong></li>
   <li>Logs until next point: <strong>9</strong></li>
   <li>Total Favorite points: <strong>1875</strong></li>
   ```
   `Remaining points` alimente les PF disponibles (`awarded_favorite_points`) et
   `Total Favorite points` alimente le total (`favorite_points`). Les anciens libellés
   restent en fallback.
4. Le champ extrait est stocké dans `auth_state.user_info.awarded_favorite_points` et renvoyé
   par l'API `/api/auth/profile`.

## 2. Stockage et cache

- Les stats sont conservées dans `UserInfo` avec un horodatage `stats_last_updated`.
- Le cache est rafraîchi à la demande (bouton "Rafraîchir les stats") ou après chaque login.

## 3. Affichage côté frontend

1. **Widget** : `theia-extensions/zones/src/browser/geocaching-auth-widget.tsx`
2. Lorsque l'utilisateur est connecté :
   - le widget appelle `fetchProfileStatsQuietly()` après `fetchAuthStatus()` ;
   - la tuile "PF disponibles" lit `user.awarded_favorite_points`.
3. Seules deux stats sont affichées aujourd'hui :
   - `Trouvées` (`finds_count`),
   - `PF disponibles` (`awarded_favorite_points`).

## 4. Tests rapides

1. Ouvrir le widget Geocaching dans Theia.
2. Cliquer sur **« Rafraîchir les stats »**.
3. Vérifier que l'API `/api/auth/profile/refresh` renvoie `awarded_favorite_points` avec la valeur `Remaining points`.
4. Confirmer que la tuile "PF disponibles" affiche la même valeur.

## 5. Points d'attention

- Le scraping dépend de la structure HTML du dashboard et peut nécessiter une mise à jour si Geocaching.com modifie sa page.
- En cas d'échec complet (API + dashboard), le champ reste `null` côté frontend.
- L'utilisateur peut forcer un nouveau scraping via l'endpoint `/api/auth/profile/refresh` ou le bouton "Rafraîchir les stats".
