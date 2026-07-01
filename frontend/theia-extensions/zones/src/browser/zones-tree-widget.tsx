import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ConfirmDialog, Dialog, SingleTextInputDialog } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';
import { PreferenceChange, PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { ContextMenu, ContextMenuItem } from './context-menu';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { GeocacheIcon } from './geocache-icon';
import { GeocacheTabsManager } from './geocache-tabs-manager';
import { ZoneTabsManager } from './zone-tabs-manager';
import { ZonesService, ZoneDto } from './zones-service';
import { GeocachesService } from './geocaches-service';
import { GeoAppWidgetEventsService } from './geoapp-widget-events-service';
import { getErrorMessage } from './backend-api-client';

import '../../src/browser/style/zones-tree.css';

type GeocacheDto = {
    id: number;
    gc_code: string;
    name: string;
    cache_type: string;
    difficulty: number;
    terrain: number;
    found: boolean;
    created_at?: string | null;
};

type GeocacheSortKey = 'gc_code' | 'name' | 'cache_type' | 'created_at';

interface GeocacheSortPreference {
    key: GeocacheSortKey;
    direction: ZoneSortDirection;
}

const GEOCACHE_SORT_KEY_PREFERENCE = 'geoApp.zones.geocacheSortKey';
const GEOCACHE_SORT_DIRECTION_PREFERENCE = 'geoApp.zones.geocacheSortDirection';
const DEFAULT_GEOCACHE_SORT: GeocacheSortPreference = { key: 'gc_code', direction: 'asc' };
const GEOCACHE_SORT_OPTIONS: Array<{ key: GeocacheSortKey; label: string }> = [
    { key: 'gc_code', label: 'Code GC' },
    { key: 'name', label: 'Titre de la cache' },
    { key: 'cache_type', label: 'Type de cache' },
    { key: 'created_at', label: 'Date d\'ajout' },
];

/** Type MIME du glisser-déposer interne d'une géocache (disponible dans dragover via dataTransfer.types). */
const GEOCACHE_DND_MIME = 'application/x-geoapp-geocache';

type ZoneSortKey =
    | 'name'
    | 'created_at'
    | 'geocaches_count'
    | 'latest_geocache_created_at'
    | 'latest_resolution_updated_at';

type ZoneSortDirection = 'asc' | 'desc';

interface ZoneSortPreference {
    key: ZoneSortKey;
    direction: ZoneSortDirection;
}

const ZONE_SORT_PREFERENCE_KEY = 'geoApp.zones.sort';
const DEFAULT_ZONE_SORT: ZoneSortPreference = { key: 'name', direction: 'asc' };
const ZONE_SORT_OPTIONS: Array<{ key: ZoneSortKey; label: string }> = [
    { key: 'name', label: 'Nom' },
    { key: 'created_at', label: 'Creation' },
    { key: 'geocaches_count', label: 'Nombre de caches' },
    { key: 'latest_geocache_created_at', label: 'Derniere cache ajoutee' },
    { key: 'latest_resolution_updated_at', label: 'Derniere resolution' },
];

@injectable()
export class ZonesTreeWidget extends ReactWidget {
    static readonly ID = 'zones.tree.widget';

    protected zones: ZoneDto[] = [];
    protected activeZoneId: number | undefined;
    protected expandedZones: Set<number> = new Set();
    protected zoneGeocaches: Map<number, GeocacheDto[]> = new Map();
    protected loadingZones: Set<number> = new Set();
    protected contextMenu: { items: ContextMenuItem[]; x: number; y: number } | null = null;
    protected moveDialog: { geocache: GeocacheDto; zoneId: number } | null = null;
    protected copyDialog: { geocache: GeocacheDto; zoneId: number } | null = null;
    protected mergeDialog: { zone: ZoneDto } | null = null;
    protected zoneSort: ZoneSortPreference = { ...DEFAULT_ZONE_SORT };
    protected geocacheSort: GeocacheSortPreference = { ...DEFAULT_GEOCACHE_SORT };
    /** Élément actuellement "actif" pour la navigation clavier (aria-activedescendant). */
    protected activeItemId: string | undefined;
    /** Vrai quand l'arbre a le focus clavier (pour n'afficher l'anneau de focus qu'alors). */
    protected treeFocused = false;
    /** Géocache en cours de glisser-déposer (avec sa zone source), ou null. */
    protected draggingGeocache: { geocache: GeocacheDto; sourceZoneId: number } | null = null;
    /** Zone actuellement survolée comme cible de dépôt (pour la mise en surbrillance). */
    protected dropTargetZoneId: number | undefined;
    protected readonly zoneNameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    /** Vrai pendant que CE widget émet requestZonesRefresh, pour ignorer son propre événement. */
    private selfTriggeringZonesRefresh = false;

    protected readonly handleGeocacheLogSubmitted = (event: CustomEvent<{ geocacheId: number; found?: boolean }>): void => {
        const detail = event?.detail;
        const geocacheId = detail?.geocacheId;
        const found = detail?.found;
        if (typeof geocacheId !== 'number' || found !== true) {
            return;
        }

        let changed = false;
        for (const [zoneId, geocaches] of this.zoneGeocaches.entries()) {
            if (!geocaches || geocaches.length === 0) {
                continue;
            }
            const idx = geocaches.findIndex(g => g.id === geocacheId);
            if (idx < 0) {
                continue;
            }
            const current = geocaches[idx];
            if (current?.found === true) {
                continue;
            }
            const next = { ...current, found: true };
            this.zoneGeocaches.set(zoneId, [...geocaches.slice(0, idx), next, ...geocaches.slice(idx + 1)]);
            changed = true;
        }

        if (changed) {
            this.update();
        }
    };

    constructor(
        @inject(GeocacheTabsManager) protected readonly geocacheTabsManager: GeocacheTabsManager,
        @inject(ZoneTabsManager) protected readonly zoneTabsManager: ZoneTabsManager,
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(ZonesService) protected readonly zonesService: ZonesService,
        @inject(GeocachesService) protected readonly geocachesService: GeocachesService,
        @inject(GeoAppWidgetEventsService) protected readonly widgetEventsService: GeoAppWidgetEventsService,
    ) {
        super();
        this.id = ZonesTreeWidget.ID;
        this.title.closable = true;
        this.title.label = 'Zones';
        this.title.caption = 'Zones';
        this.title.iconClass = 'fa fa-map-marker';
        this.addClass('theia-zones-tree-widget');
        this.zoneSort = this.readZoneSortPreference();
        this.geocacheSort = this.readGeocacheSortPreference();
        this.toDispose.push(this.preferenceService.onPreferenceChanged(event => this.handlePreferenceChanged(event)));
        this.toDispose.push(this.widgetEventsService.onDidRequestZonesRefresh(() => {
            if (this.selfTriggeringZonesRefresh) {
                return;
            }
            void this.refreshExpandedZones();
        }));
        this.toDispose.push(this.widgetEventsService.onDidChangeGeocache(() => {
            void this.refreshExpandedZones();
        }));
    }

    protected readZoneSortPreference(): ZoneSortPreference {
        const raw = this.preferenceService.get<unknown>(ZONE_SORT_PREFERENCE_KEY, DEFAULT_ZONE_SORT);
        return this.normalizeZoneSortPreference(raw);
    }

    protected normalizeZoneSortPreference(raw: unknown): ZoneSortPreference {
        if (!raw || typeof raw !== 'object') {
            return { ...DEFAULT_ZONE_SORT };
        }

        const candidate = raw as Partial<ZoneSortPreference>;
        return {
            key: this.isZoneSortKey(candidate.key) ? candidate.key : DEFAULT_ZONE_SORT.key,
            direction: candidate.direction === 'desc' ? 'desc' : 'asc',
        };
    }

    protected isZoneSortKey(value: unknown): value is ZoneSortKey {
        return typeof value === 'string' && ZONE_SORT_OPTIONS.some(option => option.key === value);
    }

    protected readGeocacheSortPreference(): GeocacheSortPreference {
        const key = this.preferenceService.get<unknown>(GEOCACHE_SORT_KEY_PREFERENCE, DEFAULT_GEOCACHE_SORT.key);
        const direction = this.preferenceService.get<unknown>(GEOCACHE_SORT_DIRECTION_PREFERENCE, DEFAULT_GEOCACHE_SORT.direction);
        return {
            key: this.isGeocacheSortKey(key) ? key : DEFAULT_GEOCACHE_SORT.key,
            direction: direction === 'desc' ? 'desc' : 'asc',
        };
    }

    protected isGeocacheSortKey(value: unknown): value is GeocacheSortKey {
        return typeof value === 'string' && GEOCACHE_SORT_OPTIONS.some(option => option.key === value);
    }

    protected setGeocacheSort(nextSort: Partial<GeocacheSortPreference>): void {
        const next: GeocacheSortPreference = {
            key: this.isGeocacheSortKey(nextSort.key) ? nextSort.key : this.geocacheSort.key,
            direction: nextSort.direction === 'asc' || nextSort.direction === 'desc'
                ? nextSort.direction
                : this.geocacheSort.direction,
        };
        if (next.key === this.geocacheSort.key && next.direction === this.geocacheSort.direction) {
            return;
        }

        this.geocacheSort = next;
        this.update();
        void this.preferenceService.set(GEOCACHE_SORT_KEY_PREFERENCE, next.key, PreferenceScope.User)
            .catch(error => console.warn('[ZonesTreeWidget] Failed to persist geocache sort key', error));
        void this.preferenceService.set(GEOCACHE_SORT_DIRECTION_PREFERENCE, next.direction, PreferenceScope.User)
            .catch(error => console.warn('[ZonesTreeWidget] Failed to persist geocache sort direction', error));
    }

    protected handlePreferenceChanged(event: PreferenceChange): void {
        if (event.preferenceName === ZONE_SORT_PREFERENCE_KEY) {
            this.zoneSort = this.readZoneSortPreference();
            this.update();
            return;
        }
        if (event.preferenceName === GEOCACHE_SORT_KEY_PREFERENCE
            || event.preferenceName === GEOCACHE_SORT_DIRECTION_PREFERENCE) {
            this.geocacheSort = this.readGeocacheSortPreference();
            this.update();
        }
    }

    protected setZoneSort(nextSort: Partial<ZoneSortPreference>): void {
        const next = this.normalizeZoneSortPreference({
            ...this.zoneSort,
            ...nextSort,
        });
        if (next.key === this.zoneSort.key && next.direction === this.zoneSort.direction) {
            return;
        }

        this.zoneSort = next;
        this.update();
        void this.preferenceService.set(ZONE_SORT_PREFERENCE_KEY, next, PreferenceScope.User)
            .catch(error => console.warn('[ZonesTreeWidget] Failed to persist zone sort preference', error));
    }

    protected toggleZoneSortDirection(): void {
        this.setZoneSort({ direction: this.zoneSort.direction === 'asc' ? 'desc' : 'asc' });
    }

    onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        if (typeof window !== 'undefined') {
            window.addEventListener('geoapp-geocache-log-submitted', this.handleGeocacheLogSubmitted as EventListener);
        }
        this.refresh();
    }

    protected onBeforeDetach(msg: any): void {
        if (typeof window !== 'undefined') {
            window.removeEventListener('geoapp-geocache-log-submitted', this.handleGeocacheLogSubmitted as EventListener);
        }
        super.onBeforeDetach(msg);
    }

    public async refresh(): Promise<void> {
        try {
            const [zones, activeZone] = await Promise.all([
                this.zonesService.list<ZoneDto>(),
                this.zonesService.getActiveZone()
            ]);
            this.zones = zones;
            this.activeZoneId = typeof activeZone?.id === 'number' ? activeZone.id : undefined;

            this.update();
        } catch (e) {
            console.error('Zones: fetch error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors du chargement des zones'));
        }
    }

    protected getSortedZones(): ZoneDto[] {
        return [...this.zones].sort((a, b) => this.compareZones(a, b));
    }

    protected compareZones(a: ZoneDto, b: ZoneDto): number {
        const direction = this.zoneSort.direction === 'asc' ? 1 : -1;
        if (this.zoneSort.key === 'name') {
            return (this.compareZoneNames(a, b) * direction) || (a.id - b.id);
        }

        const aValue = this.getZoneSortNumber(a, this.zoneSort.key);
        const bValue = this.getZoneSortNumber(b, this.zoneSort.key);

        if (aValue === undefined && bValue === undefined) {
            return this.compareZoneNames(a, b) || (a.id - b.id);
        }
        if (aValue === undefined) {
            return 1;
        }
        if (bValue === undefined) {
            return -1;
        }
        if (aValue !== bValue) {
            return (aValue - bValue) * direction;
        }
        return this.compareZoneNames(a, b) || (a.id - b.id);
    }

    protected compareZoneNames(a: ZoneDto, b: ZoneDto): number {
        return this.zoneNameCollator.compare(a.name || '', b.name || '');
    }

    protected getZoneSortNumber(zone: ZoneDto, key: ZoneSortKey): number | undefined {
        switch (key) {
            case 'created_at':
                return this.getDateTimestamp(zone.created_at);
            case 'geocaches_count':
                return Number(zone.geocaches_count ?? 0);
            case 'latest_geocache_created_at':
                return this.getDateTimestamp(zone.latest_geocache_created_at);
            case 'latest_resolution_updated_at':
                return this.getDateTimestamp(zone.latest_resolution_updated_at);
            default:
                return undefined;
        }
    }

    protected getDateTimestamp(value: string | null | undefined): number | undefined {
        if (!value) {
            return undefined;
        }
        const timestamp = Date.parse(value);
        return Number.isFinite(timestamp) ? timestamp : undefined;
    }

    protected getSortedGeocaches(geocaches: GeocacheDto[]): GeocacheDto[] {
        const { key, direction } = this.geocacheSort;
        const sign = direction === 'asc' ? 1 : -1;

        const getText = (geocache: GeocacheDto): string => {
            switch (key) {
                case 'name':
                    return geocache.name || '';
                case 'cache_type':
                    return geocache.cache_type || '';
                default:
                    return geocache.gc_code || '';
            }
        };

        return [...geocaches].sort((a, b) => {
            let comparison = 0;
            if (key === 'created_at') {
                const aTime = this.getDateTimestamp(a.created_at);
                const bTime = this.getDateTimestamp(b.created_at);
                // Les caches sans date connue sont toujours reléguées en fin de liste.
                if (aTime === undefined && bTime === undefined) {
                    comparison = 0;
                } else if (aTime === undefined) {
                    return 1;
                } else if (bTime === undefined) {
                    return -1;
                } else {
                    comparison = aTime - bTime;
                }
            } else {
                comparison = this.zoneNameCollator.compare(getText(a), getText(b));
            }

            if (comparison !== 0) {
                return comparison * sign;
            }
            // Départage stable: code GC puis id.
            return this.zoneNameCollator.compare(a.gc_code || '', b.gc_code || '') || (a.id - b.id);
        });
    }

    protected async loadGeocachesForZone(zoneId: number, options: { force?: boolean } = {}): Promise<void> {
        const alreadyLoaded = this.zoneGeocaches.has(zoneId);
        if (alreadyLoaded && !options.force) {
            return; // Déjà en cache
        }

        // Spinner uniquement au premier chargement: lors d'un rafraîchissement
        // d'une zone déjà affichée, on conserve l'ancienne liste jusqu'à l'arrivée
        // des données fraîches (pas de flash "Chargement...").
        if (!alreadyLoaded) {
            this.loadingZones.add(zoneId);
            this.update();
        }

        try {
            const geocaches = await this.zonesService.listGeocachesTree<GeocacheDto>(zoneId);
            this.zoneGeocaches.set(zoneId, geocaches);
        } catch (e) {
            console.error('[ZonesTreeWidget] Failed to load geocaches for zone', zoneId, e);
            this.messages.error('Erreur lors du chargement des géocaches');
        } finally {
            this.loadingZones.delete(zoneId);
            this.update();
        }
    }

    protected async toggleZone(zoneId: number): Promise<void> {
        if (this.expandedZones.has(zoneId)) {
            this.expandedZones.delete(zoneId);
        } else {
            this.expandedZones.add(zoneId);
            await this.loadGeocachesForZone(zoneId);
        }
        this.update();
    }

    protected async openZoneTable(zone: ZoneDto): Promise<void> {
        try {
            await this.zonesService.setActiveZone(zone.id);
            this.activeZoneId = zone.id;
            this.update();
            await this.zoneTabsManager.openZone({ zoneId: zone.id, zoneName: zone.name });
        } catch (error) {
            console.error('Failed to open ZoneGeocachesWidget:', error);
            this.messages.error(getErrorMessage(error, 'Impossible d\'ouvrir le tableau de la zone'));
        }
    }

    protected async openGeocacheDetails(geocache: GeocacheDto): Promise<void> {
        try {
            await this.geocacheTabsManager.openGeocacheDetails({
                geocacheId: geocache.id,
                name: geocache.name
            });
        } catch (error) {
            console.error('Failed to open GeocacheDetailsWidget:', error);
            this.messages.error('Impossible d\'ouvrir les détails de la géocache');
        }
    }

    protected async deleteZone(zone: ZoneDto): Promise<void> {
        const count = zone.geocaches_count ?? 0;
        const msg = count > 0
            ? `Voulez-vous vraiment supprimer la zone "${zone.name}" et ses ${count} géocache${count > 1 ? 's' : ''} ? Cette action est irréversible.`
            : `Voulez-vous vraiment supprimer la zone "${zone.name}" ?`;
        const dialog = new ConfirmDialog({
            title: 'Supprimer la zone',
            msg,
            ok: Dialog.OK,
            cancel: Dialog.CANCEL
        });

        const confirmed = await dialog.open();
        if (!confirmed) {
            return;
        }

        try {
            await this.zonesService.delete(zone.id);

            if (this.activeZoneId === zone.id) {
                await this.zonesService.setActiveZone(null);
                this.activeZoneId = undefined;
            }

            // Nettoyer les données de la zone supprimée
            this.expandedZones.delete(zone.id);
            this.zoneGeocaches.delete(zone.id);
            await this.refresh();
            this.widgetEventsService.notifyZoneListChanged();
            this.messages.info(`Zone "${zone.name}" supprimée`);
        } catch (e) {
            console.error('Zones: delete error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de la suppression de la zone'));
        }
    }

    protected async renameZone(zone: ZoneDto): Promise<void> {
        const nextName = await this.openZoneNameDialog({
            title: 'Renommer la zone',
            initialValue: zone.name,
            confirmButtonLabel: 'Renommer',
            currentZoneId: zone.id
        });
        if (!nextName || nextName === zone.name) {
            return;
        }

        try {
            const updated = await this.zonesService.update(zone.id, {
                name: nextName,
                description: zone.description || ''
            });
            if (this.activeZoneId === zone.id) {
                await this.zoneTabsManager.openZone({ zoneId: updated.id, zoneName: updated.name });
            }
            await this.refresh();
            this.widgetEventsService.notifyZoneListChanged();
            this.messages.info(`Zone "${zone.name}" renommée en "${updated.name}"`);
        } catch (e) {
            console.error('Zones: rename error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors du renommage de la zone'));
        }
    }

    protected async duplicateZone(zone: ZoneDto): Promise<void> {
        const defaultName = `${zone.name} (copie)`;
        const name = await this.openZoneNameDialog({
            title: 'Dupliquer la zone',
            initialValue: defaultName,
            confirmButtonLabel: 'Dupliquer'
        });
        if (!name) {
            return;
        }

        try {
            const duplicated = await this.zonesService.duplicate(zone.id, {
                name,
                description: zone.description || ''
            });
            await this.refresh();
            this.widgetEventsService.notifyZoneListChanged();
            this.messages.info(`Zone "${zone.name}" dupliquée en "${duplicated.name}"`);
        } catch (e) {
            console.error('Zones: duplicate error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de la duplication de la zone'));
        }
    }

    protected async mergeZone(sourceZone: ZoneDto, targetZoneId: number): Promise<void> {
        const targetZone = this.zones.find(zone => zone.id === targetZoneId);
        const dialog = new ConfirmDialog({
            title: 'Fusionner la zone',
            msg: `Fusionner la zone "${sourceZone.name}" dans "${targetZone?.name || targetZoneId}" ? Les géocaches uniques seront déplacées, les doublons déjà présents dans la cible seront conservés dans la cible, puis la zone source sera supprimée.`,
            ok: 'Fusionner',
            cancel: Dialog.CANCEL
        });

        const confirmed = await dialog.open();
        if (!confirmed) {
            return;
        }

        try {
            const result = await this.zonesService.merge<{
                moved_count?: number;
                duplicate_count?: number;
            }>(sourceZone.id, { target_zone_id: targetZoneId });
            this.expandedZones.delete(sourceZone.id);
            this.zoneGeocaches.delete(sourceZone.id);
            if (this.activeZoneId === sourceZone.id) {
                this.activeZoneId = targetZoneId;
            }
            // La zone source est supprimée: seule la cible doit être rechargée.
            await this.refreshExpandedZones([targetZoneId]);
            this.widgetEventsService.notifyZoneListChanged();
            this.messages.info(`Zone "${sourceZone.name}" fusionnée (${result.moved_count ?? 0} déplacée(s), ${result.duplicate_count ?? 0} doublon(s)).`);
        } catch (e) {
            console.error('Zones: merge error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de la fusion de la zone'));
        }
    }

    protected async openZoneNameDialog(options: {
        title: string;
        initialValue: string;
        confirmButtonLabel: string;
        currentZoneId?: number;
    }): Promise<string | undefined> {
        const dialog = new SingleTextInputDialog({
            title: options.title,
            initialValue: options.initialValue,
            placeholder: 'Nom de la zone',
            confirmButtonLabel: options.confirmButtonLabel,
            validate: input => {
                const name = input.trim();
                if (!name) {
                    return 'Le nom de la zone est requis';
                }
                const duplicate = this.zones.find(z =>
                    z.id !== options.currentZoneId
                    && z.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
                );
                if (duplicate) {
                    return `Une zone nommée "${name}" existe déjà`;
                }
                return '';
            }
        });

        return (await dialog.open())?.trim();
    }

    protected async moveGeocache(geocache: GeocacheDto, sourceZoneId: number, targetZoneId: number): Promise<void> {
        try {
            await this.geocachesService.move(geocache.id, targetZoneId);
            // Seules la zone source et la zone cible changent.
            await this.refreshExpandedZones([sourceZoneId, targetZoneId]);
            // Notifier les onglets de zone ouverts (source et cible)
            this.notifyZonesRefreshFromSelf();
            this.messages.info(`Géocache ${geocache.gc_code} déplacée`);
        } catch (e) {
            console.error('Move geocache error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors du déplacement'));
        }
    }

    protected async copyGeocache(geocache: GeocacheDto, targetZoneId: number): Promise<void> {
        try {
            await this.geocachesService.copy(geocache.id, targetZoneId);
            // Seule la zone cible gagne une géocache (la source est inchangée).
            await this.refreshExpandedZones([targetZoneId]);
            // Notifier les onglets de zone ouverts (cible)
            this.notifyZonesRefreshFromSelf();
            this.messages.info(`Géocache ${geocache.gc_code} copiée vers la zone cible`);
        } catch (e) {
            console.error('Copy geocache error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de la copie'));
        }
    }

    // ---- Glisser-déposer d'une géocache vers une autre zone ----

    protected onGeocacheDragStart(geocache: GeocacheDto, sourceZoneId: number, event: React.DragEvent): void {
        this.draggingGeocache = { geocache, sourceZoneId };
        event.dataTransfer.effectAllowed = 'move';
        // Le type MIME custom permet de valider le dragover (types y est lisible,
        // getData ne l'est pas). La charge utile sert de repli au drop.
        event.dataTransfer.setData(GEOCACHE_DND_MIME, JSON.stringify({ geocacheId: geocache.id, sourceZoneId }));
        event.dataTransfer.setData('text/plain', geocache.gc_code);
    }

    protected onGeocacheDragEnd(): void {
        const hadTarget = this.dropTargetZoneId !== undefined;
        this.draggingGeocache = null;
        this.dropTargetZoneId = undefined;
        if (hadTarget) {
            this.update();
        }
    }

    /** Vrai si l'évènement transporte un glisser-déposer de géocache interne. */
    protected isGeocacheDrag(event: React.DragEvent): boolean {
        return this.draggingGeocache !== null
            || Array.from(event.dataTransfer.types).includes(GEOCACHE_DND_MIME);
    }

    protected onZoneDragOver(zone: ZoneDto, event: React.DragEvent): void {
        if (!this.isGeocacheDrag(event)) {
            return;
        }
        // preventDefault (à chaque dragover) autorise le dépôt sur cette cible.
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
    }

    protected onZoneDragEnter(zone: ZoneDto, event: React.DragEvent): void {
        if (!this.isGeocacheDrag(event)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        // Ne pas surligner la zone source (dépôt sans effet) — cosmétique seulement.
        if (this.draggingGeocache && this.draggingGeocache.sourceZoneId === zone.id) {
            if (this.dropTargetZoneId !== undefined) {
                this.dropTargetZoneId = undefined;
                this.update();
            }
            return;
        }
        if (this.dropTargetZoneId !== zone.id) {
            this.dropTargetZoneId = zone.id;
            this.update();
        }
    }

    protected resolveDraggedGeocache(event: React.DragEvent): { geocache: GeocacheDto; sourceZoneId: number } | null {
        if (this.draggingGeocache) {
            return this.draggingGeocache;
        }
        try {
            const raw = event.dataTransfer.getData(GEOCACHE_DND_MIME);
            if (!raw) {
                return null;
            }
            const { geocacheId, sourceZoneId } = JSON.parse(raw);
            const geocache = this.zoneGeocaches.get(sourceZoneId)?.find(g => g.id === geocacheId);
            return geocache ? { geocache, sourceZoneId } : null;
        } catch {
            return null;
        }
    }

    protected async onZoneDrop(zone: ZoneDto, event: React.DragEvent): Promise<void> {
        if (!this.isGeocacheDrag(event)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const dragged = this.resolveDraggedGeocache(event);
        this.draggingGeocache = null;
        this.dropTargetZoneId = undefined;
        if (!dragged || dragged.sourceZoneId === zone.id) {
            this.update();
            return;
        }
        // moveGeocache déclenche déjà le rafraîchissement ciblé + update().
        await this.moveGeocache(dragged.geocache, dragged.sourceZoneId, zone.id);
    }

    protected buildGeocacheSortSubmenu(): ContextMenuItem[] {
        const items: ContextMenuItem[] = GEOCACHE_SORT_OPTIONS.map(option => ({
            label: option.label,
            checked: this.geocacheSort.key === option.key,
            action: () => this.setGeocacheSort({ key: option.key })
        }));
        items.push({ separator: true });
        items.push({
            label: 'Croissant',
            checked: this.geocacheSort.direction === 'asc',
            action: () => this.setGeocacheSort({ direction: 'asc' })
        });
        items.push({
            label: 'Décroissant',
            checked: this.geocacheSort.direction === 'desc',
            action: () => this.setGeocacheSort({ direction: 'desc' })
        });
        return items;
    }

    protected showZoneContextMenu(zone: ZoneDto, event: React.MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        const items: ContextMenuItem[] = [
            {
                label: 'Ouvrir',
                icon: '📂',
                action: () => this.openZoneTable(zone)
            },
            {
                label: 'Renommer',
                icon: '✎',
                action: () => this.renameZone(zone)
            },
            {
                label: 'Dupliquer',
                icon: '⧉',
                action: () => this.duplicateZone(zone)
            },
            {
                label: 'Fusionner vers...',
                icon: '⇄',
                action: () => {
                    this.mergeDialog = { zone };
                    this.update();
                },
                disabled: this.zones.length <= 1
            },
            {
                separator: true
            },
            {
                label: 'Trier les caches par',
                icon: '↕',
                submenu: this.buildGeocacheSortSubmenu()
            },
            {
                separator: true
            },
            {
                label: 'Supprimer',
                icon: '🗑️',
                danger: true,
                action: () => this.deleteZone(zone)
            }
        ];

        this.contextMenu = {
            items,
            x: event.clientX,
            y: event.clientY
        };
        this.update();
    }

    protected showGeocacheContextMenu(geocache: GeocacheDto, zoneId: number, event: React.MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();

        const items: ContextMenuItem[] = [
            {
                label: 'Ouvrir',
                icon: '📖',
                action: () => this.openGeocacheDetails(geocache)
            },
            {
                label: 'Déplacer vers...',
                icon: '📦',
                action: () => {
                    this.moveDialog = { geocache, zoneId };
                    this.update();
                },
                disabled: this.zones.length <= 1
            },
            {
                label: 'Copier vers...',
                icon: '📋',
                action: () => {
                    this.copyDialog = { geocache, zoneId };
                    this.update();
                },
                disabled: this.zones.length <= 1
            },
            {
                separator: true
            },
            {
                label: 'Supprimer',
                icon: '🗑️',
                danger: true,
                action: async () => {
                    const dialog = new ConfirmDialog({
                        title: 'Supprimer la géocache',
                        msg: `Voulez-vous vraiment supprimer ${geocache.gc_code} ?`,
                        ok: Dialog.OK,
                        cancel: Dialog.CANCEL
                    });
                    
                    const confirmed = await dialog.open();
                    if (!confirmed) {
                        return;
                    }

                    try {
                        await this.geocachesService.delete(geocache.id);

                        // Seule la zone de la géocache supprimée doit être rechargée.
                        await this.refreshExpandedZones([zoneId]);
                        // Notifier un éventuel onglet de zone ouvert sur cette zone
                        this.notifyZonesRefreshFromSelf();

                        this.messages.info(`Géocache ${geocache.gc_code} supprimée`);
                    } catch (e) {
                        console.error('Delete geocache error', e);
                        this.messages.error(getErrorMessage(e, 'Erreur lors de la suppression'));
                    }
                }
            }
        ];

        this.contextMenu = {
            items,
            x: event.clientX,
            y: event.clientY
        };
        this.update();
    }

    protected closeContextMenu(): void {
        this.contextMenu = null;
        this.update();
    }

    protected closeMoveDialog(): void {
        this.moveDialog = null;
        this.update();
    }

    protected closeCopyDialog(): void {
        this.copyDialog = null;
        this.update();
    }

    protected closeMergeDialog(): void {
        this.mergeDialog = null;
        this.update();
    }

    protected async onAddZoneSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const name = (formData.get('name') as string || '').trim();
        const description = (formData.get('description') as string || '').trim();
        if (!name) { return; }
        
        try {
            await this.zonesService.create({ name, description });
            form.reset();
            await this.refresh();
            this.widgetEventsService.notifyZoneListChanged();
            this.messages.info(`Zone "${name}" créée`);
        } catch (e) {
            console.error('Zones: create error', e);
            this.messages.error('Erreur lors de la création de la zone');
        }
    }

    // Méthode supprimée - on utilise maintenant le composant GeocacheIcon directement

    /**
     * Émet requestZonesRefresh pour notifier les autres widgets (onglets de zone
     * ouverts) tout en évitant que CE widget ne se rafraîchisse une 2e fois via
     * son propre handler — il vient déjà de se mettre à jour localement.
     */
    protected notifyZonesRefreshFromSelf(): void {
        this.selfTriggeringZonesRefresh = true;
        try {
            this.widgetEventsService.requestZonesRefresh();
        } finally {
            this.selfTriggeringZonesRefresh = false;
        }
    }

    /**
     * Rafraîchit la liste des zones (compteurs, zone active) puis recharge les
     * géocaches des zones dépliées.
     *
     * @param zoneIds Si fourni, invalidation **ciblée**: seules ces zones (si
     * dépliées) sont rechargées; les autres zones dépliées conservent leurs
     * données déjà en cache. Sinon rafraîchissement global: les zones repliées
     * voient leur cache purgé (rechargé à la prochaine ouverture) et toutes les
     * zones dépliées sont rechargées.
     *
     * Dans les deux cas les rechargements s'exécutent en parallèle.
     */
    protected async refreshExpandedZones(zoneIds?: number[]): Promise<void> {
        if (zoneIds !== undefined) {
            const targetIds = zoneIds.filter(id => this.expandedZones.has(id));
            await this.refresh();
            await Promise.all(targetIds.map(id => this.loadGeocachesForZone(id, { force: true })));
            return;
        }

        // Rafraîchissement global: purge du cache des zones repliées pour éviter
        // de servir des données périmées à la prochaine ouverture.
        for (const cachedId of Array.from(this.zoneGeocaches.keys())) {
            if (!this.expandedZones.has(cachedId)) {
                this.zoneGeocaches.delete(cachedId);
            }
        }

        await this.refresh();
        await Promise.all(
            Array.from(this.expandedZones).map(id => this.loadGeocachesForZone(id, { force: true }))
        );
    }

    protected renderSortControls(): React.ReactNode {
        return (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <select
                    value={this.zoneSort.key}
                    onChange={event => this.setZoneSort({ key: event.currentTarget.value as ZoneSortKey })}
                    title='Critere de tri'
                    aria-label='Critere de tri des zones'
                    style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '3px 6px',
                        border: '1px solid var(--theia-dropdown-border, var(--theia-input-border))',
                        background: 'var(--theia-dropdown-background, var(--theia-input-background))',
                        color: 'var(--theia-dropdown-foreground, var(--theia-input-foreground))',
                        borderRadius: 3,
                        fontSize: '0.85em',
                    }}
                >
                    {ZONE_SORT_OPTIONS.map(option => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                </select>
                <button
                    type='button'
                    className='theia-button'
                    onClick={() => this.toggleZoneSortDirection()}
                    title={this.zoneSort.direction === 'asc' ? 'Tri croissant' : 'Tri decroissant'}
                    aria-label='Inverser le tri des zones'
                    style={{ padding: '3px 8px', minWidth: 48 }}
                >
                    {this.zoneSort.direction === 'asc' ? 'Asc' : 'Desc'}
                </button>
            </div>
        );
    }

    // ---- Navigation clavier / accessibilité de l'arbre (pattern WAI-ARIA tree) ----

    protected zoneItemId(zoneId: number): string {
        return `z-${zoneId}`;
    }

    protected geocacheItemId(zoneId: number, geocacheId: number): string {
        return `g-${zoneId}-${geocacheId}`;
    }

    protected itemDomId(itemId: string): string {
        return `zones-tree-item-${itemId}`;
    }

    /** Liste à plat des éléments visibles de l'arbre, dans l'ordre d'affichage. */
    protected getVisibleItems(): Array<{
        itemId: string;
        kind: 'zone' | 'geocache';
        level: number;
        zone: ZoneDto;
        zoneId: number;
        geocache?: GeocacheDto;
    }> {
        const items: Array<{
            itemId: string;
            kind: 'zone' | 'geocache';
            level: number;
            zone: ZoneDto;
            zoneId: number;
            geocache?: GeocacheDto;
        }> = [];
        for (const zone of this.getSortedZones()) {
            items.push({ itemId: this.zoneItemId(zone.id), kind: 'zone', level: 1, zone, zoneId: zone.id });
            if (this.expandedZones.has(zone.id) && !this.loadingZones.has(zone.id)) {
                const geocaches = this.zoneGeocaches.get(zone.id);
                if (geocaches && geocaches.length > 0) {
                    for (const gc of this.getSortedGeocaches(geocaches)) {
                        items.push({
                            itemId: this.geocacheItemId(zone.id, gc.id),
                            kind: 'geocache',
                            level: 2,
                            zone,
                            zoneId: zone.id,
                            geocache: gc,
                        });
                    }
                }
            }
        }
        return items;
    }

    protected setActiveItem(itemId: string | undefined, options: { scroll?: boolean } = {}): void {
        if (this.activeItemId === itemId) {
            return;
        }
        this.activeItemId = itemId;
        this.update();
        if (itemId && options.scroll !== false) {
            const domId = this.itemDomId(itemId);
            window.requestAnimationFrame(() => {
                document.getElementById(domId)?.scrollIntoView({ block: 'nearest' });
            });
        }
    }

    protected onTreeFocus(): void {
        this.treeFocused = true;
        if (!this.activeItemId) {
            const items = this.getVisibleItems();
            if (items.length > 0) {
                const activeZoneItem = this.activeZoneId !== undefined
                    ? items.find(item => item.kind === 'zone' && item.zone.id === this.activeZoneId)
                    : undefined;
                this.activeItemId = (activeZoneItem ?? items[0]).itemId;
            }
        }
        this.update();
    }

    protected onTreeBlur(): void {
        this.treeFocused = false;
        this.update();
    }

    protected onTreeKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
        const items = this.getVisibleItems();
        if (items.length === 0) {
            return;
        }
        const currentIndex = items.findIndex(item => item.itemId === this.activeItemId);
        const current = currentIndex >= 0 ? items[currentIndex] : undefined;

        switch (event.key) {
            case 'ArrowDown': {
                event.preventDefault();
                const next = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, items.length - 1);
                this.setActiveItem(items[next].itemId);
                break;
            }
            case 'ArrowUp': {
                event.preventDefault();
                const prev = currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
                this.setActiveItem(items[prev].itemId);
                break;
            }
            case 'Home': {
                event.preventDefault();
                this.setActiveItem(items[0].itemId);
                break;
            }
            case 'End': {
                event.preventDefault();
                this.setActiveItem(items[items.length - 1].itemId);
                break;
            }
            case 'ArrowRight': {
                event.preventDefault();
                if (!current) {
                    this.setActiveItem(items[0].itemId);
                    break;
                }
                if (current.kind === 'zone' && current.zone.geocaches_count > 0) {
                    if (!this.expandedZones.has(current.zone.id)) {
                        void this.toggleZone(current.zone.id);
                    } else {
                        const child = items[currentIndex + 1];
                        if (child && child.kind === 'geocache' && child.zoneId === current.zone.id) {
                            this.setActiveItem(child.itemId);
                        }
                    }
                }
                break;
            }
            case 'ArrowLeft': {
                event.preventDefault();
                if (!current) {
                    this.setActiveItem(items[0].itemId);
                    break;
                }
                if (current.kind === 'geocache') {
                    this.setActiveItem(this.zoneItemId(current.zoneId));
                } else if (current.kind === 'zone' && this.expandedZones.has(current.zone.id)) {
                    void this.toggleZone(current.zone.id);
                }
                break;
            }
            case 'Enter':
            case ' ': {
                event.preventDefault();
                if (!current) {
                    break;
                }
                if (current.kind === 'zone') {
                    void this.openZoneTable(current.zone);
                } else if (current.geocache) {
                    void this.openGeocacheDetails(current.geocache);
                }
                break;
            }
            default:
                break;
        }
    }

    protected render(): React.ReactNode {
        const sortedZones = this.getSortedZones();

        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px' }}>
                {/* Formulaire d'ajout de zone */}
                <form 
                    onSubmit={e => this.onAddZoneSubmit(e)} 
                    style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}
                >
                    <input 
                        name='name' 
                        placeholder='Nouvelle zone' 
                        style={{
                            padding: '4px 8px',
                            border: '1px solid var(--theia-input-border)',
                            background: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            borderRadius: 3,
                        }}
                    />
                    <input 
                        name='description' 
                        placeholder='Description (optionnel)'
                        style={{
                            padding: '4px 8px',
                            border: '1px solid var(--theia-input-border)',
                            background: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            borderRadius: 3,
                        }}
                    />
                    <button 
                        type='submit'
                        className='theia-button'
                        style={{ padding: '4px 8px' }}
                    >
                        ➕ Ajouter Zone
                    </button>
                </form>

                {this.renderSortControls()}

                {/* Arbre de navigation */}
                <div style={{ flex: 1, overflow: 'auto' }}>
                    {this.zones.length === 0 ? (
                        <div style={{ textAlign: 'center', opacity: 0.6, padding: '20px 10px' }}>
                            <p style={{ fontSize: '0.9em' }}>Aucune zone</p>
                            <p style={{ fontSize: '0.85em' }}>Créez une zone pour commencer</p>
                        </div>
                    ) : (
                        <div
                            role='tree'
                            aria-label='Zones et géocaches'
                            tabIndex={0}
                            aria-activedescendant={this.activeItemId ? this.itemDomId(this.activeItemId) : undefined}
                            onKeyDown={e => this.onTreeKeyDown(e)}
                            onFocus={() => this.onTreeFocus()}
                            onBlur={() => this.onTreeBlur()}
                            style={{ outline: 'none' }}
                        >
                            {sortedZones.map(zone => this.renderZoneNode(zone))}
                        </div>
                    )}
                </div>

                {/* Menu contextuel */}
                {this.contextMenu && (
                    <ContextMenu
                        items={this.contextMenu.items}
                        x={this.contextMenu.x}
                        y={this.contextMenu.y}
                        onClose={() => this.closeContextMenu()}
                    />
                )}

                {/* Dialog de déplacement */}
                {this.moveDialog && (
                    <MoveGeocacheDialog
                        geocacheName={`${this.moveDialog.geocache.gc_code} - ${this.moveDialog.geocache.name}`}
                        currentZoneId={this.moveDialog.zoneId}
                        zones={sortedZones}
                        onMove={async (targetZoneId) => {
                            await this.moveGeocache(this.moveDialog!.geocache, this.moveDialog!.zoneId, targetZoneId);
                            this.closeMoveDialog();
                        }}
                        onCancel={() => this.closeMoveDialog()}
                    />
                )}

                {/* Dialog de copie */}
                {this.copyDialog && (
                    <MoveGeocacheDialog
                        geocacheName={`${this.copyDialog.geocache.gc_code} - ${this.copyDialog.geocache.name}`}
                        currentZoneId={this.copyDialog.zoneId}
                        zones={sortedZones}
                        onMove={async (targetZoneId) => {
                            await this.copyGeocache(this.copyDialog!.geocache, targetZoneId);
                            this.closeCopyDialog();
                        }}
                        onCancel={() => this.closeCopyDialog()}
                        title="Copier vers une zone"
                        actionLabel="Copier"
                    />
                )}

                {/* Dialog de fusion de zone */}
                {this.mergeDialog && (
                    <MoveGeocacheDialog
                        geocacheName={`la zone "${this.mergeDialog.zone.name}"`}
                        currentZoneId={this.mergeDialog.zone.id}
                        zones={sortedZones}
                        onMove={async (targetZoneId) => {
                            const sourceZone = this.mergeDialog!.zone;
                            this.closeMergeDialog();
                            await this.mergeZone(sourceZone, targetZoneId);
                        }}
                        onCancel={() => this.closeMergeDialog()}
                        title="Fusionner vers une zone"
                        actionLabel="Fusionner"
                    />
                )}
            </div>
        );
    }

    protected renderZoneNode(zone: ZoneDto): React.ReactNode {
        const isExpanded = this.expandedZones.has(zone.id);
        const isActive = this.activeZoneId === zone.id;
        const isLoading = this.loadingZones.has(zone.id);
        const geocaches = this.zoneGeocaches.get(zone.id) || [];
        const hasChildren = zone.geocaches_count > 0;
        const itemId = this.zoneItemId(zone.id);
        const isFocused = this.treeFocused && this.activeItemId === itemId;
        const isDropTarget = this.dropTargetZoneId === zone.id;

        return (
            <div
                key={zone.id}
                style={{ marginBottom: 4 }}
                role='none'
                onDragOver={(e) => this.onZoneDragOver(zone, e)}
                onDragEnter={(e) => this.onZoneDragEnter(zone, e)}
                onDrop={(e) => this.onZoneDrop(zone, e)}
            >
                {/* Ligne de la zone */}
                <div
                    id={this.itemDomId(itemId)}
                    role='treeitem'
                    aria-level={1}
                    aria-selected={isFocused}
                    aria-expanded={hasChildren ? isExpanded : undefined}
                    aria-label={`Zone ${zone.name}, ${zone.geocaches_count} géocache${zone.geocaches_count > 1 ? 's' : ''}`}
                    className={`zone-node${isActive ? ' zone-node--active' : ''}${isFocused ? ' zone-node--focused' : ''}${isDropTarget ? ' zone-node--drop-target' : ''}`}
                    onMouseDown={() => this.setActiveItem(itemId, { scroll: false })}
                    onContextMenu={(e) => this.showZoneContextMenu(zone, e)}
                >
                    {/* Icône expand/collapse */}
                    <span
                        onClick={(e) => {
                            e.stopPropagation();
                            this.toggleZone(zone.id);
                        }}
                        style={{
                            width: 16,
                            display: 'inline-block',
                            cursor: 'pointer',
                            userSelect: 'none',
                        }}
                    >
                        {zone.geocaches_count > 0 ? (isExpanded ? '▼' : '▶') : ''}
                    </span>

                    {/* Icône dossier */}
                    <span style={{ marginRight: 6 }}>
                        {isExpanded ? '📂' : '📁'}
                    </span>

                    {/* Nom de la zone */}
                    <span
                        className='zone-name'
                        onClick={() => this.openZoneTable(zone)}
                        title={zone.description || zone.name}
                    >
                        {zone.name}
                        <span style={{ opacity: 0.6, marginLeft: 4, fontSize: '0.85em' }}>
                            ({zone.geocaches_count})
                        </span>
                    </span>
                </div>

                {/* Géocaches (si la zone est dépliée) */}
                {isExpanded && (
                    <div role='group' style={{ marginLeft: 20, marginTop: 2 }}>
                        {isLoading ? (
                            <div style={{ padding: '4px 6px', fontSize: '0.85em', opacity: 0.6 }}>
                                Chargement...
                            </div>
                        ) : geocaches.length === 0 ? (
                            <div style={{ padding: '4px 6px', fontSize: '0.85em', opacity: 0.6 }}>
                                Aucune géocache
                            </div>
                        ) : (
                            this.getSortedGeocaches(geocaches).map(gc => this.renderGeocacheNode(gc, zone.id))
                        )}
                    </div>
                )}
            </div>
        );
    }

    protected renderGeocacheNode(geocache: GeocacheDto, zoneId: number): React.ReactNode {
        const itemId = this.geocacheItemId(zoneId, geocache.id);
        const isFocused = this.treeFocused && this.activeItemId === itemId;
        return (
            <div
                key={geocache.id}
                id={this.itemDomId(itemId)}
                role='treeitem'
                aria-level={2}
                aria-selected={isFocused}
                aria-label={`${geocache.gc_code} ${geocache.name}, difficulté ${geocache.difficulty}, terrain ${geocache.terrain}${geocache.found ? ', trouvée' : ''}`}
                className={`geocache-node${isFocused ? ' geocache-node--focused' : ''}`}
                draggable={true}
                onDragStart={(e) => this.onGeocacheDragStart(geocache, zoneId, e)}
                onDragEnd={() => this.onGeocacheDragEnd()}
                onClick={() => {
                    this.setActiveItem(itemId, { scroll: false });
                    void this.openGeocacheDetails(geocache);
                }}
                onContextMenu={(e) => this.showGeocacheContextMenu(geocache, zoneId, e)}
                title={`${geocache.gc_code} - ${geocache.name}\nD${geocache.difficulty} T${geocache.terrain}`}
            >
                {/* Icône type de cache */}
                <span style={{ marginRight: 6, display: 'inline-flex', alignItems: 'center' }}>
                    <GeocacheIcon type={geocache.cache_type} size={16} />
                </span>

                {/* Code GC */}
                <span style={{ fontWeight: 600, marginRight: 6, color: 'var(--theia-textLink-foreground)' }}>
                    {geocache.gc_code}
                </span>

                {/* Nom de la cache */}
                <span style={{ 
                    flex: 1, 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis', 
                    whiteSpace: 'nowrap',
                    opacity: 0.9,
                }}>
                    {geocache.name}
                </span>

                {/* Indicateur "trouvée" */}
                {geocache.found && (
                    <span style={{ marginLeft: 4, fontSize: '0.9em' }} title="Trouvée">
                        ✓
                    </span>
                )}
            </div>
        );
    }
}

