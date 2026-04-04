#!/usr/bin/env python3
"""
Script pour corriger le double encodage UTF-8 dans les fichiers sources.
Les caractères UTF-8 ont été mal interprétés comme Latin-1 puis réencodés en UTF-8.
"""
import os
import sys

def fix_double_encoding(text):
    """Corrige le double encodage UTF-8."""
    try:
        # Décoder comme UTF-8, puis encoder en Latin-1, puis redécoder en UTF-8
        # Cela inverse le double encodage
        return text.encode('latin-1').decode('utf-8')
    except (UnicodeDecodeError, UnicodeEncodeError):
        # Si ça échoue, retourner le texte original
        return text

def fix_file(filepath):
    """Corrige l'encodage d'un fichier."""
    print(f"Traitement de {filepath}...")
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Appliquer la correction
        fixed_content = fix_double_encoding(content)
        
        # Vérifier si des changements ont été faits
        if fixed_content != content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(fixed_content)
            print(f"  ✅ Corrigé: {filepath}")
            return True
        else:
            print(f"  ⏭️  Aucun changement: {filepath}")
            return False
    except Exception as e:
        print(f"  ❌ Erreur: {filepath} - {e}")
        return False

def main():
    # Fichiers à corriger
    files_to_fix = [
        r'theia-blueprint\theia-extensions\zones\src\browser\geocache-details-widget.tsx',
        r'theia-blueprint\theia-extensions\zones\src\browser\archive-manager-widget.tsx',
    ]
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    fixed_count = 0
    
    for rel_path in files_to_fix:
        filepath = os.path.join(base_dir, rel_path)
        if os.path.exists(filepath):
            if fix_file(filepath):
                fixed_count += 1
        else:
            print(f"⚠️  Fichier non trouvé: {filepath}")
    
    print(f"\n{'='*60}")
    print(f"Résumé: {fixed_count} fichier(s) corrigé(s)")
    print(f"{'='*60}")

if __name__ == '__main__':
    main()
