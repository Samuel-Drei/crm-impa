# start.ps1 - Inicia Backend e Frontend localmente (npm run dev) em janelas separadas
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  IMPA CRM - Iniciando Backend e Frontend" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Garante backend\.env
$backendEnv = Join-Path $root "backend\.env"
if (-not (Test-Path $backendEnv)) {
    Write-Host "`n[Setup] backend\.env nao encontrado. Criando com defaults de desenvolvimento..." -ForegroundColor Yellow
    $envContent = @"
# Server
NODE_ENV=development
PORT=3333
FRONTEND_URL=http://localhost:5454
BACKEND_URL=http://localhost:3333
BACKEND_INTERNAL_URL=http://localhost:3333
API_URL=http://localhost:3333

# Database
DATABASE_URL=postgresql://crm_impa:crm_impa_2026@localhost:5434/crm_impa_db?schema=public

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT / Security
JWT_SECRET=crm-impa-dev-secret-key-local-2026
JWT_EXPIRES_IN=7d
ENCRYPTION_KEK=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2

# Meta / Cloud API
META_APP_ID=
META_APP_SECRET=
META_BUSINESS_ID=
META_ACCESS_TOKEN=
META_WEBHOOK_VERIFY_TOKEN=
META_API_VERSION=v24.0

# Evo Go
EVO_GO_API_URL=http://localhost:4000
EVO_GO_GLOBAL_API_KEY=evolution-go-dev-key-2024

# Baileys
BAILEYS_SESSIONS_PATH=./sessions

# AI Providers
OPENAI_API_KEY=
GEMINI_API_KEY=
CLAUDE_API_KEY=
COHERE_API_KEY=
VOYAGE_API_KEY=
AI_DEFAULT_PROVIDER=OPENAI
AI_DEFAULT_MODEL=gpt-4o-mini

# RAG / Vector
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=

# Docling
DOCLING_SERVICE_URL=http://localhost:8000

# Whisper (opcional)
WHISPER_ENDPOINT=
WHISPER_LOCAL_URL=
WHISPER_BASE_URL=

# YouTube (opcional)
YT_PROXY_URL=
YT_COOKIES_DIR=
YT_COOKIES_FILE=
YT_DLP_PLAYER_CLIENTS=tv_embedded,mediaconnect,web_safari,mweb,ios,android,web
HTTPS_PROXY=
HTTP_PROXY=

# AI Workspace (precisa ser caminho absoluto - exigencia do @fastify/static)
AI_WORKSPACE_ROOT=$($root -replace '\\','/')/backend/ai-workspace

# Typebot (opcional)
TYPEBOT_API_URL=
TYPEBOT_API_KEY=

# N8N (opcional)
N8N_WEBHOOK_URL=

# Credenciais iniciais (criadas via 'npx prisma db seed')
ADMIN_EMAIL=admin@whatsapp.local
ADMIN_PASSWORD=admin123
"@
    Set-Content -Path $backendEnv -Value $envContent -Encoding UTF8 -NoNewline
    Write-Host "[Setup] backend\.env criado." -ForegroundColor Green
}

# Garante frontend\.env
$frontendEnv = Join-Path $root "frontend\.env"
if (-not (Test-Path $frontendEnv)) {
    Write-Host "[Setup] frontend\.env nao encontrado. Criando..." -ForegroundColor Yellow
    $frontEnvContent = @"
VITE_API_URL=http://localhost:3333
# Meta Embedded Signup (Cloud API onboarding via popup)
VITE_META_APP_ID=
# ID da configuracao de Embedded Signup criada no Meta App Dashboard
VITE_META_CONFIG_ID=
"@
    Set-Content -Path $frontendEnv -Value $frontEnvContent -Encoding UTF8 -NoNewline
    Write-Host "[Setup] frontend\.env criado." -ForegroundColor Green
}

# Aviso: BACKEND_URL local com instancia EVO_GO remota nao funciona (webhook nao chega)
try {
    $envContent = Get-Content $backendEnv -Raw -ErrorAction SilentlyContinue
    if ($envContent -match '(?m)^BACKEND_URL=(.+)$') {
        $burl = $matches[1].Trim()
        if ($burl -match 'localhost|127\.0\.0\.1') {
            $hasExternalEvo = docker exec crm_impa_postgres psql -U crm_impa -d crm_impa_db -tAc "SELECT 1 FROM instances WHERE channel='EVO_GO' AND status='CONNECTED' AND \`"evoApiUrl\`" NOT LIKE '%localhost%' AND \`"evoApiUrl\`" NOT LIKE '%127.0.0.1%' LIMIT 1;" 2>$null
            if ($hasExternalEvo -eq '1') {
                Write-Host "`n=========================================="    -ForegroundColor Red
                Write-Host "  AVISO: BACKEND_URL=$burl (localhost)"           -ForegroundColor Red
                Write-Host "  Existe instancia EVO_GO conectada a Evo Go REMOTA." -ForegroundColor Red
                Write-Host "  O webhook nao vai chegar (Evo Go nao alcanca seu localhost)." -ForegroundColor Red
                Write-Host "  Solucao: rode .\tunnel.ps1 (Cloudflare Tunnel) e reconecte a instancia." -ForegroundColor Yellow
                Write-Host "=========================================="    -ForegroundColor Red
            }
        }
    }
} catch {}

# Backend (titulo marcado para o stop.ps1 conseguir identificar e fechar a janela)
Write-Host "`n[Backend] Abrindo janela em $root\backend ..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = 'IMPA-CRM-Backend'; cd '$root\backend'; npm run dev"

Start-Sleep -Seconds 2

# Frontend
Write-Host "[Frontend] Abrindo janela em $root\frontend ..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = 'IMPA-CRM-Frontend'; cd '$root\frontend'; npm run dev"

Write-Host "`nBackend:  http://localhost:3333" -ForegroundColor Yellow
Write-Host "Frontend: http://localhost:5454" -ForegroundColor Yellow
