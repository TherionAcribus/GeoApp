import * as assert from 'assert/strict';
import { checkGeoAppLocalModel, isGeoAppStrictLocalAgent } from '../geoapp-local-model-guard';

function testOllamaLocalHostIsLocal(): void {
    const check = checkGeoAppLocalModel(
        { id: 'ollama/llama3.1' },
        { ollamaHost: 'http://localhost:11434' }
    );
    assert.equal(check.status, 'local');
    assert.equal(check.source, 'ollama-endpoint');
}

function testOllamaRemoteHostIsRejected(): void {
    const check = checkGeoAppLocalModel(
        { id: 'ollama/llama3.1' },
        { ollamaHost: 'https://ollama.example.com' }
    );
    assert.equal(check.status, 'remote');
    assert.equal(check.source, 'ollama-endpoint');
}

function testLmStudioLocalHostIsLocal(): void {
    const check = checkGeoAppLocalModel(
        { id: 'lmstudio/qwen2.5' },
        { lmstudioBaseUrl: 'http://localhost:1234' }
    );
    assert.equal(check.status, 'local');
    assert.equal(check.source, 'lmstudio-endpoint');
}

function testLmStudioRemoteHostIsRejected(): void {
    const check = checkGeoAppLocalModel(
        { id: 'lmstudio/qwen2.5' },
        { lmstudioBaseUrl: 'https://lmstudio.example.com' }
    );
    assert.equal(check.status, 'remote');
    assert.equal(check.source, 'lmstudio-endpoint');
}

function testKnownCloudModelIsRejected(): void {
    const check = checkGeoAppLocalModel({ id: 'openai/gpt-4o' });
    assert.equal(check.status, 'remote');
    assert.equal(check.source, 'cloud-model-id');
}

function testOpenAiCompatiblePrivateEndpointIsLocal(): void {
    const check = checkGeoAppLocalModel(
        { id: 'lmstudio/qwen-local' },
        {
            openAiCustomModels: [{
                id: 'lmstudio/qwen-local',
                model: 'qwen-local',
                url: 'http://192.168.1.20:1234/v1',
            }],
        }
    );
    assert.equal(check.status, 'local');
    assert.equal(check.source, 'openai-compatible-endpoint');
}

function testOpenAiCompatibleRemoteEndpointIsRejected(): void {
    const check = checkGeoAppLocalModel(
        { id: 'custom/cloud-model' },
        {
            openAiCustomModels: [{
                id: 'custom/cloud-model',
                model: 'cloud-model',
                url: 'https://api.example.com/v1',
            }],
        }
    );
    assert.equal(check.status, 'remote');
    assert.equal(check.source, 'openai-compatible-endpoint');
}

function testOpenAiVendorWithLocalEndpointIsLocal(): void {
    const check = checkGeoAppLocalModel(
        { id: 'lmstudio/local-model', vendor: 'openai' },
        {
            openAiCustomModels: [{
                id: 'lmstudio/local-model',
                model: 'local-model',
                url: 'http://localhost:1234/v1',
            }],
        }
    );
    assert.equal(check.status, 'local');
    assert.equal(check.source, 'openai-compatible-endpoint');
}

function testVercelCustomEndpointIsResolvedWithPrefix(): void {
    const check = checkGeoAppLocalModel(
        { id: 'vercel/local-openai' },
        {
            vercelCustomModels: [{
                id: 'local-openai',
                model: 'local-openai',
                url: 'http://127.0.0.1:8080/v1',
            }],
        }
    );
    assert.equal(check.status, 'local');
    assert.equal(check.source, 'openai-compatible-endpoint');
}

function testAllowlistAcceptsUnknownLocalModel(): void {
    const check = checkGeoAppLocalModel(
        { id: 'company-llm/local-model' },
        { localModelIds: ['company-llm/*'] }
    );
    assert.equal(check.status, 'local');
    assert.equal(check.source, 'local-model-allowlist');
}

function testAllowlistCannotOverrideKnownCloudId(): void {
    const check = checkGeoAppLocalModel(
        { id: 'openrouter/strong' },
        { localModelIds: ['openrouter/*'] }
    );
    assert.equal(check.status, 'remote');
    assert.equal(check.source, 'cloud-model-id');
}

function testUnknownModelIsRejected(): void {
    const check = checkGeoAppLocalModel({ id: 'mystery/model' });
    assert.equal(check.status, 'unknown');
}

function testIpv6PrivateHostsAreLocal(): void {
    for (const host of [
        'http://[::1]:11434',
        'http://[fc00::1]:11434',
        'http://[fd12::1]:11434',
        'http://[fe80::1]:11434',
        'http://[fe90::1]:11434',
    ]) {
        const check = checkGeoAppLocalModel({ id: 'ollama/llama3.1' }, { ollamaHost: host });
        assert.equal(check.status, 'local', host);
    }
}

function testIpv6PublicHostIsRejected(): void {
    const check = checkGeoAppLocalModel(
        { id: 'ollama/llama3.1' },
        { ollamaHost: 'http://[2001:4860:4860::8888]:11434' }
    );
    assert.equal(check.status, 'remote');
    assert.equal(check.source, 'ollama-endpoint');
}

function testDnsNameWithIpv6PrefixIsRejected(): void {
    for (const host of [
        'https://fc-example.com',
        'https://fd-example.com',
        'https://fe80-example.com',
    ]) {
        const check = checkGeoAppLocalModel({ id: 'ollama/llama3.1' }, { ollamaHost: host });
        assert.equal(check.status, 'remote', host);
        assert.equal(check.source, 'ollama-endpoint', host);
    }
}

function testIpv4MappedIpv6UsesIpv4Classification(): void {
    const local = checkGeoAppLocalModel(
        { id: 'ollama/llama3.1' },
        { ollamaHost: 'http://[::ffff:127.0.0.1]:11434' }
    );
    assert.equal(local.status, 'local');

    const remote = checkGeoAppLocalModel(
        { id: 'ollama/llama3.1' },
        { ollamaHost: 'http://[::ffff:8.8.8.8]:11434' }
    );
    assert.equal(remote.status, 'remote');
}

function testStrictLocalAgentIds(): void {
    assert.equal(isGeoAppStrictLocalAgent('geoapp-chat-local'), true);
    assert.equal(isGeoAppStrictLocalAgent('geoapp-formula-solver-local'), true);
    assert.equal(isGeoAppStrictLocalAgent('geoapp-chat-fast'), false);
    assert.equal(isGeoAppStrictLocalAgent(undefined), false);
}

function run(): void {
    testOllamaLocalHostIsLocal();
    testOllamaRemoteHostIsRejected();
    testLmStudioLocalHostIsLocal();
    testLmStudioRemoteHostIsRejected();
    testKnownCloudModelIsRejected();
    testOpenAiCompatiblePrivateEndpointIsLocal();
    testOpenAiCompatibleRemoteEndpointIsRejected();
    testOpenAiVendorWithLocalEndpointIsLocal();
    testVercelCustomEndpointIsResolvedWithPrefix();
    testAllowlistAcceptsUnknownLocalModel();
    testAllowlistCannotOverrideKnownCloudId();
    testUnknownModelIsRejected();
    testIpv6PrivateHostsAreLocal();
    testIpv6PublicHostIsRejected();
    testDnsNameWithIpv6PrefixIsRejected();
    testIpv4MappedIpv6UsesIpv4Classification();
    testStrictLocalAgentIds();
    // eslint-disable-next-line no-console
    console.log('geoapp-local-model-guard tests passed');
}

run();
