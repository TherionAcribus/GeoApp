# Scripts utilitaires

## Découpage des icônes de géocaches

### cut-geocache-icons.py

Script Python pour découper automatiquement les icônes de géocaches depuis le sprite sheet.

#### Prérequis

```bash
pip install Pillow
```

#### Utilisation

```bash
cd theia-blueprint/theia-extensions/zones
python scripts/cut-geocache-icons.py
```

#### Ce que fait le script

1. Charge le sprite sheet depuis `src/browser/assets/geocaching-sprite.png`
2. Découpe 16 icônes individuelles (50x50 pixels)
3. Sauvegarde chaque icône dans `src/browser/assets/geocache-icons/`
4. Affiche un rapport de progression

#### Sortie attendue

```
🗺️  Découpage des icônes de géocaches
==================================================
✓ Sprite trouvé : .../geocaching-sprite.png
✓ Dossier de sortie : .../geocache-icons
✓ Sprite chargé : 1800x200 pixels

📐 Découpage en cours...
   ✓ traditional.png (0, 0) -> traditional.png
   ✓ ape.png (100, 0) -> ape.png
   ...
   ✓ wherigo.png (1500, 0) -> wherigo.png

==================================================
🎉 Terminé ! 16/16 icônes créées

✨ Toutes les icônes ont été découpées avec succès !
🚀 Vous pouvez maintenant compiler et tester la carte
```

#### Icônes créées

- traditional.png - Traditional Cache
- ape.png - Project APE Cache
- hq.png - Groundspeak HQ
- multi.png - Multi-Cache
- event.png - Event Cache
- cito.png - CITO Event
- mega.png - Mega-Event Cache
- giga.png - Giga-Event Cache
- maze.png - GPS Adventures Exhibit
- earth.png - Earthcache
- virtual.png - Virtual Cache
- webcam.png - Webcam Cache
- locationless.png - Locationless Cache
- mystery.png - Mystery Cache
- letterbox.png - Letterbox Hybrid
- wherigo.png - Wherigo Cache

#### Dépannage

**Erreur : Module 'PIL' not found**
```bash
pip install Pillow
# ou
pip3 install Pillow
```

**Erreur : Sprite sheet introuvable**

Vérifiez que le fichier existe :
```bash
ls src/browser/assets/geocaching-sprite.png
```

**Erreur : Permission denied**

Sur Linux/Mac, ajoutez les permissions d'exécution :
```bash
chmod +x scripts/cut-geocache-icons.py
./scripts/cut-geocache-icons.py
```



