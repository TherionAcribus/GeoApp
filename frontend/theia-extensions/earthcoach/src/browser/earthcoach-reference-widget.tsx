import * as React from 'react';
import { CommandService } from '@theia/core';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { EARTHCOACH_REFERENCES_LANGUAGE_PREF } from './earthcoach-preferences';
import {
    EarthCoachReferenceSearchResult,
    EarthCoachReferenceTools,
} from './earthcoach-reference-tools';

interface EarthCoachReferenceViewProps {
    query: string;
    language: 'fr' | 'en';
    isLoading: boolean;
    error?: string;
    result?: EarthCoachReferenceSearchResult;
    onSearch: (query: string, language: 'fr' | 'en') => void | Promise<void>;
    onOpenPreferences: () => void | Promise<void>;
}

function EarthCoachReferenceView(props: EarthCoachReferenceViewProps): React.ReactElement {
    const [query, setQuery] = React.useState(props.query);
    const [language, setLanguage] = React.useState<'fr' | 'en'>(props.language);

    React.useEffect(() => setQuery(props.query), [props.query]);
    React.useEffect(() => setLanguage(props.language), [props.language]);

    const submit = (event: React.FormEvent): void => {
        event.preventDefault();
        void props.onSearch(query, language);
    };

    return (
        <div style={{ padding: 12, display: 'grid', gap: 12 }}>
            <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8 }}>
                <input
                    className='theia-input'
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder='calcaire coquillier, basalte, faille normale...'
                    aria-label='Terme geologique'
                />
                <select
                    className='theia-select'
                    value={language}
                    onChange={event => setLanguage(event.target.value === 'en' ? 'en' : 'fr')}
                    aria-label='Langue'
                >
                    <option value='fr'>FR</option>
                    <option value='en'>EN</option>
                </select>
                <button className='theia-button' type='submit' disabled={props.isLoading || !query.trim()}>
                    {props.isLoading ? 'Recherche...' : 'Rechercher'}
                </button>
                <button
                    className='theia-button secondary'
                    type='button'
                    onClick={() => { void props.onOpenPreferences(); }}
                    title='Ouvrir les preferences GeoApp, section EarthCoach'
                >
                    Preferences
                </button>
            </form>

            {props.error ? (
                <div style={{ color: 'var(--theia-errorForeground)', whiteSpace: 'pre-wrap' }}>{props.error}</div>
            ) : undefined}

            {props.result ? (
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>
                        References pedagogiques externes. Elles ne remplacent pas les observations terrain.
                        {' '}
                        Sources: {props.result.allowed_sources.join(', ')}.
                        {props.result.from_cache ? ' Resultats servis depuis le cache local.' : ''}
                    </div>

                    {props.result.articles.length ? (
                        <section style={{ display: 'grid', gap: 8 }}>
                            <h3 style={{ margin: 0, fontSize: 14 }}>Articles</h3>
                            {props.result.articles.map(article => (
                                <article
                                    key={`${article.source}-${article.title}`}
                                    style={{
                                        border: '1px solid var(--theia-panel-border)',
                                        borderRadius: 6,
                                        padding: 10,
                                        display: 'grid',
                                        gap: 6,
                                    }}
                                >
                                    <a href={article.url} target='_blank' rel='noreferrer' style={{ fontWeight: 600 }}>
                                        {article.title}
                                    </a>
                                    {article.summary ? (
                                        <div style={{ lineHeight: 1.45 }}>{article.summary}</div>
                                    ) : undefined}
                                    <div style={{ opacity: 0.65, fontSize: 12 }}>{article.source}</div>
                                </article>
                            ))}
                        </section>
                    ) : undefined}

                    {props.result.images.length ? (
                        <section style={{ display: 'grid', gap: 8 }}>
                            <h3 style={{ margin: 0, fontSize: 14 }}>Images pedagogiques</h3>
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                    gap: 10,
                                }}
                            >
                                {props.result.images.map(image => (
                                    <article
                                        key={image.id}
                                        style={{
                                            border: '1px solid var(--theia-panel-border)',
                                            borderRadius: 6,
                                            overflow: 'hidden',
                                            background: 'var(--theia-editor-background)',
                                        }}
                                    >
                                        {image.thumbnailUrl ? (
                                            <a href={image.pageUrl || image.imageUrl} target='_blank' rel='noreferrer'>
                                                <img
                                                    src={image.thumbnailUrl}
                                                    alt={image.title}
                                                    style={{
                                                        display: 'block',
                                                        width: '100%',
                                                        height: 140,
                                                        objectFit: 'cover',
                                                        background: 'var(--theia-editorWidget-background)',
                                                    }}
                                                />
                                            </a>
                                        ) : undefined}
                                        <div style={{ padding: 8, display: 'grid', gap: 4 }}>
                                            <a href={image.pageUrl || image.imageUrl} target='_blank' rel='noreferrer'>
                                                {image.title}
                                            </a>
                                            {image.description ? (
                                                <div style={{ fontSize: 12, opacity: 0.75 }}>
                                                    {image.description}
                                                </div>
                                            ) : undefined}
                                            <div style={{ fontSize: 11, opacity: 0.65 }}>
                                                {image.source}{image.license ? ` - ${image.license}` : ''}
                                            </div>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section>
                    ) : undefined}
                </div>
            ) : (
                <div style={{ opacity: 0.7 }}>
                    Cherche un terme geologique pour afficher des references et images marquees comme educational_reference.
                </div>
            )}
        </div>
    );
}

@injectable()
export class EarthCoachReferenceWidget extends ReactWidget {

    static readonly ID = 'earthcoach.references';
    static readonly LABEL = 'References EarthCoach';

    protected query = '';
    protected language: 'fr' | 'en' = 'fr';
    protected isLoading = false;
    protected error: string | undefined;
    protected result: EarthCoachReferenceSearchResult | undefined;

    @inject(EarthCoachReferenceTools)
    protected readonly referenceTools!: EarthCoachReferenceTools;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    @postConstruct()
    protected init(): void {
        this.id = EarthCoachReferenceWidget.ID;
        this.title.label = EarthCoachReferenceWidget.LABEL;
        this.title.caption = 'References pedagogiques EarthCoach';
        this.title.iconClass = 'codicon codicon-book';
        this.title.closable = true;
        this.addClass('earthcoach-reference-widget');
        this.language = String(this.preferenceService.get(EARTHCOACH_REFERENCES_LANGUAGE_PREF, 'fr')) === 'en' ? 'en' : 'fr';
        this.update();
    }

    async search(query: string, language: 'fr' | 'en' = this.language): Promise<void> {
        const normalized = query.trim();
        if (!normalized) {
            return;
        }
        this.query = normalized;
        this.language = language;
        this.isLoading = true;
        this.error = undefined;
        this.update();
        try {
            this.result = await this.referenceTools.searchReference({
                query: normalized,
                language,
                includeImages: true,
            });
        } catch (error: any) {
            this.error = error?.message || String(error);
            this.result = undefined;
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected render(): React.ReactNode {
        return (
            <EarthCoachReferenceView
                query={this.query}
                language={this.language}
                isLoading={this.isLoading}
                error={this.error}
                result={this.result}
                onSearch={(query, language) => this.search(query, language)}
                onOpenPreferences={() => this.commandService.executeCommand('geo-preferences:open', { category: 'earthcoach' })}
            />
        );
    }
}
