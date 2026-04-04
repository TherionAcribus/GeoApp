/**
 * Script pour générer un fichier TypeScript contenant toutes les icônes d'attributs en base64
 * Usage: node scripts/generate-attribute-icons-data.js
 */

const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '../src/browser/assets/geocache-attributes');
const OUTPUT_FILE = path.join(__dirname, '../src/browser/geocache-attributes-icons-data.ts');

// Lire tous les fichiers PNG du dossier
const files = fs.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.png'));

console.log(`Génération des données pour ${files.length} icônes d'attributs...`);

// Générer le contenu du fichier TypeScript
let content = `/**
 * Données des icônes d'attributs de géocaches encodées en base64
 * Ce fichier est généré automatiquement par scripts/generate-attribute-icons-data.js
 * NE PAS MODIFIER MANUELLEMENT
 */

export const ATTRIBUTE_ICONS_DATA: Record<string, string> = {
`;

files.forEach(file => {
    const filePath = path.join(ASSETS_DIR, file);
    const base64 = fs.readFileSync(filePath, 'base64');
    const key = file.replace('.png', '');
    const dataUrl = `data:image/png;base64,${base64}`;
    content += `    '${key}': '${dataUrl}',\n`;
});

content += `};\n\n`;

content += `/**
 * Récupère l'URL d'une icône d'attribut
 * @param filename - Nom du fichier (sans extension .png)
 * @returns L'URL de l'icône ou undefined si non trouvée
 */
export function getAttributeIconUrl(filename: string): string | undefined {
    return ATTRIBUTE_ICONS_DATA[filename];
}

/**
 * Vérifie si une icône d'attribut existe
 * @param filename - Nom du fichier (sans extension .png)
 * @returns true si l'icône existe
 */
export function hasAttributeIcon(filename: string): boolean {
    return filename in ATTRIBUTE_ICONS_DATA;
}
`;

// Écrire le fichier
fs.writeFileSync(OUTPUT_FILE, content, 'utf8');

console.log(`✓ Fichier généré: ${OUTPUT_FILE}`);
console.log(`✓ ${files.length} icônes encodées en base64`);
