import * as assert from 'assert/strict';
import {
    buildLogsAnalysisPrompt,
    describeAnalysisScope,
    isPartialScope,
    truncateLogText,
} from '../geocache-logs-analysis-prompt';
import { GeocacheLogDto } from '../geocache-logs-types';

function createLog(overrides: Partial<GeocacheLogDto> = {}): GeocacheLogDto {
    return {
        id: 1,
        external_id: '1000001',
        author: 'GeoJoueur',
        text: 'Trouvée après dix minutes, attention aux ronces.',
        date: '2026-08-14T00:00:00+00:00',
        log_type: 'Found',
        is_favorite: false,
        created_at: '2026-08-14T00:00:00+00:00',
        ...overrides,
    };
}

function testScopeIsAnnouncedToTheModel(): void {
    const { prompt, analyzedCount } = buildLogsAnalysisPrompt({
        logs: [createLog(), createLog({ id: 2 })],
        storedCount: 120,
        totalAvailable: 300,
    });

    assert.equal(analyzedCount, 2);
    assert.match(prompt, /PÉRIMÈTRE : 2 logs analysés sur 120 chargés sur 300 présents sur Geocaching\.com/);
    // Le modèle doit savoir qu'il ne voit pas tout, sinon il généralise.
    assert.match(prompt, /ne sont PAS tous ceux de la cache/);
}

function testCompleteScopeCarriesNoWarning(): void {
    const { prompt } = buildLogsAnalysisPrompt({
        logs: [createLog()],
        storedCount: 1,
        totalAvailable: 1,
    });

    assert.doesNotMatch(prompt, /ne sont PAS tous ceux de la cache/);
    assert.match(prompt, /PÉRIMÈTRE : 1 log analysé/);
}

function testAnUnknownRemoteTotalDoesNotInventAScope(): void {
    const scope = describeAnalysisScope(25, 25, undefined);

    assert.equal(scope, '25 logs analysés');
    assert.equal(isPartialScope(25, 25, undefined), false);
}

function testStoredLogsBeyondTheCapMakeTheScopePartial(): void {
    assert.equal(isPartialScope(100, 250, undefined), true);
    assert.equal(describeAnalysisScope(100, 250, 250), '100 logs analysés sur 250 chargés');
}

function testHintIsIncludedOrSaidAbsent(): void {
    const withHint = buildLogsAnalysisPrompt({
        logs: [createLog()],
        storedCount: 1,
        hint: 'Sous la pierre plate',
    }).prompt;
    const withoutHint = buildLogsAnalysisPrompt({ logs: [createLog()], storedCount: 1 }).prompt;

    assert.match(withHint, /Sous la pierre plate/);
    assert.match(withoutHint, /Aucun hint fourni/);
}

function testLogsAreRenderedWithTheirHeader(): void {
    const { prompt } = buildLogsAnalysisPrompt({
        logs: [createLog({ log_type: 'Did Not Find', author: 'Chercheuse', is_favorite: true })],
        storedCount: 1,
    });

    assert.match(prompt, /\[Did Not Find\] .* — Chercheuse ⭐/);
    assert.match(prompt, /attention aux ronces/);
}

function testALongLogIsCutOnAWordAndSaysSo(): void {
    const long = `${'mot '.repeat(500)}fin`;

    const truncated = truncateLogText(long, 100);

    assert.ok(truncated.length < 130, truncated);
    assert.match(truncated, /\[…log tronqué\]$/);
    // La coupe tombe sur une frontière de mot, pas au milieu.
    assert.doesNotMatch(truncated.replace(' […log tronqué]', ''), /mo$/);
}

function testAShortLogIsLeftIntact(): void {
    assert.equal(truncateLogText('  TFTC  ', 100), 'TFTC');
}

function testAnEmptyLogKeepsItsHeader(): void {
    const { prompt } = buildLogsAnalysisPrompt({
        logs: [createLog({ text: '', author: 'Muet' })],
        storedCount: 1,
    });

    assert.match(prompt, /— Muet/);
}

function testMarkdownIsRequested(): void {
    const { prompt } = buildLogsAnalysisPrompt({ logs: [createLog()], storedCount: 1 });

    // Le panneau rend désormais du Markdown : le prompt doit le demander.
    assert.match(prompt, /Réponds en \*\*Markdown\*\*/);
}

function run(): void {
    testScopeIsAnnouncedToTheModel();
    testCompleteScopeCarriesNoWarning();
    testAnUnknownRemoteTotalDoesNotInventAScope();
    testStoredLogsBeyondTheCapMakeTheScopePartial();
    testHintIsIncludedOrSaidAbsent();
    testLogsAreRenderedWithTheirHeader();
    testALongLogIsCutOnAWordAndSaysSo();
    testAShortLogIsLeftIntact();
    testAnEmptyLogKeepsItsHeader();
    testMarkdownIsRequested();
    // eslint-disable-next-line no-console
    console.log('geocache-logs-analysis-prompt tests passed');
}

run();
