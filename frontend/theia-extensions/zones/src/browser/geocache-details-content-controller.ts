import { injectable } from '@theia/core/shared/inversify';
import {
    DescriptionVariant,
    GeocacheDto
} from './geocache-details-types';
import {
    htmlToRawText,
    rawTextToHtml,
    rot13
} from './geocache-details-utils';

export interface GeocacheSearchableContentItem {
    id: string;
    text: string;
    element?: HTMLElement;
}

@injectable()
export class GeocacheDetailsContentController {
    getEffectiveDescriptionHtml(data: GeocacheDto, variant: DescriptionVariant): string {
        if (variant === 'modified') {
            if (data.description_override_html) {
                return data.description_override_html;
            }
            if (data.description_override_raw) {
                return rawTextToHtml(data.description_override_raw);
            }
            return '';
        }

        if (data.description_html) {
            return data.description_html;
        }
        if (data.description_raw) {
            return rawTextToHtml(data.description_raw);
        }
        return '';
    }

    getDecodedHints(data: GeocacheDto): string | undefined {
        if (data.hints_decoded_override) {
            return data.hints_decoded_override;
        }
        if (data.hints_decoded) {
            return data.hints_decoded;
        }
        if (!data.hints) {
            return undefined;
        }
        return rot13(data.hints);
    }

    getDisplayedHints(data: GeocacheDto | undefined, displayDecodedHints: boolean): string | undefined {
        if (!data) {
            return undefined;
        }
        const decodedHints = this.getDecodedHints(data);
        const rawHints = data.hints;
        const hasHints = Boolean(rawHints) || Boolean(data.hints_decoded) || Boolean(data.hints_decoded_override);
        if (!hasHints) {
            return undefined;
        }
        return displayDecodedHints ? (decodedHints || rawHints) : (rawHints || decodedHints);
    }

    getSourceHintsForTranslation(data: GeocacheDto): string {
        return data.hints_decoded || (data.hints ? rot13(data.hints) : '');
    }

    buildSearchableContent(
        data: GeocacheDto | undefined,
        descriptionVariant: DescriptionVariant
    ): GeocacheSearchableContentItem[] {
        if (!data) {
            return [];
        }

        const contents: GeocacheSearchableContentItem[] = [];

        const headerParts = [data.name, data.gc_code, data.type, data.owner].filter(Boolean);
        if (headerParts.length > 0) {
            contents.push({ id: 'header', text: headerParts.join(' ') });
        }

        const coordParts = [data.coordinates_raw, data.original_coordinates_raw].filter(Boolean);
        if (coordParts.length > 0) {
            contents.push({ id: 'coordinates', text: coordParts.join(' ') });
        }

        const descriptionHtml = this.getEffectiveDescriptionHtml(data, descriptionVariant);
        if (descriptionHtml) {
            contents.push({ id: 'description', text: htmlToRawText(descriptionHtml) });
        }

        const decodedHints = this.getDecodedHints(data);
        if (decodedHints) {
            contents.push({ id: 'hints', text: decodedHints });
        } else if (data.hints) {
            contents.push({ id: 'hints', text: data.hints });
        }

        if (data.waypoints && data.waypoints.length > 0) {
            const waypointTexts = data.waypoints.map(waypoint => {
                const parts = [waypoint.prefix, waypoint.name, waypoint.type, waypoint.gc_coords, waypoint.note, waypoint.note_override].filter(Boolean);
                return parts.join(' ');
            });
            contents.push({ id: 'waypoints', text: waypointTexts.join('\n') });
        }

        if (data.checkers && data.checkers.length > 0) {
            const checkerTexts = data.checkers.map(checker => [checker.name, checker.url].filter(Boolean).join(' '));
            contents.push({ id: 'checkers', text: checkerTexts.join('\n') });
        }

        return contents;
    }
}
