# stop.ps1 - Para Backend (3333) e Frontend (5454):
#   1. Mata os processos node escutando nas portas
#   2. Fecha as janelas PowerShell criadas pelo start.ps1 (marcadas por titulo)
$ErrorActionPreference = "SilentlyContinue"

function Stop-Port($port, $label) {
    Write-Host "Parando $label (porta $port)..." -ForegroundColor Yellow
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Host "  Nenhum processo escutando na porta $port." -ForegroundColor DarkGray
        return
    }
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $pids) {
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host "  PID $procId encerrado." -ForegroundColor Green
        } catch {
            Write-Host "  Falha ao encerrar PID $procId : $_" -ForegroundColor Red
        }
    }
}

function Close-WindowByTitle($title) {
    $procs = Get-Process | Where-Object { $_.MainWindowTitle -eq $title }
    if (-not $procs) {
        Write-Host "  Nenhuma janela '$title' encontrada." -ForegroundColor DarkGray
        return
    }
    foreach ($p in $procs) {
        try {
            Stop-Process -Id $p.Id -Force -ErrorAction Stop
            Write-Host "  Janela '$title' (PID $($p.Id)) fechada." -ForegroundColor Green
        } catch {
            Write-Host "  Falha ao fechar janela '$title' (PID $($p.Id)): $_" -ForegroundColor Red
        }
    }
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  IMPA CRM - Parando Backend e Frontend"  -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

Stop-Port 3333 "Backend"
Stop-Port 5454 "Frontend"

Write-Host "`nFechando janelas..." -ForegroundColor Yellow
Close-WindowByTitle "IMPA-CRM-Backend"
Close-WindowByTitle "IMPA-CRM-Frontend"

Write-Host "`nConcluido." -ForegroundColor Green
