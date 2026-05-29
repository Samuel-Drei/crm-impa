# startall.ps1 - Sobe infra (postgres, redis, qdrant, docling) + Backend + Frontend
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  IMPA CRM - Subindo TUDO"                  -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Verifica Docker
try {
    docker info | Out-Null
} catch {
    Write-Host "Docker nao esta rodando. Inicie o Docker Desktop primeiro." -ForegroundColor Red
    exit 1
}

Write-Host "`n[Docker] Subindo postgres, redis, qdrant, docling..." -ForegroundColor Green
docker compose -f "$root\docker-compose-dev.yml" up -d

Write-Host "`nAguardando Postgres ficar saudavel..." -ForegroundColor Yellow
$tries = 0
while ($tries -lt 30) {
    $status = (docker inspect -f '{{.State.Health.Status}}' crm_impa_postgres 2>$null)
    if ($status -eq 'healthy') { Write-Host "Postgres OK." -ForegroundColor Green; break }
    Start-Sleep -Seconds 2
    $tries++
}

# Garante diretorios usados pelo backend
$dirs = @("backend\uploads", "backend\public\docs", "backend\sessions", "backend\ai-workspace", "frontend\dist")
foreach ($d in $dirs) {
    $p = Join-Path $root $d
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

# Prisma generate + migrate deploy
Write-Host "`n[Prisma] Gerando client e aplicando migrations..." -ForegroundColor Green
Push-Location "$root\backend"
try {
    npx --yes prisma generate | Out-Null
    npx --yes prisma migrate deploy
} finally {
    Pop-Location
}

# Inicia front e back
& "$root\start.ps1"

Write-Host "`nTUDO iniciado." -ForegroundColor Green
