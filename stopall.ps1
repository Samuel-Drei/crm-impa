# stopall.ps1 - Para Backend, Frontend e containers (postgres, redis, qdrant, docling)
$ErrorActionPreference = "Continue"
$root = $PSScriptRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  IMPA CRM - Parando TUDO"                  -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

& "$root\stop.ps1"

Write-Host "`n[Docker] Parando containers..." -ForegroundColor Yellow
docker compose -f "$root\docker-compose-dev.yml" down

Write-Host "`nTUDO parado." -ForegroundColor Green
