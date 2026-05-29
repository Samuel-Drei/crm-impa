/**
 * OAuth Service — Fluxos OAuth para GitHub Copilot e Antigravity
 * 
 * GitHub Copilot: Device Code Flow → copilotToken
 * Antigravity: Google OAuth2 Authorization Code → cloudcode-pa token
 */

// ═══ GitHub Copilot — Device Code Flow ═══

// Headers compatíveis com VS Code Copilot Chat (validados no GitHub)
// Refs: openclaw/extensions/github-copilot, hermes-agent/copilot_auth.py
const GITHUB_COPILOT_CONFIG = {
  clientId: 'Iv1.b507a08c87ecfe98',
  deviceCodeUrl: 'https://github.com/login/device/code',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  copilotTokenUrl: 'https://api.github.com/copilot_internal/v2/token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: 'read:user',
  userAgent: 'GitHubCopilotChat/0.26.7',
  editorVersion: 'vscode/1.104.1',
  editorPluginVersion: 'copilot-chat/0.26.7',
  apiVersion: '2025-04-01',
  copilotIntegrationId: 'vscode-chat',
}

/** Headers obrigatórios para chamadas à API interna do Copilot */
function copilotApiHeaders(githubToken: string): Record<string, string> {
  return {
    Authorization: `token ${githubToken}`,
    Accept: 'application/json',
    'Editor-Version': GITHUB_COPILOT_CONFIG.editorVersion,
    'Editor-Plugin-Version': GITHUB_COPILOT_CONFIG.editorPluginVersion,
    'User-Agent': GITHUB_COPILOT_CONFIG.userAgent,
    'X-GitHub-Api-Version': GITHUB_COPILOT_CONFIG.apiVersion,
    'Copilot-Integration-Id': GITHUB_COPILOT_CONFIG.copilotIntegrationId,
  }
}

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export interface CopilotTokenResponse {
  token: string
  expires_at: number
  endpoints?: { api: string }
}

/** Step 1: Request device code from GitHub */
export async function requestGitHubDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(GITHUB_COPILOT_CONFIG.deviceCodeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: GITHUB_COPILOT_CONFIG.clientId,
      scope: GITHUB_COPILOT_CONFIG.scopes,
    }),
  })
  if (!res.ok) throw new Error(`GitHub device code request failed: ${res.status}`)
  return await res.json() as DeviceCodeResponse
}

/** Step 2: Poll GitHub for access token (called from frontend polling) */
export async function pollGitHubToken(deviceCode: string): Promise<{ status: 'pending' | 'success' | 'expired' | 'error'; access_token?: string; error?: string }> {
  const res = await fetch(GITHUB_COPILOT_CONFIG.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': GITHUB_COPILOT_CONFIG.userAgent,
    },
    body: new URLSearchParams({
      client_id: GITHUB_COPILOT_CONFIG.clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  const data = await res.json() as { access_token?: string; error?: string; error_description?: string; interval?: number }
  console.log('[OAuth][poll] HTTP', res.status, 'response:', JSON.stringify(data))

  if (data.access_token) {
    return { status: 'success', access_token: data.access_token }
  }
  if (data.error === 'authorization_pending' || data.error === 'slow_down') {
    return { status: 'pending' }
  }
  if (data.error === 'expired_token') {
    return { status: 'expired' }
  }
  console.warn('[OAuth] GitHub poll returned unexpected error:', data.error, data.error_description)
  return { status: 'error', error: data.error_description || data.error || 'unknown error' }
}

/**
 * Long-poll server-side: faz uma única chamada GitHub respeitando `slow_down`/interval
 * até obter access_token, expirar ou atingir maxWaitMs (timeout do request HTTP do frontend).
 * Igual ao OpenClaw `pollForAccessToken` (login.ts), mas dentro do servidor.
 */
export async function pollGitHubTokenUntilDone(
  deviceCode: string,
  initialIntervalMs: number,
  maxWaitMs: number,
): Promise<{ status: 'pending' | 'success' | 'expired' | 'error'; access_token?: string; error?: string }> {
  let interval = Math.max(1000, initialIntervalMs)
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    const res = await fetch(GITHUB_COPILOT_CONFIG.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': GITHUB_COPILOT_CONFIG.userAgent,
      },
      body: new URLSearchParams({
        client_id: GITHUB_COPILOT_CONFIG.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const data = await res.json() as { access_token?: string; error?: string; error_description?: string; interval?: number }
    if (data.access_token) {
      return { status: 'success', access_token: data.access_token }
    }
    if (data.error === 'authorization_pending') {
      // aguardar e repetir
      await new Promise(r => setTimeout(r, interval))
      continue
    }
    if (data.error === 'slow_down') {
      // GitHub avisa novo intervalo mínimo (em segundos)
      const newInterval = Math.max(interval + 5000, (data.interval || 0) * 1000)
      console.log(`[OAuth][long-poll] slow_down recebido. interval ${interval} -> ${newInterval}ms`)
      interval = newInterval
      await new Promise(r => setTimeout(r, interval))
      continue
    }
    if (data.error === 'expired_token') return { status: 'expired' }
    if (data.error === 'access_denied') return { status: 'error', error: 'access_denied' }
    return { status: 'error', error: data.error_description || data.error || 'unknown error' }
  }
  // Timeout do server: avisa frontend para fazer outra chamada (pendente)
  return { status: 'pending' }
}

export class CopilotSubscriptionError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'CopilotSubscriptionError'
    this.status = status
  }
}

/** Step 3: Exchange GitHub access token for Copilot token */
export async function getCopilotToken(githubAccessToken: string): Promise<CopilotTokenResponse> {
  const res = await fetch(GITHUB_COPILOT_CONFIG.copilotTokenUrl, {
    headers: copilotApiHeaders(githubAccessToken),
  })
  if (!res.ok) {
    const text = await res.text()
    // 401/403/404 normalmente significam: sem assinatura Copilot ativa
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new CopilotSubscriptionError(res.status, `Conta GitHub sem assinatura Copilot ativa (HTTP ${res.status})`)
    }
    throw new Error(`Failed to get Copilot token: ${res.status} ${text}`)
  }
  return await res.json() as CopilotTokenResponse
}

/** Get GitHub user info */
export async function getGitHubUserInfo(accessToken: string): Promise<{ login: string; name: string; email: string; id: number }> {
  const res = await fetch(GITHUB_COPILOT_CONFIG.userInfoUrl, {
    headers: {
      Authorization: `token ${accessToken}`,
      Accept: 'application/json',
      'X-GitHub-Api-Version': GITHUB_COPILOT_CONFIG.apiVersion,
      'User-Agent': GITHUB_COPILOT_CONFIG.userAgent,
    },
  })
  if (!res.ok) throw new Error('Failed to get GitHub user info')
  return await res.json() as { login: string; name: string; email: string; id: number }
}

/** Refresh Copilot token (should be called periodically, tokens last ~30min) */
export async function refreshCopilotToken(githubAccessToken: string): Promise<{ copilotToken: string; copilotEndpoint: string; expiresAt: Date }> {
  const data = await getCopilotToken(githubAccessToken)
  return {
    copilotToken: data.token,
    copilotEndpoint: data.endpoints?.api || 'https://api.githubcopilot.com',
    expiresAt: new Date(data.expires_at * 1000),
  }
}

// ═══ Antigravity — Google OAuth2 Authorization Code + PKCE ═══

const ANTIGRAVITY_CONFIG = {
  clientId: process.env.ANTIGRAVITY_CLIENT_ID || '1071006060591-eih3c3b2bpfr8gc82veq9e03lkqlcp5a.apps.googleusercontent.com',
  clientSecret: process.env.ANTIGRAVITY_CLIENT_SECRET || '',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v1/userinfo',
  apiEndpoint: 'https://cloudcode-pa.googleapis.com',
  loadCodeAssistEndpoint: 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
  onboardUserEndpoint: 'https://cloudcode-pa.googleapis.com/v1internal:onboardUser',
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
  ],
}

/** Build Antigravity OAuth authorize URL */
export function buildAntigravityAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: ANTIGRAVITY_CONFIG.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: ANTIGRAVITY_CONFIG.scopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${ANTIGRAVITY_CONFIG.authorizeUrl}?${params.toString()}`
}

/** Exchange authorization code for tokens */
export async function exchangeAntigravityCode(code: string, redirectUri: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  const res = await fetch(ANTIGRAVITY_CONFIG.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: ANTIGRAVITY_CONFIG.clientId,
      client_secret: ANTIGRAVITY_CONFIG.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Antigravity token exchange failed: ${res.status} ${text}`)
  }
  return await res.json() as { access_token: string; refresh_token: string; expires_in: number }
}

/** Refresh Antigravity Google OAuth token */
export async function refreshAntigravityToken(refreshToken: string): Promise<{
  access_token: string
  expires_in: number
}> {
  const res = await fetch(ANTIGRAVITY_CONFIG.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: ANTIGRAVITY_CONFIG.clientId,
      client_secret: ANTIGRAVITY_CONFIG.clientSecret,
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) throw new Error(`Antigravity token refresh failed: ${res.status}`)
  return await res.json() as { access_token: string; expires_in: number }
}

/** Get Google user info */
export async function getAntigravityUserInfo(accessToken: string): Promise<{ email: string; name: string }> {
  const res = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Failed to get Google user info')
  return await res.json() as { email: string; name: string }
}

/** Post-exchange: Load Code Assist & onboard user */
export async function antigravityPostExchange(accessToken: string): Promise<{ projectId: string }> {
  let projectId = ''
  try {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'cloud-code-for-vscode/2.0.0',
      'X-Goog-Api-Client': 'cloud-code-for-vscode/2.0.0',
    }
    const loadRes = await fetch(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ metadata: { ideVersion: 'vscode/1.96.0', extensionVersion: '2.0.0' } }),
    })
    if (loadRes.ok) {
      const data = await loadRes.json() as { cloudaicompanionProject?: { id?: string } | string }
      projectId = (typeof data.cloudaicompanionProject === 'object' ? data.cloudaicompanionProject?.id : data.cloudaicompanionProject) || ''
    }
  } catch (e) {
    console.log('[Antigravity] Failed to load code assist:', e)
  }
  return { projectId }
}

// ═══ Token Auto-Refresh ═══

export type OAuthProviderType = 'GITHUB_COPILOT' | 'ANTIGRAVITY'

export const OAUTH_PROVIDER_TYPES: OAuthProviderType[] = ['GITHUB_COPILOT', 'ANTIGRAVITY']

export function isOAuthProvider(type: string): type is OAuthProviderType {
  return OAUTH_PROVIDER_TYPES.includes(type as OAuthProviderType)
}
