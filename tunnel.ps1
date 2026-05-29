# tunnel.ps1 - Sobe um Cloudflare Tunnel apontando para o backend (porta 3333),
# captura a URL publica gerada, atualiza backend/.env (BACKEND_URL e BACKEND_INTERNAL_URL)
# e mantem o tunel rodando em primeiro plano.
#
# Pre-requisito: ter o cloudflared instalado.
#   - winget install --id Cloudflare.cloudflared
#   - ou baixar de https://github.com/cloudflare/cloudflared/releases
#
# Uso: .\tunnel.ps1
# Encerre com Ctrl+C (ao fechar, lembre de restaurar o backend\.env para localhost se quiser).

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$envFile = Join-Path $root "backend\.env"
$port = 3333

# Verifica cloudflared
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
    Write-Host "cloudflared nao encontrado. Instale com:" -ForegroundColor Red
    Write-Host "  winget install --id Cloudflare.cloudflared" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $envFile)) {
    Write-Host "backend\.env nao encontrado. Rode .\start.ps1 antes." -ForegroundColor Red
    exit 1
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Cloudflare Tunnel -> http://localhost:$port" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Aguardando URL publica..." -ForegroundColor Yellow

# Pipe stdout/stderr atraves de Tee-Object para capturar a URL enquanto exibe
$tunnelUrl = $null
$updated = $false

# Roda cloudflared e captura saida linha-a-linha
& cloudflared tunnel --url "http://localhost:$port" --no-autoupdate 2>&1 | ForEach-Object {
    $line = $_.ToString()
    Write-Host $line

    if (-not $updated -and $line -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $tunnelUrl = $matches[0]
        Write-Host "`n==========================================" -ForegroundColor Green
        Write-Host "  URL publica: $tunnelUrl" -ForegroundColor Green
        Write-Host "==========================================" -ForegroundColor Green

        # Atualiza backend\.env
        $content = Get-Content $envFile -Raw
        $content = $content -replace '^BACKEND_URL=.*$',          "BACKEND_URL=$tunnelUrl",          1, 'Multiline'
        $content = $content -replace '^BACKEND_INTERNAL_URL=.*$', "BACKEND_INTERNAL_URL=$tunnelUrl", 1, 'Multiline'
        $content = $content -replace '^API_URL=.*$',              "API_URL=$tunnelUrl",              1, 'Multiline'
        Set-Content -Path $envFile -Value $content -Encoding UTF8 -NoNewline

        Write-Host "[Setup] backend\.env atualizado." -ForegroundColor Green
        Write-Host "`nProximos passos:" -ForegroundColor Yellow
        Write-Host "  1. Em outro terminal: .\restart.ps1 (para o backend reler o .env)" -ForegroundColor Yellow
        Write-Host "  2. Na UI, reconecte a instancia EVO_GO (forca registro do novo webhook)" -ForegroundColor Yellow
        Write-Host "`nMantenha esta janela aberta enquanto usar o tunel.`n" -ForegroundColor Cyan
        $updated = $true
    }
}
