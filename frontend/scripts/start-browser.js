const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { ensureBrowserBuild, browserDir } = require('./ensure-browser-build');

function readOption(args, longName, shortName, fallback) {
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === longName || arg === shortName) {
            return args[i + 1] ?? fallback;
        }
        if (arg.startsWith(`${longName}=`)) {
            return arg.slice(longName.length + 1);
        }
        if (shortName && arg.startsWith(`${shortName}=`)) {
            return arg.slice(shortName.length + 1);
        }
    }
    return fallback;
}

function inspectPortOnWindows(port) {
    const netTcp = spawnSync(
        'powershell.exe',
        [
            '-NoProfile',
            '-Command',
            `Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq ${port} } | Select-Object -First 1 -ExpandProperty OwningProcess`
        ],
        { encoding: 'utf8' }
    );

    const pid = (netTcp.stdout || '').trim();
    if (!pid) {
        return null;
    }

    const proc = spawnSync(
        'powershell.exe',
        [
            '-NoProfile',
            '-Command',
            `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -ExpandProperty CommandLine`
        ],
        { encoding: 'utf8' }
    );

    return {
        pid,
        commandLine: (proc.stdout || '').trim()
    };
}

function handleBusyPort(port) {
    if (process.platform === 'win32') {
        const details = inspectPortOnWindows(port);
        if (details?.commandLine.includes(`${browserDir}\\lib\\backend\\main.js`)) {
            console.log(`GeoApp frontend is already running on http://127.0.0.1:${port} (PID ${details.pid}).`);
            process.exit(0);
        }

        if (details?.pid) {
            console.error(`Port ${port} is already in use by PID ${details.pid}. Stop the process or start Theia on another port with \`yarn start --port 3001\`.`);
            process.exit(1);
        }
    }

    console.error(`Port ${port} is already in use. Stop the process or start Theia on another port with \`yarn start --port 3001\`.`);
    process.exit(1);
}

function start() {
    ensureBrowserBuild();

    const extraArgs = process.argv.slice(2);
    const port = Number(readOption(extraArgs, '--port', '-p', process.env.THEIA_PORT || process.env.PORT || '3000'));
    const inspect = spawnSync(
        'node',
        [
            '-e',
            `
                const net = require('net');
                const server = net.createServer();
                server.once('error', err => {
                    if (err && err.code === 'EADDRINUSE') {
                        process.exit(10);
                    }
                    process.exit(11);
                });
                server.once('listening', () => {
                    server.close(() => process.exit(0));
                });
                server.listen(${port}, '127.0.0.1');
            `
        ],
        { stdio: 'ignore' }
    );

    if (inspect.status === 10) {
        handleBusyPort(port);
    }

    const theiaCommand = path.join(
        browserDir,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'theia.cmd' : 'theia'
    );
    const child = spawn(
        theiaCommand,
        ['start', '--plugins=local-dir:../../plugins', ...extraArgs],
        {
            cwd: browserDir,
            stdio: 'inherit',
            env: process.env,
            shell: process.platform === 'win32'
        }
    );

    child.on('error', error => {
        console.error(`Failed to start Theia with ${theiaCommand}: ${error.message}`);
        process.exit(1);
    });

    child.on('exit', code => {
        process.exit(code ?? 0);
    });
}

start();
