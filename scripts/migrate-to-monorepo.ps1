# =============================================================================
# Script de migration vers le monorepo GeoApp
# Usage: powershell -ExecutionPolicy Bypass -File scripts/migrate-to-monorepo.ps1
# Utilise robocopy /MOVE pour contourner les locks Windows/IDE
# =============================================================================

$ErrorActionPreference = "Continue"
$ROOT = "c:\Users\Utilisateur\PycharmProjects\GeoApp"

function Move-DirRobust($src, $dst, $label) {
    if (-not (Test-Path $src)) {
        if (Test-Path $dst) {
            Write-Host "[OK] $label deja fait" -ForegroundColor Green
            return
        }
        Write-Host "[ERREUR] Ni $src ni $dst trouve !" -ForegroundColor Red
        exit 1
    }
    Write-Host "  $label ..." -ForegroundColor Yellow
    # Tenter Rename-Item d'abord (plus rapide)
    try {
        Rename-Item -Path $src -NewName (Split-Path $dst -Leaf) -ErrorAction Stop
        Write-Host "  OK (rename)" -ForegroundColor Green
        return
    } catch {
        Write-Host "  Rename bloque, fallback robocopy..." -ForegroundColor DarkYellow
    }
    # Fallback: robocopy /MOVE (copie + suppression fichier par fichier)
    $null = robocopy $src $dst /E /MOVE /R:2 /W:1 /NFL /NDL /NJH /NJS /NC /NS
    # robocopy retourne 0-7 en succes, 8+ en erreur
    if ($LASTEXITCODE -le 7) {
        # Supprimer le dossier source vide restant
        if (Test-Path $src) { Remove-Item -Recurse -Force $src -ErrorAction SilentlyContinue }
        Write-Host "  OK (robocopy)" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] robocopy exit $LASTEXITCODE - verifier manuellement" -ForegroundColor Red
    }
}

Write-Host "=== Migration GeoApp vers monorepo ===" -ForegroundColor Cyan
Write-Host ""

# --- Phase 3b: Renommages ---
Write-Host "[1/6] Renommages ..." -ForegroundColor Cyan
Move-DirRobust "$ROOT\theia-blueprint" "$ROOT\frontend" "theia-blueprint -> frontend"
Move-DirRobust "$ROOT\gc-backend" "$ROOT\backend" "gc-backend -> backend"

# --- Phase 3c: Déplacer plugins/ et alphabets/ en racine ---
$BACKEND = "$ROOT\backend"

if (Test-Path "$BACKEND\plugins") {
    Write-Host "[3/6] Déplacement backend/plugins/ -> plugins/ ..." -ForegroundColor Yellow
    Move-Item -Path "$BACKEND\plugins" -Destination "$ROOT\plugins"
    Write-Host "  OK" -ForegroundColor Green
} else {
    Write-Host "[OK] plugins/ déjà déplacé" -ForegroundColor Green
}

if (Test-Path "$BACKEND\alphabets") {
    Write-Host "[4/6] Déplacement backend/alphabets/ -> alphabets/ ..." -ForegroundColor Yellow
    Move-Item -Path "$BACKEND\alphabets" -Destination "$ROOT\alphabets"
    Write-Host "  OK" -ForegroundColor Green
} else {
    Write-Host "[OK] alphabets/ déjà déplacé" -ForegroundColor Green
}

# --- Phase 4: Alléger le frontend (supprimer bruit upstream) ---
$FRONTEND = "$ROOT\frontend"

Write-Host "[5/6] Nettoyage du frontend (suppression du bruit upstream) ..." -ForegroundColor Yellow

$toRemove = @(
    "$FRONTEND\.github",
    "$FRONTEND\TheiaIDE logo",
    "$FRONTEND\applications\electron",
    "$FRONTEND\cleanup",
    "$FRONTEND\configs",
    "$FRONTEND\next",
    "$FRONTEND\releng",
    "$FRONTEND\CODE_OF_CONDUCT.md",
    "$FRONTEND\CONTRIBUTING.md",
    "$FRONTEND\NOTICE.md",
    "$FRONTEND\PUBLISHING.md",
    "$FRONTEND\browser.Dockerfile",
    "$FRONTEND\Dockerfile"
)

foreach ($item in $toRemove) {
    if (Test-Path $item) {
        Remove-Item -Recurse -Force $item
        Write-Host "  Supprimé: $($item.Replace($FRONTEND, 'frontend'))" -ForegroundColor DarkGray
    }
}

# --- Phase 5: Archiver old_code*/ ---
Write-Host "[6/6] Archivage des anciens codes ..." -ForegroundColor Yellow

$archiveDir = "$ROOT\archive"
if (-not (Test-Path $archiveDir)) {
    New-Item -ItemType Directory -Path $archiveDir | Out-Null
}

$oldDirs = @("old_code", "old_code_page_analysis", "old_code_plugins", "old_logs", "old_notes")
foreach ($dir in $oldDirs) {
    $src = "$ROOT\$dir"
    if (Test-Path $src) {
        Move-Item -Path $src -Destination "$archiveDir\$dir"
        Write-Host "  Archivé: $dir/ -> archive/$dir/" -ForegroundColor DarkGray
    }
}

# --- Suppression des anciens .git imbriqués ---
Write-Host ""
Write-Host "Suppression des anciens .git imbriqués ..." -ForegroundColor Yellow

if (Test-Path "$FRONTEND\.git") {
    Remove-Item -Recurse -Force "$FRONTEND\.git"
    Write-Host "  Supprimé: frontend/.git" -ForegroundColor DarkGray
}
if (Test-Path "$BACKEND\.git") {
    Remove-Item -Recurse -Force "$BACKEND\.git"
    Write-Host "  Supprimé: backend/.git" -ForegroundColor DarkGray
}

# --- Résumé ---
Write-Host ""
Write-Host "=== Migration terminée ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Structure finale:" -ForegroundColor White
Write-Host "  geoapp/"
Write-Host "    frontend/          (ex theia-blueprint, allégé)"
Write-Host "    backend/           (ex gc-backend)"
Write-Host "    plugins/           (ex backend/plugins)"
Write-Host "    alphabets/         (ex backend/alphabets)"
Write-Host "    docs/              (documentation centralisée)"
Write-Host "    archive/           (anciens codes)"
Write-Host "    scripts/"
Write-Host "    shared/"
Write-Host ""
Write-Host "Prochaines étapes manuelles:" -ForegroundColor Yellow
Write-Host "  1. Rouvrir le workspace dans Windsurf"
Write-Host "  2. Mettre à jour config.py (PLUGINS_DIR, ALPHABETS_DIR)"
Write-Host "  3. Initialiser le nouveau repo: git init && git add -A && git commit -m 'Initial monorepo commit'"
Write-Host ""
