/**
 * Déclarations de types pour l'API Font Loading.
 * Étend l'interface Document avec les méthodes de gestion des polices.
 */
declare global {
    interface Document {
        fonts: FontFaceSet;
    }

    interface FontFaceSet {
        add(font: FontFace): FontFaceSet;
        load(font: string, text?: string): Promise<FontFace[]>;
        ready: Promise<FontFaceSet>;
    }
}

export {};


