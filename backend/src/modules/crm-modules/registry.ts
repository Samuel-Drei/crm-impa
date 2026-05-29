import { comercialModule } from './comercial/definition.js'
import { advocaciaModule } from './advocacia/definition.js'
import { clinicaEsteticaModule } from './clinica-estetica/definition.js'
import { imobiliarioModule } from './imobiliario/definition.js'
import { educacaoModule } from './educacao/definition.js'
import { financeiroModule } from './financeiro/definition.js'
import { ecommerceModule } from './ecommerce/definition.js'
import type { ModuleDefinition } from './types.js'

// ══════════════════════════════════════════
// MODULE_REGISTRY — Fonte de verdade dos módulos nativos
// Para adicionar um módulo: criar definition.ts e registrar aqui
// ══════════════════════════════════════════
export const MODULE_REGISTRY: Record<string, ModuleDefinition> = {
  'comercial': comercialModule,
  'advocacia': advocaciaModule,
  'clinica-estetica': clinicaEsteticaModule,
  'imobiliario': imobiliarioModule,
  'educacao': educacaoModule,
  'financeiro': financeiroModule,
  'ecommerce': ecommerceModule,
}

export function getModuleDefinition(slug: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY[slug]
}

export function getAllModuleDefinitions(): ModuleDefinition[] {
  return Object.values(MODULE_REGISTRY)
}

export function getModuleSlugs(): string[] {
  return Object.keys(MODULE_REGISTRY)
}
