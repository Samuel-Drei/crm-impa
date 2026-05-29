# restartall.ps1 - Reinicia infra + Backend + Frontend
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "Reiniciando TUDO..." -ForegroundColor Cyan

& "$root\stopall.ps1"
Start-Sleep -Seconds 3
& "$root\startall.ps1"
