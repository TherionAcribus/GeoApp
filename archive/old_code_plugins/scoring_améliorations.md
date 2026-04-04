# **Spécification Technique : Moteur de Scoring Adaptatif (V3)**

Ce document définit l'implémentation du système de scoring pour les plugins de résolution cryptographique. L'objectif est de maximiser la vitesse de traitement par un pipeline de "rejet précoce" (fail-fast) et d'assurer une modularité totale par un système de "Features".

## **1\. Architecture du Pipeline**

Le traitement suit un entonnoir en trois couches de coût computationnel croissant.

### **Couche A : Statistiques de Flux (Coût: $O(1)$)**

*Objectif : Éliminer 80-90% du bruit sans analyse linguistique.*

1. **Indice de Coïncidence (IC) :**  
   * **Calcul :** $\\frac{\\sum n\_i(n\_i-1)}{N(N-1)}$ où $n\_i$ est la fréquence de chaque lettre A-Z.  
   * **Seuil de Veto :** Si $IC \< 0.045$, le texte est considéré comme du bruit aléatoire. Arrêt du scoring sauf si un motif GPS fort est détecté.  
2. **Entropie de Shannon :**  
   * Vérifier si le texte n'est pas trop uniforme (ex: "AAAAA...") ou trop chaotique (bruit binaire).  
3. **GPS Gatekeeper :**  
   * Regex ultra-rapide pour détecter les motifs N/S et E/O/W.  
   * **Validation Numérique Strict :** \* Extraire les nombres.  
     * Vérifier : lat $\\in \[-90, 90\]$, lon $\\in \[-180, 180\]$, minutes/secondes $\< 60$.  
     * Si invalide : Diviser la confiance GPS par 5\.

### **Couche B : Analyse Structurelle (Coût: $O(N)$)**

*Objectif : Valider la structure sans dictionnaire.*

1. **N-Gram Fitness :**  
   * Utiliser des tables de fréquences de quadgrammes (ex: TION, THE , ENDE).  
   * Calcul : Somme des log-probabilités des 4-grams présents dans le texte.  
   * **Avantage :** Détecte la langue même sans espaces ou avec des erreurs de déchiffrement.  
2. **Pénalité de Répétition :**  
   * Détecter les cycles de caractères (caractéristique des mauvais décalages de chiffrements polyalphabétiques).

### **Couche C : Analyse Sémantique (Coût: $O(N \\log N)$)**

*Objectif : Confirmation finale par dictionnaire.*

1. **Détection de Langue (LangID) :**  
   * Utiliser un profilage par trigrammes ou FastText (si texte \> 30 chars).  
2. **Segmentation Adaptative (Wordninja) :**  
   * Uniquement si le texte ne contient pas d'espaces.  
   * Utiliser le modèle de langue détecté en étape 1\.  
3. **Lexical Coverage (Bloom/Set) :**  
   * Vérifier la présence des mots segmentés dans un dictionnaire.  
   * **Zipf Pass :** Si coverage $\> 0.25$, calculer la rareté moyenne des mots. Un texte avec des mots courants (le, la, est) ET des mots rares (cache, coordonnée) score mieux.  
4. **Coherence Factor (Longest Run) :**  
   * Compter le nombre maximum de mots valides consécutifs.  
   * Formule : $Value \= \\min(1.0, \\frac{\\text{max\\\_consecutive}}{5})$.

## **2\. Système de Scoring et Fusion**

Le score final est une **somme pondérée saturée**.

### **Pondérations par défaut**

| Feature | Poids (Wi​) | Seuil Early-Exit |
| :---- | :---- | :---- |
| **GPS\_Confidence** | 0.85 | Si $\> 0.9$ et $IC \> 0.05$ → Exit 0.98 |
| **Lexical\_Coverage** | 0.40 | \- |
| **N-Gram\_Fitness** | 0.30 | Si $\< 0.1$ et pas GPS → Exit 0.05 |
| **Coherence** | 0.20 | \- |

### **Formule de Fusion**

$$Score \= \\min \\left( 1.0, \\sum (V\_i \\times W\_i) \+ \\text{Bonus}\_{\\text{Combo}} \\right)$$

* **Bonus Combo :** Si GPS\_Confidence \> 0.7 ET Lexical\_Coverage \> 0.3 $\\implies$ Bonus $+0.2$.

## **3\. Gestion des Ressources (Multilingue)**

L'IDE doit charger les ressources dynamiquement :

* **Dictionnaires :** Formats JSON ou Bloom Filter (pour économiser la RAM).  
* **N-Grams :** Tables de fréquences par langue.  
* **Stopwords :** Liste de mots à ignorer (directions N, S, E, W, etc.) pour ne pas fausser le score lexical.

## **4\. Recommandations d'implémentation pour l'IA**

1. **Lazy Loading :** Ne charger les dictionnaires de la Couche C que si un candidat passe la Couche A.  
2. **Multithreading :** Le scoring de chaque rotation (pour César/Vigenère) doit être parallélisé.  
3. **Cache LRU :** Implémenter un cache de taille 1000 pour les hashes de textes déjà scorés.  
4. **Normalisation :** Toujours transformer en majuscules et supprimer la ponctuation avant le calcul de l'IC et des N-Grams.

## **5\. Cas de test attendus**

* **Succès GPS :** N 48° 12.345 E 002° 00.123 $\\to$ Score $\\approx 0.9$  
* **Succès Texte :** LA CACHE SE TROUVE SOUS LE PONT $\\to$ Score $\\approx 0.8$  
* **Faux Positif GPS :** N 95° 82.345 (Invalide numérique) $\\to$ Score $\\approx 0.1$  
* **Bruit :** XJ12\! FS QLM $\\to$ Score $\\approx 0.0$