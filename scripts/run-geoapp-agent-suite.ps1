param(
    [switch]$FrontendOnly,
    [switch]$BackendOnly,
    [switch]$SkipBuild,
    [switch]$IncludeElectron
)

$ErrorActionPreference = 'Stop'

if ($FrontendOnly -and $BackendOnly) {
    throw 'Use either -FrontendOnly or -BackendOnly, not both.'
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$TheiaRoot = Join-Path $RepoRoot 'theia-blueprint'
$BackendRoot = Join-Path $RepoRoot 'gc-backend'
$ElectronAppRoot = Join-Path $TheiaRoot 'applications/electron'

function Assert-CommandAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName
    )

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $CommandName"
    }
}

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host ''
    Write-Host "==> $Name" -ForegroundColor Cyan
    Push-Location $WorkingDirectory
    try {
        & $Action
        if ($LASTEXITCODE -ne 0) {
            throw "Step failed: $Name"
        }
    } finally {
        Pop-Location
    }
}

Assert-CommandAvailable -CommandName 'python'
Assert-CommandAvailable -CommandName 'yarn'

if (-not $FrontendOnly) {
    Invoke-Step -Name 'Backend plugins_api suite' -WorkingDirectory $BackendRoot -Action {
        python -m pytest tests/test_plugins_api.py -q
    }

    Invoke-Step -Name 'Backend archive_api suite' -WorkingDirectory $BackendRoot -Action {
        python -m pytest tests/test_archive_api.py -q
    }
}

if (-not $BackendOnly) {
    if (-not $SkipBuild) {
        Invoke-Step -Name 'Build plugins extension' -WorkingDirectory (Join-Path $TheiaRoot 'theia-extensions/plugins') -Action {
            yarn build
        }

        Invoke-Step -Name 'Build zones extension' -WorkingDirectory (Join-Path $TheiaRoot 'theia-extensions/zones') -Action {
            yarn build
        }
    }

    Invoke-Step -Name 'GeoApp frontend tests - plugins' -WorkingDirectory (Join-Path $TheiaRoot 'theia-extensions/plugins') -Action {
        yarn test:geoapp
    }

    Invoke-Step -Name 'GeoApp frontend tests - zones' -WorkingDirectory (Join-Path $TheiaRoot 'theia-extensions/zones') -Action {
        yarn test:geoapp
    }

    if ($IncludeElectron) {
        $ElectronDist = Join-Path $ElectronAppRoot 'dist'
        if (-not (Test-Path $ElectronDist)) {
            throw "Electron dist not found at '$ElectronDist'. Build the electron app first or omit -IncludeElectron."
        }

        Invoke-Step -Name 'Electron smoke tests' -WorkingDirectory $ElectronAppRoot -Action {
            yarn test
        }
    }
}

Write-Host ''
Write-Host 'GeoApp agent validation suite completed successfully.' -ForegroundColor Green
