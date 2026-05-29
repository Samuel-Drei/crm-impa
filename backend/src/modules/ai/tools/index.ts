/**
 * AI Tools — Ponto de entrada do sistema de ferramentas
 *
 * Auto-registra os módulos: HTTP Request, CRM, MCP
 */

// Core engine
export { ToolEngine, toolRegistry } from './tool-engine.js'
export type { ToolModule, ToolExecutionContext, ToolExecutionResult } from './tool-engine.js'

// Módulos
export { httpRequestModule, httpFetchModule, mcpModule, crmModule, calendarModule, recallModule, memoryModule, learningModule, artifactModule, fleetAdminModule, universalCrmModule, aiWorkspaceModule, knowledgeModule, FLEET_ADMIN_TOOL_NAMES, AI_WORKSPACE_TOOL_NAMES, UNIVERSAL_CRM_MODELS, WORKSPACE_ROOT, initMCPServers, CRM_TOOLS } from './modules/index.js'
export type { HTTPToolConfig, HTTPToolAuth, HTTPToolParameter, HTTPToolResponseConfig, HTTPFetchConfig, MCPServerConfig, CalendarToolsConfig, RecallToolConfig, MemoryToolConfig, LearningToolConfig, ArtifactToolConfig, UniversalCRMConfig, AIWorkspaceConfig, KnowledgeModuleConfig } from './modules/index.js'

// Compatibilidade com imports antigos
export { executeHttpTool, buildHttpToolDefinitions } from './tool-builder.js'
export type { AgentToolsConfig } from './tool-builder.js'
export { executeCrmTool, getCrmToolDefinitions, CRM_TOOL_DEFINITIONS } from './crm-tools.js'

// ============================================
// AUTO-REGISTER MODULES
// ============================================
import { toolRegistry } from './tool-engine.js'
import { httpRequestModule, httpFetchModule, mcpModule, crmModule, calendarModule, recallModule, memoryModule, learningModule, artifactModule, fleetAdminModule, universalCrmModule, aiWorkspaceModule, knowledgeModule, subagentsModule } from './modules/index.js'

toolRegistry.register(httpRequestModule)
toolRegistry.register(httpFetchModule)
toolRegistry.register(crmModule)
toolRegistry.register(mcpModule)
toolRegistry.register(calendarModule)
toolRegistry.register(recallModule)
toolRegistry.register(memoryModule)
toolRegistry.register(learningModule)
toolRegistry.register(artifactModule)
toolRegistry.register(fleetAdminModule)
toolRegistry.register(universalCrmModule)
toolRegistry.register(aiWorkspaceModule)
toolRegistry.register(knowledgeModule)
toolRegistry.register(subagentsModule)

console.log(`[AI Tools] Registered ${toolRegistry.getModuleTypes().length} modules: ${toolRegistry.getModuleTypes().join(', ')}`)

