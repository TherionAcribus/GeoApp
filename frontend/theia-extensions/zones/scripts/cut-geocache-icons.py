#!/usr/bin/env python3
"""
Script pour découper les icônes de géocaches depuis le sprite sheet
Usage: python cut-geocache-icons.py
"""

import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("❌ Erreur : PIL/Pillow n'est pas installé")
    print("📦 Installez-le avec : pip install Pillow")
    sys.exit(1)

# Configuration
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
SPRITE_PATH = PROJECT_ROOT / "src/browser/assets/geocaching-sprite.png"
OUTPUT_DIR = PROJECT_ROOT / "src/browser/assets/geocache-icons"

# Positions des icônes dans le sprite (x, y, largeur, hauteur)
ICONS = [
    ('traditional', 0, 0, 50, 50),
    ('ape', 100, 0, 50, 50),
    ('hq', 200, 0, 50, 50),
    ('multi', 300, 0, 50, 50),
    ('event', 400, 0, 50, 50),
    ('cito', 500, 0, 50, 50),
    ('mega', 600, 0, 50, 50),
    ('giga', 700, 0, 50, 50),
    ('maze', 800, 0, 50, 50),
    ('earth', 900, 0, 50, 50),
    ('virtual', 1000, 0, 50, 50),
    ('webcam', 1100, 0, 50, 50),
    ('locationless', 1200, 0, 50, 50),
    ('mystery', 1300, 0, 50, 50),
    ('letterbox', 1400, 0, 50, 50),
    ('wherigo', 1500, 0, 50, 50),
]

def main():
    print("🗺️  Découpage des icônes de géocaches")
    print("=" * 50)
    
    # Vérifier que le sprite existe
    if not SPRITE_PATH.exists():
        print(f"❌ Erreur : Sprite sheet introuvable")
        print(f"   Cherché dans : {SPRITE_PATH}")
        print("\n💡 Vérifiez que le fichier geocaching-sprite.png existe")
        sys.exit(1)
    
    print(f"✓ Sprite trouvé : {SPRITE_PATH}")
    
    # Créer le dossier de sortie
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"✓ Dossier de sortie : {OUTPUT_DIR}")
    
    # Ouvrir le sprite
    try:
        sprite = Image.open(SPRITE_PATH)
        print(f"✓ Sprite chargé : {sprite.size[0]}x{sprite.size[1]} pixels")
    except Exception as e:
        print(f"❌ Erreur lors de l'ouverture du sprite : {e}")
        sys.exit(1)
    
    # Découper les icônes
    print("\n📐 Découpage en cours...")
    success_count = 0
    
    for name, x, y, w, h in ICONS:
        try:
            # Découper l'icône
            icon = sprite.crop((x, y, x + w, y + h))
            
            # Sauvegarder
            output_path = OUTPUT_DIR / f"{name}.png"
            icon.save(output_path, 'PNG')
            
            print(f"   ✓ {name}.png ({x}, {y}) -> {output_path.name}")
            success_count += 1
            
        except Exception as e:
            print(f"   ❌ Erreur avec {name}: {e}")
    
    # Résumé
    print("\n" + "=" * 50)
    print(f"🎉 Terminé ! {success_count}/{len(ICONS)} icônes créées")
    
    if success_count == len(ICONS):
        print("\n✨ Toutes les icônes ont été découpées avec succès !")
        print("🚀 Vous pouvez maintenant compiler et tester la carte")
    else:
        print(f"\n⚠️  {len(ICONS) - success_count} icône(s) n'ont pas pu être créées")
    
    print(f"\n📁 Icônes sauvegardées dans :")
    print(f"   {OUTPUT_DIR}")

if __name__ == "__main__":
    main()



