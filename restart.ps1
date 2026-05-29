# restart.ps1 - Reinicia Backend e Frontend
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "Reiniciando Backend e Frontend..." -ForegroundColor Cyan

& "$root\stop.ps1"
Start-Sleep -Seconds 2
& "$root\start.ps1"
