import * as assert from 'assert/strict';
import { DocContentService } from '../doc-content-service';
import { resolveDocSearchContent } from '../doc-search-service';
import { DocPageMeta, DocSearchResult, DocSection } from '../doc-types';

function createPage(): DocPageMeta {
    return {
        id: 'zones',
        chapter: 'zones',
        title: 'Gestion des zones',
        description: 'Créer et organiser les zones.',
        order: 1,
        tags: ['zones', 'organisation'],
        content: [
            '---',
            'title: "Gestion des zones"',
            '---',
            '# Gestion des zones',
            '',
            'Les zones regroupent les géocaches.',
            '',
            '## Créer une zone',
            '',
            'Cliquez sur le bouton « Nouvelle zone » puis saisissez un nom.',
            '',
            '### Nommer la zone',
            '',
            'Le nom doit être unique.',
            '',
            '## Supprimer une zone',
            '',
            'La suppression est irréversible.',
        ].join('\n'),
    };
}

// Les ancres produites par extractSections doivent être stables et normalisées
// (accents retirés, minuscules, tirets), car aide_search_docs s'en sert pour
// retrouver le contenu complet d'une section.
function testExtractSectionsProducesNormalizedAnchors(): void {
    const content = new DocContentService();
    const sections = content.extractSections(createPage());

    const anchors = sections.map(s => s.anchor);
    assert.ok(anchors.includes('creer-une-zone'), `ancre "creer-une-zone" absente: ${anchors.join(', ')}`);
    assert.ok(anchors.includes('supprimer-une-zone'), `ancre "supprimer-une-zone" absente: ${anchors.join(', ')}`);

    const creer = sections.find(s => s.anchor === 'creer-une-zone');
    assert.ok(creer, 'section "Créer une zone" introuvable');
    assert.match(creer!.text, /Nouvelle zone/);
    assert.equal(creer!.pageId, 'zones');

    // Une sous-section h3 devient une section distincte (avec sa propre ancre),
    // elle n'est PAS fusionnée dans sa section h2 parente.
    const nommer = sections.find(s => s.anchor === 'nommer-la-zone');
    assert.ok(nommer, 'sous-section h3 "Nommer la zone" introuvable');
    assert.equal(nommer!.level, 3);
    assert.match(nommer!.text, /Le nom doit être unique/);
    assert.doesNotMatch(creer!.text, /Le nom doit être unique/);
}

// Contrat cœur de aide_search_docs : un résultat de recherche (pageId + ancre)
// est bien relié à la section complète correspondante.
function testResolveReconstructsFullSectionContent(): void {
    const content = new DocContentService();
    const sections = content.extractSections(createPage());
    const getSectionsForPage = (pageId: string): DocSection[] => sections.filter(s => s.pageId === pageId);

    const hit: DocSearchResult = {
        pageId: 'zones',
        sectionAnchor: 'supprimer-une-zone',
        pageTitle: 'Gestion des zones',
        sectionTitle: 'Supprimer une zone',
        excerpt: 'La suppression est...',
        score: 1,
    };

    const [result] = resolveDocSearchContent([hit], getSectionsForPage);
    assert.equal(result.page, 'Gestion des zones');
    assert.equal(result.section, 'Supprimer une zone');
    // On récupère le contenu COMPLET, pas seulement l'extrait.
    assert.match(result.content, /La suppression est irréversible/);
    assert.notEqual(result.content, hit.excerpt);
}

// Si la section n'est pas retrouvée (ancre orpheline), on retombe sur l'extrait
// plutôt que de renvoyer du vide.
function testResolveFallsBackToExcerpt(): void {
    const hit: DocSearchResult = {
        pageId: 'inconnu',
        sectionAnchor: 'section-fantome',
        pageTitle: 'Page inconnue',
        sectionTitle: 'Section fantôme',
        excerpt: 'Extrait de secours.',
        score: 1,
    };

    const [result] = resolveDocSearchContent([hit], () => []);
    assert.equal(result.content, 'Extrait de secours.');
}

function run(): void {
    testExtractSectionsProducesNormalizedAnchors();
    testResolveReconstructsFullSectionContent();
    testResolveFallsBackToExcerpt();
    // eslint-disable-next-line no-console
    console.log('doc-search tests passed');
}

run();
