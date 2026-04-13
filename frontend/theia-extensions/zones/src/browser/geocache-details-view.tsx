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
import { GeocacheImagesPanel } from './geocache-images-panel';
import { WaypointsEditorWrapper } from './geocache-waypoints-editor';

type GeocacheDetailsHeaderProps = React.ComponentProps<typeof GeocacheDetailsHeader>;
type CoordinatesEditorProps = React.ComponentProps<typeof CoordinatesEditor>;
type DescriptionEditorProps = React.ComponentProps<typeof DescriptionEditor>;
type GeocacheImagesPanelProps = React.ComponentProps<typeof GeocacheImagesPanel>;
type WaypointsEditorProps = React.ComponentProps<typeof WaypointsEditorWrapper>;

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
    checkerLinkOpenMode?: 'same-group' | 'new-group' | 'external-window';
    onOpenCheckerUrl?: (url: string, mode: 'same-group' | 'new-group' | 'external-window') => void;
    checkerContextMenu?: { x: number; y: number; url: string } | null;
    onShowCheckerContextMenu?: (x: number, y: number, url: string) => void;
    onCloseCheckerContextMenu?: () => void;
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
    checkerLinkOpenMode,
    onOpenCheckerUrl,
    checkerContextMenu,
    onShowCheckerContextMenu,
    onCloseCheckerContextMenu
}) => (
    <div className='p-2'>
        {isLoading ? <div>Chargement...</div> : undefined}
        {!isLoading && !geocacheData ? <div style={{ opacity: 0.7 }}>Aucune donnee</div> : undefined}
        {!isLoading && geocacheData ? (
            <div style={{ display: 'grid', gap: 12 }}>
                <GeocacheDetailsHeader {...headerProps} onRefresh={onRefresh} />

                <GeocacheOverviewSection
                    geocacheData={geocacheData}
                    coordinatesEditor={<CoordinatesEditor {...coordinatesEditorProps} />}
                />

                <GeocacheDetailedInfoSection geocacheData={geocacheData} />

                <DescriptionEditor {...descriptionEditorProps} />

                <GeocacheHintsSection
                    displayedHints={displayedHints}
                    displayDecodedHints={displayDecodedHints}
                    onToggleDisplayMode={onToggleHintsDisplayMode}
                />

                {imagesPanelProps ? <GeocacheImagesPanel {...imagesPanelProps} /> : undefined}

                <div>
                    <WaypointsEditorWrapper {...waypointsEditorProps} />
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
    </div>
);
