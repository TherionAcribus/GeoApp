const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const browserDir = path.resolve(__dirname, '..', 'applications', 'browser');
const requiredOutputs = [
    path.join(browserDir, 'src-gen', 'backend', 'main.js'),
    path.join(browserDir, 'src-gen', 'frontend', 'index.html'),
    path.join(browserDir, 'gen-webpack.config.js')
];

function ensureBrowserBuild() {
    const missingOutputs = requiredOutputs.filter(target => !fs.existsSync(target));

    if (missingOutputs.length === 0) {
        return;
    }

    console.log('Theia browser build artifacts are missing. Running `yarn build` once before start...');

    const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
    const result = spawnSync(yarnCommand, ['build'], {
        cwd: browserDir,
        stdio: 'inherit',
        env: process.env
    });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

module.exports = {
    browserDir,
    ensureBrowserBuild
};

if (require.main === module) {
    ensureBrowserBuild();
}
