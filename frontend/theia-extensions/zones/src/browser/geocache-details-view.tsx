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
 * Versions memoisees des composants feuilles couteux. Le widget Theia (ReactWidget)
 * re-rend tout l'arbre a chaque `update()` (ouverture de menu, etc.). Tant que les props
 * passees ici gardent des references stables (cf. geocache-details-widget), `React.memo`
 * evite de re-rendre la galerie d'images, l'editeur de description et les waypoints.
 */
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
    logsSummaryEntries?: import('./geocache-logs-summary').LogSummaryEntry[];
    logsSummaryTotalCount?: number;
    isLogsSummaryLoading?: boolean;
    onOpenLogs?: () => void;
    checkerLinkOpenMode?: 'same-group' | 'new-group' | 'external-window';
    onOpenCheckerUrl?: (url: string, mode: 'same-group' | 'new-group' | 'external-window') => void;
    checkerContextMenu?: { x: number; y: number; url: string } | null;
    onShowCheckerContextMenu?: (x: number, y: number, url: string) => void;
    onCloseCheckerContextMenu?: () => void;
    /** URL du backend, pour le bandeau « amis ayant trouvé » (masqué si absente). */
    apiBaseUrl?: string;
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
    logsSummaryEntries,
    logsSummaryTotalCount,
    isLogsSummaryLoading,
    onOpenLogs,
    checkerLinkOpenMode,
    onOpenCheckerUrl,
    checkerContextMenu,
    onShowCheckerContextMenu,
    onCloseCheckerContextMenu,
    apiBaseUrl
}) => (
    <div className='p-2' style={{ position: 'relative' }}>
        {/* Premier chargement uniquement : aucune donnee a afficher encore */}
        {isLoading && !geocacheData ? <LoadingState /> : undefined}
        {!isLoading && !geocacheData ? (
            <EmptyState icon='fa-map-marker' title='Aucune géocache sélectionnée' description='Sélectionnez une géocache pour afficher ses détails.' />
        ) : undefined}
        {geocacheData ? (
            <div
                style={{
                    display: 'grid',
                    gap: 12,
                    // Rechargement avec donnees existantes : on garde le contenu visible mais on
                    // signale discretement la mise a jour et on neutralise les interactions.
                    opacity: isLoading ? 0.6 : 1,
                    pointerEvents: isLoading ? 'none' : undefined,
                    transition: 'opacity 0.15s ease'
                }}
                aria-busy={isLoading}
            >
                <GeocacheDetailsHeader {...headerProps} onRefresh={onRefresh} />

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

                <MemoGeocacheDetailedInfoSection geocacheData={geocacheData} />

                <MemoDescriptionEditor {...descriptionEditorProps} />

                <GeocacheHintsSection
                    displayedHints={displayedHints}
                    displayDecodedHints={displayDecodedHints}
                    onToggleDisplayMode={onToggleHintsDisplayMode}
                />

                {imagesPanelProps ? <MemoGeocacheImagesPanel {...imagesPanelProps} /> : undefined}

                <div style={{ borderTop: '1px solid var(--theia-panel-border)', paddingTop: 12 }}>
                    <MemoWaypointsEditorWrapper {...waypointsEditorProps} />
                </div>

                <GeocacheCheckersSection
                    checkers={geocacheData.checkers}
                    linkOpenMode={checkerLinkOpenMode}
                    onOpenUrl={onOpenCheckerUrl}
                    contextMenu={checkerContextMenu}
                    onShowContextMenu={onShowCheckerContextMenu}
                    onCloseContextMenu={onCloseCheckerContextMenu}
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
