/**
 * Portée du panneau Logs : ce que le bandeau annonce, et quand il se tait.
 *
 * Le piège de cette règle est le bandeau permanent : le panneau est un panneau
 * latéral, toujours là, et un bandeau qui ne dit rien mangerait de la hauteur
 * à chaque log affiché. Il ne doit apparaître que s'il annonce un décalage ou
 * offre une destination.
 */
import * as assert from 'assert/strict';
import {
    describeGeocacheTab,
    normalizeLogsPanelSyncMode,
    resolveLogsScope,
} from '../geocache-logs-scope';

const GC1 = { geocacheId: 1, gcCode: 'GC0001', name: 'Le pont' };
const GC2 = { geocacheId: 2, gcCode: 'GC0002', name: 'La tour' };

function testSilentWhenAloneAndAligned(): void {
    // Un seul onglet, ses logs affichés : il n'y a rien à proposer.
    const scope = resolveLogsScope({
        current: GC1, active: GC1, openTabs: [GC1], following: true, followSuspended: false
    });
    assert.equal(scope.visible, false);
    assert.equal(scope.mismatch, false);
    assert.deepEqual(scope.others, []);
}

function testMismatchWhenActiveTabDiffers(): void {
    // Mode « sur demande » : on a changé d'onglet, les logs sont restés.
    const scope = resolveLogsScope({
        current: GC1, active: GC2, openTabs: [GC1, GC2], following: false, followSuspended: false
    });
    assert.equal(scope.mismatch, true);
    assert.equal(scope.visible, true);
    assert.deepEqual(scope.others, [GC2]);
}

function testEmptyPanelWithAnOpenTabIsAMismatch(): void {
    // Panneau vide au redémarrage : il y a bien quelque chose à proposer.
    const scope = resolveLogsScope({
        current: undefined, active: GC1, openTabs: [GC1], following: false, followSuspended: false
    });
    assert.equal(scope.mismatch, true);
    assert.equal(scope.visible, true);
}

function testNoTabOpenSaysNothing(): void {
    // Les logs d'une géocache dont l'onglet a été fermé : rien à rattraper.
    const scope = resolveLogsScope({
        current: GC1, active: undefined, openTabs: [], following: true, followSuspended: false
    });
    assert.equal(scope.mismatch, false);
    assert.equal(scope.visible, false);
}

function testOtherTabsAloneJustifyTheBanner(): void {
    // Aligné sur l'onglet actif, mais une autre géocache est ouverte : le
    // bandeau est le seul chemin vers ses logs sans quitter l'onglet courant.
    const scope = resolveLogsScope({
        current: GC1, active: GC1, openTabs: [GC1, GC2], following: true, followSuspended: false
    });
    assert.equal(scope.mismatch, false);
    assert.equal(scope.visible, true);
    assert.deepEqual(scope.others, [GC2]);
}

function testResumeOnlyOfferedWhenSuspended(): void {
    // « Reprendre le suivi » ne se propose qu'en mode suivi et suspendu :
    // ailleurs, le bouton ne changerait rien.
    assert.equal(resolveLogsScope({
        current: GC1, active: GC1, openTabs: [GC1], following: true, followSuspended: true
    }).canResumeFollow, true);

    assert.equal(resolveLogsScope({
        current: GC1, active: GC1, openTabs: [GC1], following: false, followSuspended: true
    }).canResumeFollow, false);

    assert.equal(resolveLogsScope({
        current: GC1, active: GC1, openTabs: [GC1], following: true, followSuspended: false
    }).canResumeFollow, false);
}

function testSuspendedFollowKeepsTheBannerVisible(): void {
    // Seule trace du choix manuel quand rien d'autre n'est ouvert : sans ça,
    // le suivi resterait suspendu sans que rien ne le dise.
    const scope = resolveLogsScope({
        current: GC1, active: GC1, openTabs: [GC1], following: true, followSuspended: true
    });
    assert.equal(scope.visible, true);
}

function testCurrentTabIsNeverProposedAsADestination(): void {
    // Deux onglets sur la même géocache, ou l'onglet courant lui-même :
    // basculer vers ce qui est déjà affiché n'est pas une destination.
    const scope = resolveLogsScope({
        current: GC1, active: GC1, openTabs: [GC1, { geocacheId: 1, gcCode: 'GC0001' }],
        following: false, followSuspended: false
    });
    assert.deepEqual(scope.others, []);
    assert.equal(scope.visible, false);
}

function testDescribeFallsBackFromCodeToName(): void {
    assert.equal(describeGeocacheTab(GC1), 'GC0001');
    // Fiche pas encore chargée : le code GC n'est pas connu.
    assert.equal(describeGeocacheTab({ geocacheId: 7, name: 'La tour' }), 'La tour');
    assert.equal(describeGeocacheTab({ geocacheId: 7 }), '#7');
}

function testSyncModeFallsBackToOnDemand(): void {
    // Le défaut conserve le comportement historique du panneau : il ne change
    // de géocache que sur demande.
    assert.equal(normalizeLogsPanelSyncMode('follow-active'), 'follow-active');
    assert.equal(normalizeLogsPanelSyncMode('on-demand'), 'on-demand');
    assert.equal(normalizeLogsPanelSyncMode(undefined), 'on-demand');
    assert.equal(normalizeLogsPanelSyncMode('autre-chose'), 'on-demand');
}

testSilentWhenAloneAndAligned();
testMismatchWhenActiveTabDiffers();
testEmptyPanelWithAnOpenTabIsAMismatch();
testNoTabOpenSaysNothing();
testOtherTabsAloneJustifyTheBanner();
testResumeOnlyOfferedWhenSuspended();
testSuspendedFollowKeepsTheBannerVisible();
testCurrentTabIsNeverProposedAsADestination();
testDescribeFallsBackFromCodeToName();
testSyncModeFallsBackToOnDemand();

console.log('geocache-logs-scope.test.ts OK');
