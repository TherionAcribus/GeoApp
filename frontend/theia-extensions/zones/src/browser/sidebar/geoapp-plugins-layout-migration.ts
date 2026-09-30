/**
 * Fonction pure de migration du widget Plugins (spec §8 — testable sans DOM).
 * `GeoAppPluginsLayoutTransformer` l'appelle depuis `transformLayoutOnRestore`.
 */

export const LEGACY_PLUGINS_FACTORY_ID = 'vsx-extensions-view-container';
export const PLUGINS_FACTORY_ID = 'mysterai-plugins-browser';

/**
 * Parcours récursif des données de layout persistées : renomme le
 * `constructionOptions.factoryId` de l'ancien widget Plugins vers le nouveau,
 * où qu'il soit (panneau latéral, principal, perspectif…).
 *
 * @returns le nombre de descriptions renommées.
 */
export function renameLegacyPluginsFactoryId(node: unknown): number {
    if (Array.isArray(node)) {
        return node.reduce((count, item) => count + renameLegacyPluginsFactoryId(item), 0);
    }
    if (!node || typeof node !== 'object') {
        return 0;
    }
    const record = node as Record<string, unknown>;
    const constructionOptions = record['constructionOptions'] as { factoryId?: string } | undefined;
    let renamed = 0;
    if (constructionOptions?.factoryId === LEGACY_PLUGINS_FACTORY_ID) {
        constructionOptions.factoryId = PLUGINS_FACTORY_ID;
        renamed = 1;
    }
    for (const value of Object.values(record)) {
        renamed += renameLegacyPluginsFactoryId(value);
    }
    return renamed;
}
