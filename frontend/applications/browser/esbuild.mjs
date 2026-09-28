/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch, join, __dirname } from './gen-esbuild.browser.mjs';
import { nodeOptions, nativeBindings } from './gen-esbuild.node.mjs';
import { copy } from 'esbuild-plugin-copy';
import esbuild from 'esbuild';
import path from 'node:path';

// GeoApp documentation imports Markdown as source text.
browserOptions.loader = {
    ...browserOptions.loader,
    '.md': 'text'
};

const geoAppAssetsPlugin = copy({
    assets: [
        {
            // Serve the application icon from the frontend root.
            from: join(__dirname, 'ico', '*'),
            to: join(__dirname, 'lib', 'frontend')
        },
        {
            // Documentation images referenced by the generated registry.
            from: join(__dirname, '..', '..', 'theia-extensions', 'documentation', 'docs', 'assets', '**', '*'),
            to: join(__dirname, 'lib', 'frontend', 'docs-assets')
        }
    ]
});

// Keep asset copying before Theia's compression plugin so copied assets can be compressed too.
browserOptions.plugins.splice(browserOptions.plugins.length - 1, 0, geoAppAssetsPlugin);

// GeoApp does not need drive enumeration in the browser backend and avoids the drivelist native module.
nodeOptions.alias = {
    ...(nodeOptions.alias || {}),
    drivelist: path.resolve(__dirname, 'src', 'webpack-stubs', 'drivelist.js')
};
delete nativeBindings.drivelist;

// Preserve the previous webpack IgnorePlugin behavior: certificate lookup failures are
// handled by @vscode/proxy-agent without loading the optional native module.
const windowsCaCertsStubPlugin = {
    name: 'geoapp-windows-ca-certs-stub',
    setup(build) {
        build.onResolve({ filter: /^@vscode\/windows-ca-certs$/ }, () => ({
            path: '@vscode/windows-ca-certs',
            namespace: 'geoapp-empty-module'
        }));
        build.onLoad({ filter: /.*/, namespace: 'geoapp-empty-module' }, () => ({
            contents: 'module.exports = {};',
            loader: 'js'
        }));
    }
};
nodeOptions.plugins.unshift(windowsCaCertsStubPlugin);

const browserContext = await esbuild.context(browserOptions);
const nodeContext = await esbuild.context(nodeOptions);

if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
    } catch {
        process.exit(1);
    }
}
