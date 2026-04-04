# Icônes de Géocaches

Ce dossier contient les icônes individuelles de géocaches utilisées sur la carte OpenLayers.

## Instructions

Placez les icônes découpées depuis le sprite sheet `geocaching-sprite.png` dans ce dossier.

Chaque icône doit être nommée selon la clé correspondante définie dans `geocache-icon-config.ts` :

- `traditional.png` - Traditional Cache
- `multi.png` - Multi-Cache
- `mystery.png` - Mystery/Unknown Cache
- `letterbox.png` - Letterbox Hybrid
- `wherigo.png` - Wherigo Cache
- `earth.png` - Earthcache
- `virtual.png` - Virtual Cache
- `webcam.png` - Webcam Cache
- `event.png` - Event Cache
- `cito.png` - CITO Event
- `mega.png` - Mega-Event
- `giga.png` - Giga-Event
- `ape.png` - Project APE
- `hq.png` - Groundspeak HQ
- `unknown.png` - Type inconnu (fallback)

## Format recommandé

- Taille : 50x50 pixels
- Format : PNG avec transparence
- Fond : Transparent

## Découpage du sprite

Le sprite original se trouve dans `../geocaching-sprite.png`.

Vous pouvez utiliser un outil de découpage comme :
- ImageMagick
- Photoshop / GIMP
- Un script Python avec PIL/Pillow
- Un outil en ligne comme Sprite Cow

## Exemple de découpage avec ImageMagick

```bash
# Traditional Cache (position 0,0)
convert geocaching-sprite.png -crop 50x50+0+0 traditional.png

# Multi-Cache (position 300,0)
convert geocaching-sprite.png -crop 50x50+300+0 multi.png

# etc.
```

## Exemple de découpage avec Python

```python
from PIL import Image

sprite = Image.open('geocaching-sprite.png')
icons = [
    ('traditional', 0, 0),
    ('ape', 100, 0),
    ('hq', 200, 0),
    ('multi', 300, 0),
    ('event', 400, 0),
    ('cito', 500, 0),
    ('mega', 600, 0),
    ('giga', 700, 0),
    ('maze', 800, 0),
    ('earth', 900, 0),
    ('virtual', 1000, 0),
    ('webcam', 1100, 0),
    ('locationless', 1200, 0),
    ('mystery', 1300, 0),
    ('letterbox', 1400, 0),
    ('wherigo', 1500, 0),
]

for name, x, y in icons:
    icon = sprite.crop((x, y, x + 50, y + 50))
    icon.save(f'{name}.png')
```

## Note

Si les icônes ne sont pas trouvées, la carte utilisera des cercles de couleur comme fallback.



