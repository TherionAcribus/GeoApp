import * as assert from 'assert/strict';
import { CancellationError, CancellationTokenSource } from '@theia/core';
import { GeocacheDetailsTranslationController } from '../geocache-details-translation-controller';
import { GeoAppAiOutputError } from '../geoapp-ai-execution-service';

function makeController(): GeocacheDetailsTranslationController {
    return new GeocacheDetailsTranslationController(
        undefined as never,
        undefined as never,
        undefined as never
    );
}

function httpError(status: number): Error {
    const error = new Error(`HTTP ${status}`);
    (error as Error & { response?: { status: number } }).response = { status };
    return error;
}

async function testTransientHttpErrorIsRetried(): Promise<void> {
    const controller = makeController() as any;
    let calls = 0;

    const result = await controller.withLlmRetry(async () => {
        calls++;
        if (calls === 1) {
            throw httpError(429);
        }
        return 'ok';
    }, () => false);

    assert.equal(result, 'ok');
    assert.equal(calls, 2);
}

async function testPermanentHttpErrorIsNotRetried(): Promise<void> {
    const controller = makeController() as any;
    let calls = 0;

    await assert.rejects(
        () => controller.withLlmRetry(async () => {
            calls++;
            throw httpError(401);
        }, () => false),
        /HTTP 401/
    );
    assert.equal(calls, 1);
}

async function testCancellationInterruptsRetryDelay(): Promise<void> {
    const controller = makeController() as any;
    const tokenSource = new CancellationTokenSource();
    let calls = 0;

    const operation = controller.withLlmRetry(async () => {
        calls++;
        throw httpError(429);
    }, () => false, tokenSource.token);
    tokenSource.cancel();

    await assert.rejects(operation, CancellationError);
    assert.equal(calls, 1);
    tokenSource.dispose();
}

async function testInvalidJsonIsExplicitlyTyped(): Promise<void> {
    const controller = makeController() as any;

    assert.throws(
        () => controller.extractJson('réponse non structurée'),
        (error: unknown) => error instanceof GeoAppAiOutputError && error.kind === 'invalid-json'
    );
}

async function run(): Promise<void> {
    await testTransientHttpErrorIsRetried();
    await testPermanentHttpErrorIsNotRetried();
    await testCancellationInterruptsRetryDelay();
    await testInvalidJsonIsExplicitlyTyped();
    console.log('geocache-details-translation-retry tests passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
