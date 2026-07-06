---
title: "Se connecter à Geocaching.com"
description: "Pourquoi et comment connecter GeoApp à votre compte Geocaching.com : identifiants ou cookies navigateur, mémorisation sécurisée, statut, déconnexion et dépannage."
chapter: getting-started
order: 25
tags: [connexion, authentification, geocaching, identifiants, cookies, mot de passe, sécurité, captcha, import, pocket query, notes, coordonnées]
---

# Se connecter à Geocaching.com

GeoApp n'utilise pas (encore) l'API officielle de Geocaching.com : il se connecte au site comme le ferait votre navigateur, avec votre compte. Cette connexion est nécessaire pour importer des géocaches depuis votre compte, récupérer les logs et votre note personnelle, ou renvoyer vos coordonnées corrigées.

Vous n'avez besoin de vous connecter qu'**une seule fois** : GeoApp mémorise ensuite votre session.

## Ouvrir le panneau de connexion

Trois façons d'y accéder :

- **Icône en bas de la barre d'activité gauche** — une icône de compte change d'aspect selon votre statut : déconnecté (icône « débranché ») ou connecté (icône de compte). Cliquez dessus puis choisissez **Gérer la connexion**.
- **Menu Aide** → recherchez la commande depuis la palette de commandes (`Ctrl+Shift+P`) → `GeoApp: Connexion Geocaching.com`.
- Cette icône est visible en permanence, quel que soit l'onglet ouvert.

Le panneau **Connexion Geocaching.com** s'ouvre dans la zone principale.

## Se connecter avec vos identifiants (recommandé)

C'est la méthode la plus fiable, indépendante de votre navigateur.

1. Dans le panneau, choisissez l'onglet **Identifiants**.
2. Saisissez votre **nom d'utilisateur ou email** Geocaching.com et votre **mot de passe**.
3. Laissez la case **Se souvenir de moi** cochée pour ne pas avoir à vous reconnecter à chaque démarrage.
4. Cliquez sur **Se connecter**.

Si les identifiants sont corrects, votre statut passe à **Connecté** et votre profil (pseudo, type de compte, statistiques) s'affiche.

## Se connecter avec les cookies de votre navigateur

Une méthode alternative, utile si Geocaching.com bloque le login par identifiants (captcha).

1. **Connectez-vous d'abord normalement sur geocaching.com dans votre navigateur** (Firefox, Chrome ou Edge).
2. Dans GeoApp, choisissez l'onglet **Cookies navigateur**.
3. Sélectionnez votre navigateur (ou laissez **Auto** pour que GeoApp les essaie dans l'ordre).
4. Cliquez sur **Se connecter**.

GeoApp lit alors les cookies de session déjà présents dans votre navigateur — rien n'est demandé à Geocaching.com à ce stade, aucun risque de captcha.

> **Important :** contrairement à la méthode identifiants, GeoApp ne relit **jamais automatiquement** les cookies de votre navigateur en arrière-plan. C'est toujours vous qui déclenchez cette relecture en cliquant sur **Se connecter** — sinon GeoApp pourrait sembler connecté simplement parce que votre navigateur a une session ouverte.

## Votre statut de connexion et vos statistiques

Une fois connecté, le panneau affiche :

- votre **pseudo**, votre **avatar** et votre **type de compte** (Basic / Premium) ;
- vos statistiques : **caches trouvées**, **points favoris disponibles à distribuer**.

Cliquez sur **Rafraîchir les stats** pour forcer une mise à jour (les statistiques sont mises en cache quelques minutes).

## Se déconnecter ou oublier le compte

Deux boutons, pour deux usages différents :

| Bouton | Effet |
|---|---|
| **Déconnexion** | Ferme la session en cours. Votre compte reste mémorisé : GeoApp **se reconnectera automatiquement** au prochain démarrage. |
| **Oublier** | Supprime définitivement les identifiants enregistrés (et la session). Il faudra vous reconnecter manuellement la prochaine fois. |

Utilisez **Oublier** si vous changez de compte Geocaching.com ou si vous partagez cet ordinateur.

## Ce qui nécessite d'être connecté

| Fonctionnalité | Où |
|---|---|
| Importer une **Pocket Query** | Menu `GeoApp > Importer > Importer une Pocket Query` |
| Importer une **liste de favoris** | Menu `GeoApp > Importer > Importer une liste de favoris` |
| Importer **autour d'un point** | Menu `GeoApp > Importer > Importer autour d'un point` |
| Ajouter une géocache par son **code GC** | Bouton **+** du panneau Zones, ou `@Aide` (« Ajoute GC12345 à la zone... ») |
| Récupérer les **logs** d'une géocache | Onglet détail de la géocache → Logs → Rafraîchir |
| Lire/écrire votre **note personnelle** Geocaching.com | Onglet détail de la géocache → Notes |
| Envoyer des **coordonnées corrigées** vers Geocaching.com | Onglet détail de la géocache → Coordonnées |
| Utiliser certains **checkers** (GeoCheck via navigateur automatisé) | Panneau des checkers |

> L'import depuis un **fichier GPX** que vous avez déjà téléchargé, lui, ne nécessite **pas** d'être connecté dans GeoApp.

## Sécurité : ce que GeoApp fait de votre mot de passe

- Votre mot de passe **n'est jamais écrit en clair sur le disque**. Il est confié au gestionnaire d'identifiants sécurisé de votre système d'exploitation (le **Gestionnaire d'informations d'identification Windows**, ou équivalent sous macOS/Linux) — le même mécanisme que celui utilisé par votre navigateur pour retenir vos mots de passe.
- Seuls votre nom d'utilisateur et la méthode de connexion choisie sont conservés dans un fichier de configuration local.
- La méthode **cookies navigateur** ne lit vos cookies qu'au moment où vous cliquez sur **Se connecter** — jamais en tâche de fond.

## Résoudre les problèmes de connexion

**« Captcha requis »**
Geocaching.com demande une vérification anti-robot. Un bouton **Utiliser les cookies du navigateur** apparaît directement dans le formulaire : connectez-vous dans votre navigateur puis utilisez cette méthode pour contourner le blocage (voir [Se connecter avec les cookies de votre navigateur](#se-connecter-avec-les-cookies-de-votre-navigateur)).

**« Échec de connexion »**
Vérifiez votre nom d'utilisateur/email et votre mot de passe. Si le problème persiste, essayez la méthode cookies navigateur.

**« Compte non validé »**
Votre compte Geocaching.com n'a pas encore confirmé son adresse email. Vérifiez votre boîte mail pour le lien de validation Geocaching.com.

**Le statut reste « Déconnecté » alors que je viens de me connecter dans mon navigateur**
La méthode cookies n'est jamais automatique (voir l'encart ci-dessus) : rouvrez le panneau de connexion et cliquez à nouveau sur **Se connecter**.

**Un import ou une action échoue avec une erreur 401**
Votre session a expiré. Rouvrez le panneau de connexion : GeoApp tente de se reconnecter automatiquement avec vos identifiants enregistrés ; sinon, reconnectez-vous manuellement.

---

→ Poursuivez avec [Créer votre première zone](./first-zone.md) pour importer vos premières géocaches.
