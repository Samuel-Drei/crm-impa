/**
 * Registry de providers de integração.
 * Para adicionar uma nova integração: implemente BaseIntegrationProvider e registre aqui.
 */

import type { CompanyIntegrationType } from '@prisma/client'
import { BaseIntegrationProvider } from './types.js'
import { FishAudioProvider } from './providers/fishaudio.provider.js'
import { CalComProvider } from './providers/calcom.provider.js'
import { OpenAIProvider } from './providers/openai.provider.js'

const providers = new Map<CompanyIntegrationType, BaseIntegrationProvider>()

function register(p: BaseIntegrationProvider) {
  providers.set(p.type, p)
}

register(new FishAudioProvider())
register(new CalComProvider())
register(new OpenAIProvider())

export function getProvider(type: CompanyIntegrationType): BaseIntegrationProvider {
  const p = providers.get(type)
  if (!p) throw new Error(`Integration provider não encontrado para tipo: ${type}`)
  return p
}

export function tryGetProvider(type: CompanyIntegrationType): BaseIntegrationProvider | null {
  return providers.get(type) || null
}

export function listCatalog() {
  return Array.from(providers.values()).map((p) => p.catalog)
}
