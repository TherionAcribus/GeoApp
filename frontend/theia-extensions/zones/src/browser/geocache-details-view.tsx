import * as React from 'react';
import { CoordinatesEditor } from './geocache-coordinates-editor';
import { DescriptionEditor } from './geocache-description-editor';
import {
    GeocacheCheckersSection,
    GeocacheDetailedInfoSection,
    GeocacheDetailsHeader,
    GeocacheHintsSection,
    GeocacheOverviewSection
} from './geocache-details-sections';
import { GeocacheDto } from './geocache-details-types';
import { GeocacheNotePreview } from './geocache-note-preview';
import { GeocacheNotesApiResponse } from './geocache-notes-types';
import { GeocacheFriendFindsBanner } from './geocache-friend-finds-banner';
import { GeocacheImagesPanel } from './geocache-images-panel';
import { WaypointsEditorWrapper } from './geocache-waypoints-editor';
import { EmptyState, LoadingState } from './state-views';

type GeocacheDetailsHeaderProps = React.ComponentProps<typeof GeocacheDetailsHeader>;
type CoordinatesEditorProps = React.ComponentProps<typeof CoordinatesEditor>;
type DescriptionEditorProps = React.ComponentProps<typeof DescriptionEditor>;
type GeocacheImagesPanelProps = React.ComponentProps<typeof GeocacheImagesPanel>;
type WaypointsEditorProps = React.ComponentProps<typeof WaypointsEditorWrapper>;

/*
 * Versions mémorisées des composants feuilles coûteux. Le widget Theia (ReactWidget)
 * re-rend tout l'arbre a chaque `update()` (ouverture de menu, etc.). Tant que les props
 * passees ici gardent des references stables (cf. geocache-details-widget), `React.memo`
 * evite de re-rendre la galerie d'images, l'editeur de description et les waypoints.
 */
const MemoGeocacheDetailsHeader = React.memo(GeocacheDetailsHeader);
const MemoCoordinatesEditor = React.memo(CoordinatesEditor);
const MemoDescriptionEditor = React.memo(DescriptionEditor);
const MemoGeocacheImagesPanel = React.memo(GeocacheImagesPanel);
const MemoWaypointsEditorWrapper = React.memo(WaypointsEditorWrapper);
const MemoGeocacheDetailedInfoSection = React.memo(GeocacheDetailedInfoSection);

interface GeocacheDetailsViewProps {
    isLoading: boolean;
    geocacheData?: GeocacheDto;
    headerProps: GeocacheDetailsHeaderProps;
    coordinatesEditorProps: CoordinatesEditorProps;
    descriptionEditorProps: DescriptionEditorProps;
    displayedHints?: string;
    displayDecodedHints: boolean;
    onToggleHintsDisplayMode: () => void | Promise<void>;
    imagesPanelProps?: GeocacheImagesPanelProps;
    waypointsEditorProps: WaypointsEditorProps;
    onRefresh?: () => void | Promise<void>;
    /** Rafraîchissement en cours : anime l'icône du bouton de rafraîchissement de l'en-tête. */
    isRefreshing?: boolean;
    logsSummaryEntries?: import('./geocache-logs-summary').LogSummaryEntry[];
    logsSummaryTotalCount?: number;
    isLogsSummaryLoading?: boolean;
    onOpenLogs?: () => void;
    /** Nombre de notes GeoApp (extra `notes_count`), pour l'aperçu dépliable. */
    notesCount?: number;
    /** Chargement lazy du contenu des notes au premier dépliage de l'aperçu. */
    onFetchNotes?: () => Promise<GeocacheNotesApiResponse>;
    onOpenNotes?: () => void;
    checkerLinkOpenMode?: 'same-group' | 'new-group' | 'external-window';
    onOpenCheckerUrl?: (url: string, mode: 'same-group' | 'new-group' | 'external-window') => void;
    checkerContextMenu?: { x: number; y: number; url: string } | null;
    onShowCheckerContextMenu?: (x: number, y: number, url: string) => void;
    onCloseCheckerContextMenu?: () => void;
    /** URL du backend, pour le bandeau « amis ayant trouvé » (masqué si absente). */
    apiBaseUrl?: string;
    /** Ids des sections repliées (persisté en préférence). */
    collapsedSections?: ReadonlySet<string>;
    onSectionCollapsedChange?: (sectionId: string, collapsed: boolean) => void;
}

export const GeocacheDetailsView: React.FC<GeocacheDetailsViewProps> = ({
    isLoading,
    geocacheData,
    headerProps,
    coordinatesEditorProps,
    descriptionEditorProps,
    displayedHints,
    displayDecodedHints,
    onToggleHintsDisplayMode,
    imagesPanelProps,
    waypointsEditorProps,
    onRefresh,
    isRefreshing,
    logsSummaryEntries,
    logsSummaryTotalCount,
    isLogsSummaryLoading,
    onOpenLogs,
    notesCount,
    onFetchNotes,
    onOpenNotes,
    checkerLinkOpenMode,
    onOpenCheckerUrl,
    checkerContextMenu,
    onShowCheckerContextMenu,
    onCloseCheckerContextMenu,
    apiBaseUrl,
    collapsedSections,
    onSectionCollapsedChange
}) => (
    <div className='p-2' style={{ position: 'relative', paddingLeft: 16, paddingRight: 16 }}>
        {/* Premier chargement uniquement : aucune donnée à afficher encore */}
        {isLoading && !geocacheData ? <LoadingState /> : undefined}
        {!isLoading && !geocacheData ? (
            <EmptyState icon='fa-map-marker' title='Aucune géocache sélectionnée' description='Sélectionnez une géocache pour afficher ses détails.' />
        ) : undefined}
        {/* flex et pas grid : le containing block sticky d'un item de grid est sa
            grid area (sa propre ligne), tandis que celui d'un item flex est le
            content-box du conteneur. La colonne flex permet donc à la barre
            d'outils de rester collée sur toute la hauteur de la fiche. */}
        {geocacheData ? (
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    // Rechargement avec données existantes : on garde le contenu visible mais on
                    // signale discrètement la mise à jour et on neutralise les interactions.
                    opacity: isLoading ? 0.6 : 1,
                    pointerEvents: isLoading ? 'none' : undefined,
                    transition: 'opacity 0.15s ease'
                }}
                aria-busy={isLoading}
            >
                <MemoGeocacheDetailsHeader {...headerProps} onRefresh={onRefresh} isRefreshing={isRefreshing} />

                {geocacheData.id && onFetchNotes && onOpenNotes ? (
                    <GeocacheNotePreview
                        geocacheId={geocacheData.id}
                        notesCount={notesCount ?? geocacheData.notes_count}
                        hasPersonalNote={geocacheData.has_personal_note}
                        fetchNotes={onFetchNotes}
                        onOpenNotes={onOpenNotes}
                    />
                ) : undefined}

                {apiBaseUrl && geocacheData.id ? (
                    <GeocacheFriendFindsBanner geocacheId={geocacheData.id} apiBaseUrl={apiBaseUrl} />
                ) : undefined}

                <GeocacheOverviewSection
                    geocacheData={geocacheData}
                    coordinatesEditor={<MemoCoordinatesEditor {...coordinatesEditorProps} />}
                    logsSummaryEntries={logsSummaryEntries}
                    logsSummaryTotalCount={logsSummaryTotalCount}
                    isLogsSummaryLoading={isLogsSummaryLoading}
                    onOpenLogs={onOpenLogs}
                />

                <MemoGeocacheDetailedInfoSection
                    geocacheData={geocacheData}
                    collapsed={collapsedSections?.has('details')}
                    onSectionCollapsedChange={onSectionCollapsedChange}
                />

                <MemoDescriptionEditor
                    {...descriptionEditorProps}
                    collapsed={collapsedSections?.has('description')}
                    onSectionCollapsedChange={onSectionCollapsedChange}
                />

                <GeocacheHintsSection
                    displayedHints={displayedHints}
                    displayDecodedHints={displayDecodedHints}
                    onToggleDisplayMode={onToggleHintsDisplayMode}
                    collapsed={collapsedSections?.has('hints')}
                    onSectionCollapsedChange={onSectionCollapsedChange}
                />

                {imagesPanelProps ? (
                    <MemoGeocacheImagesPanel
                        {...imagesPanelProps}
                        collapsed={collapsedSections?.has('images')}
                        onSectionCollapsedChange={onSectionCollapsedChange}
                    />
                ) : undefined}

                <div style={{ borderTop: '1px solid var(--theia-panel-border)', paddingTop: 12 }}>
                    <MemoWaypointsEditorWrapper
                        {...waypointsEditorProps}
                        collapsed={collapsedSections?.has('waypoints')}
                        onSectionCollapsedChange={onSectionCollapsedChange}
                    />
                </div>

                <GeocacheCheckersSection
                    checkers={geocacheData.checkers}
                    linkOpenMode={checkerLinkOpenMode}
                    onOpenUrl={onOpenCheckerUrl}
                    contextMenu={checkerContextMenu}
                    onShowContextMenu={onShowCheckerContextMenu}
                    onCloseContextMenu={onCloseCheckerContextMenu}
                    collapsed={collapsedSections?.has('checkers')}
                    onSectionCollapsedChange={onSectionCollapsedChange}
                />
            </div>
        ) : undefined}
        {/* Indicateur discret de rechargement, superpose sans demonter le contenu */}
        {isLoading && geocacheData ? (
            <div
                style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    fontSize: 12,
                    borderRadius: 12,
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
                    zIndex: 10,
                    pointerEvents: 'none'
                }}
            >
                <i className='fa fa-spinner fa-spin' aria-hidden='true' />
                <span>Mise à jour…</span>
            </div>
        ) : undefined}
    </div>
);
