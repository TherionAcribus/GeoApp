import * as React from 'react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core';
import { EarthCoachContext } from './earthcoach-context-service';
import { buildEarthCoachImageGallery, EarthCoachImageGallery } from './earthcoach-image-gallery';
import { GeoImage } from './earthcoach-types';

interface EarthCoachImageGalleryViewProps {
    title: string;
    gallery?: EarthCoachImageGallery;
    onOpenReferences: () => void | Promise<void>;
}

function ImageCard(props: { image: GeoImage }): React.ReactElement {
    const image = props.image;
    return (
        <article
            style={{
                border: '1px solid var(--theia-panel-border)',
                borderRadius: 6,
                overflow: 'hidden',
                background: 'var(--theia-editor-background)',
            }}
        >
            <a href={image.fileUri} target='_blank' rel='noreferrer'>
                <img
                    src={image.fileUri}
                    alt={image.label || image.id}
                    style={{
                        width: '100%',
                        height: 150,
                        objectFit: 'cover',
                        display: 'block',
                        background: 'var(--theia-editorWidget-background)',
                    }}
                />
            </a>
            <div style={{ padding: 8, display: 'grid', gap: 4 }}>
                <a href={image.fileUri} target='_blank' rel='noreferrer' style={{ fontWeight: 600 }}>
                    {image.label || image.id}
                </a>
                {image.description ? (
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{image.description}</div>
                ) : undefined}
                {image.takenAt ? (
                    <div style={{ fontSize: 11, opacity: 0.65 }}>{image.takenAt}</div>
                ) : undefined}
            </div>
        </article>
    );
}

function EarthCoachImageGalleryView(props: EarthCoachImageGalleryViewProps): React.ReactElement {
    if (!props.gallery) {
        return <div style={{ padding: 16, opacity: 0.7 }}>Aucune EarthCache chargee.</div>;
    }
    return (
        <div style={{ padding: 16, overflow: 'auto', display: 'grid', gap: 16 }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 18 }}>{props.title}</h2>
                    <div style={{ opacity: 0.75 }}>
                        Les images sont separees par origine pour eviter toute confusion.
                    </div>
                </div>
                <button
                    className='theia-button secondary'
                    type='button'
                    onClick={() => { void props.onOpenReferences(); }}
                    title='Ouvrir les references pedagogiques EarthCoach'
                >
                    References pedagogiques
                </button>
            </header>

            {props.gallery.sections.map(section => (
                <section
                    key={section.origin}
                    style={{
                        border: '1px solid var(--theia-panel-border)',
                        borderRadius: 6,
                        padding: 12,
                        display: 'grid',
                        gap: 10,
                    }}
                >
                    <div style={{ display: 'grid', gap: 4 }}>
                        <h3 style={{ margin: 0, fontSize: 14 }}>{section.title}</h3>
                        <div style={{ opacity: 0.75 }}>{section.description}</div>
                        <div style={{ color: 'var(--theia-descriptionForeground)', fontSize: 12 }}>
                            {section.warning}
                        </div>
                    </div>
                    {section.images.length ? (
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                gap: 10,
                            }}
                        >
                            {section.images.map(image => <ImageCard key={`${section.origin}-${image.id}`} image={image} />)}
                        </div>
                    ) : (
                        <div style={{ opacity: 0.65, fontStyle: 'italic' }}>
                            Aucune image dans cette categorie.
                        </div>
                    )}
                </section>
            ))}
        </div>
    );
}

@injectable()
export class EarthCoachImageGalleryWidget extends ReactWidget {

    static readonly ID = 'earthcoach.imageGallery';
    static readonly LABEL = 'Images EarthCoach';

    protected gallery: EarthCoachImageGallery | undefined;
    protected geocacheTitle = EarthCoachImageGalleryWidget.LABEL;

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    @postConstruct()
    protected init(): void {
        this.id = EarthCoachImageGalleryWidget.ID;
        this.title.label = EarthCoachImageGalleryWidget.LABEL;
        this.title.caption = 'Galerie images EarthCoach';
        this.title.iconClass = 'codicon codicon-device-camera';
        this.title.closable = true;
        this.addClass('earthcoach-image-gallery-widget');
        this.update();
    }

    setContext(context: EarthCoachContext): void {
        this.gallery = buildEarthCoachImageGallery(context.images);
        this.geocacheTitle = `Images EarthCoach - ${context.geocacheData.gc_code || context.geocacheData.name}`;
        this.title.label = this.geocacheTitle;
        this.update();
    }

    protected render(): React.ReactNode {
        return (
            <EarthCoachImageGalleryView
                title={this.geocacheTitle}
                gallery={this.gallery}
                onOpenReferences={() => this.commandService.executeCommand('earthcoach.references.open')}
            />
        );
    }
}
