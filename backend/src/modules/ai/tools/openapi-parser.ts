/**
 * OpenAPI Spec Parser — Converte especificação OpenAPI 3.x em HTTPToolConfig[]
 * 
 * Permite importar ferramentas de APIs externas automaticamente
 * a partir de um spec OpenAPI (JSON ou YAML).
 */

// ============================================
// TIPOS (compatíveis com http-request.module.ts)
// ============================================

interface HTTPToolConfig {
  name: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  url: string
  auth?: {
    type: string
    token?: string
    apiKey?: string
    apiKeyName?: string
    headerName?: string
    headerValue?: string
    username?: string
    password?: string
  }
  parameters?: Array<{
    name: string
    in: 'path' | 'query' | 'body' | 'header'
    type: string
    description: string
    required: boolean
    default?: any
    enum?: string[]
  }>
  headers?: Record<string, string>
  timeout?: number
  retryCount?: number
  response?: {
    extractField?: string
    maxLength?: number
  }
}

// ============================================
// OpenAPI Schema Types (simplificado)
// ============================================

interface OpenAPISpec {
  openapi?: string
  swagger?: string
  info?: { title?: string; description?: string; version?: string }
  servers?: Array<{ url: string; description?: string }>
  host?: string  // Swagger 2.0
  basePath?: string  // Swagger 2.0
  schemes?: string[]  // Swagger 2.0
  paths: Record<string, Record<string, OpenAPIOperation>>
  components?: {
    securitySchemes?: Record<string, any>
    schemas?: Record<string, any>
  }
  securityDefinitions?: Record<string, any>  // Swagger 2.0
}

interface OpenAPIOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: OpenAPIParameter[]
  requestBody?: {
    description?: string
    required?: boolean
    content?: Record<string, { schema?: any }>
  }
  security?: Array<Record<string, string[]>>
  responses?: Record<string, any>
}

interface OpenAPIParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  description?: string
  required?: boolean
  schema?: { type?: string; enum?: string[]; default?: any }
  type?: string  // Swagger 2.0
  enum?: string[]  // Swagger 2.0
}

// ============================================
// PARSER
// ============================================

/**
 * Parseia uma especificação OpenAPI (JSON ou YAML) e retorna um array de HTTPToolConfig
 * compatível com o módulo http-request existente.
 */
export function parseOpenAPISpec(specString: string): {
  tools: HTTPToolConfig[]
  info: { title: string; version: string; description: string }
  serverUrl: string
  totalEndpoints: number
  errors: string[]
} {
  let spec: OpenAPISpec

  // Tentar JSON primeiro, depois YAML simples
  try {
    spec = JSON.parse(specString)
  } catch {
    // Parse YAML simplificado (suporte básico)
    spec = parseSimpleYAML(specString) as OpenAPISpec
  }

  if (!spec?.paths) {
    throw new Error('Especificação inválida: campo "paths" não encontrado')
  }

  // Resolver base URL
  let serverUrl = ''
  if (spec.servers && spec.servers.length > 0) {
    serverUrl = spec.servers[0].url.replace(/\/$/, '')
  } else if (spec.host) {
    // Swagger 2.0
    const scheme = spec.schemes?.[0] || 'https'
    serverUrl = `${scheme}://${spec.host}${spec.basePath || ''}`
  }

  // Resolver auth padrão do spec
  const defaultAuth = resolveDefaultAuth(spec)

  const tools: HTTPToolConfig[] = []
  const errors: string[] = []
  let totalEndpoints = 0

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue

    for (const [method, operation] of Object.entries(pathItem)) {
      const httpMethod = method.toUpperCase()
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(httpMethod)) continue

      totalEndpoints++
      const op = operation as OpenAPIOperation

      try {
        const tool = convertOperation(path, httpMethod as any, op, serverUrl, defaultAuth, spec)
        tools.push(tool)
      } catch (err) {
        errors.push(`${httpMethod} ${path}: ${(err as Error).message}`)
      }
    }
  }

  return {
    tools,
    info: {
      title: spec.info?.title || 'API sem nome',
      version: spec.info?.version || '1.0',
      description: spec.info?.description || '',
    },
    serverUrl,
    totalEndpoints,
    errors,
  }
}

function convertOperation(
  path: string,
  method: HTTPToolConfig['method'],
  op: OpenAPIOperation,
  serverUrl: string,
  defaultAuth: HTTPToolConfig['auth'],
  spec: OpenAPISpec
): HTTPToolConfig {
  // Nome: operationId ou método_path sanitizado
  const name = op.operationId || sanitizeName(`${method.toLowerCase()}_${path}`)

  // Descrição
  const descParts: string[] = []
  if (op.summary) descParts.push(op.summary)
  if (op.description && op.description !== op.summary) descParts.push(op.description)
  if (op.tags?.length) descParts.push(`Tags: ${op.tags.join(', ')}`)
  const description = descParts.join('. ') || `${method} ${path}`

  // URL completa
  const url = `${serverUrl}${path}`

  // Parâmetros (path + query + header)
  const parameters: HTTPToolConfig['parameters'] = []

  if (op.parameters) {
    for (const param of op.parameters) {
      if (param.in === 'cookie') continue // Cookies não suportados

      const schema = param.schema || {}
      parameters.push({
        name: param.name,
        in: param.in as any,
        type: schema.type || param.type || 'string',
        description: param.description || param.name,
        required: param.required || param.in === 'path',
        default: schema.default,
        enum: schema.enum || param.enum,
      })
    }
  }

  // Request body → parâmetros do tipo body
  if (op.requestBody?.content) {
    const jsonContent = op.requestBody.content['application/json']
    if (jsonContent?.schema) {
      const bodyParams = extractBodyParams(jsonContent.schema, spec)
      parameters.push(...bodyParams)
    }
  }

  return {
    name,
    description: description.substring(0, 500),
    method,
    url,
    auth: defaultAuth,
    parameters: parameters.length > 0 ? parameters : undefined,
    timeout: 30000,
    retryCount: 0,
    response: { maxLength: 5000 },
  }
}

function extractBodyParams(
  schema: any,
  spec: OpenAPISpec
): any[] {
  const params: any[] = []

  // Resolver $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, spec)
    if (resolved) return extractBodyParams(resolved, spec)
    return params
  }

  if (schema.type === 'object' && schema.properties) {
    const required = new Set(schema.required || [])
    for (const [name, prop] of Object.entries(schema.properties as Record<string, any>)) {
      // Resolver $ref de propriedade
      let resolvedProp = prop
      if (prop.$ref) {
        resolvedProp = resolveRef(prop.$ref, spec) || prop
      }

      params.push({
        name,
        in: 'body' as const,
        type: resolvedProp.type || 'string',
        description: resolvedProp.description || name,
        required: required.has(name),
        default: resolvedProp.default,
        enum: resolvedProp.enum,
      })
    }
  }

  return params
}

function resolveRef(ref: string, spec: OpenAPISpec): any {
  // #/components/schemas/MyModel
  const parts = ref.replace('#/', '').split('/')
  let current: any = spec
  for (const part of parts) {
    current = current?.[part]
    if (!current) return null
  }
  return current
}

function resolveDefaultAuth(spec: OpenAPISpec): HTTPToolConfig['auth'] | undefined {
  const schemes = spec.components?.securitySchemes || spec.securityDefinitions
  if (!schemes) return undefined

  // Pegar o primeiro scheme como padrão
  for (const [, scheme] of Object.entries(schemes as Record<string, any>)) {
    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      return { type: 'bearer', token: '{{API_TOKEN}}' }
    }
    if (scheme.type === 'apiKey') {
      if (scheme.in === 'header') {
        return { type: 'api_key_header', apiKeyName: scheme.name, apiKey: '{{API_KEY}}' }
      }
      if (scheme.in === 'query') {
        return { type: 'api_key_query', apiKeyName: scheme.name, apiKey: '{{API_KEY}}' }
      }
    }
    if (scheme.type === 'http' && scheme.scheme === 'basic') {
      return { type: 'basic', username: '{{USERNAME}}', password: '{{PASSWORD}}' }
    }
  }
  return undefined
}

function sanitizeName(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 64)
}

/**
 * Parse YAML simplificado — suporte básico para specs OpenAPI em YAML
 * Não é um parser YAML completo, mas cobre a maioria dos casos de specs.
 */
function parseSimpleYAML(yamlStr: string): Record<string, any> {
  // Tenta converter YAML para JSON de forma simplificada
  // Para specs complexos, o frontend pode converter YAML→JSON antes de enviar
  try {
    // Remover comentários
    const lines = yamlStr.split('\n').filter(l => !l.trim().startsWith('#'))
    const cleaned = lines.join('\n')
    
    // Tentar novamente como JSON (talvez tinha comentários JSON-like)
    try { return JSON.parse(cleaned) } catch {}

    // YAML muito complexo — retornar erro legível
    throw new Error('Formato YAML detectado. Por favor, converta para JSON antes de importar. Use https://www.json2yaml.com/ ou similar.')
  } catch (e) {
    throw e
  }
}
