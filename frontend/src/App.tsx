import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { useModuleStore } from '@/stores/module.store'
import { MainLayout } from '@/components/layout/MainLayout'
import { Login } from '@/pages/Login'
import { SuperAdminSetup } from '@/pages/SuperAdminSetup'
import { Dashboard } from '@/pages/Dashboard'
import { Instances } from '@/pages/Instances'
import { Messages } from '@/pages/Messages'
import { Contacts } from '@/pages/Contacts'
import { Campaigns } from '@/pages/Campaigns'
import Schedules from '@/pages/Schedules'
import { Templates } from '@/pages/Templates'
import { Typebot } from '@/pages/Typebot'
import { Webhooks } from '@/pages/Webhooks'
import { Settings } from '@/pages/Settings'
import { ApiDocs } from '@/pages/ApiDocs'
import { Flows } from '@/pages/Flows'
import { FlowEditor } from '@/pages/FlowEditor'
import { AdminLayout } from '@/pages/admin/AdminLayout'
import { AdminDashboard } from '@/pages/admin/AdminDashboard'
import { AdminCompanies } from '@/pages/admin/AdminCompanies'
import { AdminCompanyDetail } from '@/pages/admin/AdminCompanyDetail'
import { AdminUsers as AdminUsersPage } from '@/pages/admin/AdminUsers'
import { AdminUserDetail } from '@/pages/admin/AdminUserDetail'
import { AdminPlans } from '@/pages/admin/AdminPlans'
import { AdminModules } from '@/pages/admin/AdminModules'
import { AdminAIDebug } from '@/pages/admin/AdminAIDebug'
import { Groups } from '@/pages/Groups'
import { WebhookEvents } from '@/pages/WebhookEvents'
import { Automations } from '@/pages/Automations'
import { WindowSubscribers } from '@/pages/WindowSubscribers'
import { Teams } from '@/pages/Teams'
import { Labels } from '@/pages/Labels'
import { CannedResponses } from '@/pages/CannedResponses'
import { CustomAttributes } from '@/pages/CustomAttributes'
import { ConversationAutomations } from '@/pages/ConversationAutomations'
import { Macros } from '@/pages/Macros'
import { AIAgents } from '@/pages/AIAgents'
import { Fleet } from '@/pages/Fleet'
import { AIAgentEdit } from '@/pages/AIAgentEdit'
import { AIPromptWorkspace } from '@/pages/AIPromptWorkspace'
import { AIProviders } from '@/pages/AIProviders'
import { AIKnowledgeBase } from '@/pages/AIKnowledgeBase'
import { AIKnowledgeBaseDetail } from '@/pages/AIKnowledgeBaseDetail'
import { AISessions } from '@/pages/AISessions'
import { AIToolLogs } from '@/pages/AIToolLogs'
import { AIMCPServers } from '@/pages/AIMCPServers'
import { AIDailyBrain } from '@/pages/AIDailyBrain'
import { AISkills } from '@/pages/AISkills'
import { AITokenReports } from '@/pages/AITokenReports'
import { AITemplates } from '@/pages/AITemplates'
import IntegrationsPage from '@/pages/Integrations'
import { AIBrainProfile } from '@/pages/AIBrainProfile'
import { Roles } from '@/pages/Roles'
import { PipelineKanban } from '@/pages/PipelineKanban'
import { PipelineSettings } from '@/pages/PipelineSettings'
import { Catalog } from '@/pages/Catalog'
import { Proposals } from '@/pages/Proposals'
import { AILearnings } from '@/pages/AILearnings'
import { AIArtifacts } from '@/pages/AIArtifacts'
import { FleetCriticReviews } from '@/pages/FleetCriticReviews'
import { FlowAwaitingInput } from '@/pages/FlowAwaitingInput'
import { Invoices } from '@/pages/Invoices'
import { Payments } from '@/pages/Payments'
import { Contracts } from '@/pages/Contracts'
import { Projects } from '@/pages/Projects'
import { Tasks } from '@/pages/Tasks'
import { Expenses } from '@/pages/Expenses'
import { Customers } from '@/pages/Customers'
import { Leads } from '@/pages/Leads'
import { CreditNotes } from '@/pages/CreditNotes'
import { Reports } from '@/pages/Reports'
import { CSATReport } from '@/pages/CSATReport'
import ChannelSettings from '@/pages/ChannelSettings'
import SharedQRCode from '@/pages/SharedQRCode'
import { UsersPage } from '@/pages/Users'
import { ToastProvider } from '@/components/ui/Toast'
import { PermissionRoute } from '@/components/Authorized'
import { PlanGate } from '@/components/PlanGate'
import api from '@/services/api'

function InstallationGuard({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const location = useLocation()

  useEffect(() => {
    api.get('/installation/status')
      .then(res => {
        setSetupRequired(res.data.setupRequired)
      })
      .catch(() => {
        setSetupRequired(false)
      })
      .finally(() => setChecking(false))
  }, [location.pathname])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  if (setupRequired && location.pathname !== '/setup' && !location.pathname.startsWith('/shared/')) {
    return <Navigate to="/setup" replace />
  }

  // Se setup já foi feito e o usuário ainda está em /setup, redirecionar para /login
  if (!setupRequired && location.pathname === '/setup') {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, updateUser, updateCompany } = useAuthStore()
  const { fetchActiveModules, loaded: modulesLoaded } = useModuleStore()
  const [refreshing, setRefreshing] = useState(true)

  // Sincronizar perfil + token do backend ao carregar (atualiza role, permissions, JWT)
  useEffect(() => {
    if (isAuthenticated) {
      api.get('/auth/profile').then(res => {
        const { company, token, ...user } = res.data
        updateUser(user)
        if (company) updateCompany(company)
        // Token is refreshed via httpOnly cookie automatically (Set-Cookie from backend)
      }).catch(() => {}).finally(() => setRefreshing(false))
      // Carregar módulos ativos da empresa
      if (!modulesLoaded) fetchActiveModules()
    } else {
      setRefreshing(false)
    }
  }, [isAuthenticated])

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (refreshing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  return <>{children}</>
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()

  if (!user?.isSuperAdmin) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <ToastProvider>
    <InstallationGuard>
      <Routes>
        <Route path="/setup" element={<SuperAdminSetup />} />
        <Route path="/shared/whatsapp/:token" element={<SharedQRCode />} />

        <Route
          path="/login"
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          }
        />

        <Route
          element={
            <PrivateRoute>
              <MainLayout />
            </PrivateRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/instances" element={<PermissionRoute permission="instances:read"><Instances /></PermissionRoute>} />
          <Route path="/instances/:instanceId/settings" element={<PermissionRoute permission="instances:read"><ChannelSettings /></PermissionRoute>} />
          <Route path="/messages" element={<PermissionRoute permission="conversations:read"><Messages /></PermissionRoute>} />
          <Route path="/contacts" element={<PermissionRoute permission="contacts:read"><Contacts /></PermissionRoute>} />
          <Route path="/campaigns" element={<PermissionRoute permission="campaigns:read"><PlanGate featureKey="maxCampaigns"><Campaigns /></PlanGate></PermissionRoute>} />
          <Route path="/schedules" element={<PermissionRoute permission="schedules:read"><Schedules /></PermissionRoute>} />
          <Route path="/templates" element={<PermissionRoute permission="templates:read"><PlanGate featureKey="maxTemplates"><Templates /></PlanGate></PermissionRoute>} />
          <Route path="/typebot" element={<PermissionRoute permission="flows:read"><Typebot /></PermissionRoute>} />
          <Route path="/webhooks" element={<PermissionRoute permission="automations:read"><Webhooks /></PermissionRoute>} />
          <Route path="/api-docs" element={<PermissionRoute permission="settings:read"><ApiDocs /></PermissionRoute>} />
          <Route path="/settings" element={<PermissionRoute permission="settings:read"><Settings /></PermissionRoute>} />
          <Route path="/flows" element={<PermissionRoute permission="flows:read"><PlanGate featureKey="maxFlows"><Flows /></PlanGate></PermissionRoute>} />
          <Route path="/groups" element={<PermissionRoute permission="groups:read"><Groups /></PermissionRoute>} />
          <Route path="/webhook-events" element={<PermissionRoute permission="automations:read"><WebhookEvents /></PermissionRoute>} />
          <Route path="/automations" element={<PermissionRoute permission="automations:read"><Automations /></PermissionRoute>} />
          <Route path="/window-subscribers" element={<PermissionRoute permission="automations:read"><WindowSubscribers /></PermissionRoute>} />
          <Route path="/teams" element={<PermissionRoute permission="teams:read"><PlanGate featureKey="maxTeams"><Teams /></PlanGate></PermissionRoute>} />
          <Route path="/users" element={<PermissionRoute permission="users:read"><UsersPage /></PermissionRoute>} />
          <Route path="/roles" element={<PermissionRoute permission="roles:manage"><Roles /></PermissionRoute>} />
          <Route path="/pipelines" element={<PermissionRoute permission="pipelines:read"><PipelineKanban /></PermissionRoute>} />
          <Route path="/pipelines/settings" element={<PermissionRoute permission="pipelines:manage"><PipelineSettings /></PermissionRoute>} />
          <Route path="/catalog" element={<PermissionRoute permission="catalog:read"><Catalog /></PermissionRoute>} />
          <Route path="/proposals" element={<PermissionRoute permission="proposals:read"><Proposals /></PermissionRoute>} />
          <Route path="/invoices" element={<PermissionRoute permission="invoices:read"><Invoices /></PermissionRoute>} />
          <Route path="/payments" element={<PermissionRoute permission="payments:read"><Payments /></PermissionRoute>} />
          <Route path="/contracts" element={<PermissionRoute permission="contracts:read"><Contracts /></PermissionRoute>} />
          <Route path="/projects" element={<PermissionRoute permission="projects:read"><Projects /></PermissionRoute>} />
          <Route path="/tasks" element={<PermissionRoute permission="tasks:read"><Tasks /></PermissionRoute>} />
          <Route path="/expenses" element={<PermissionRoute permission="expenses:read"><Expenses /></PermissionRoute>} />
          <Route path="/customers" element={<PermissionRoute permission="customers:read"><Customers /></PermissionRoute>} />
          <Route path="/leads" element={<PermissionRoute permission="contacts:read"><Leads /></PermissionRoute>} />
          <Route path="/credit-notes" element={<PermissionRoute permission="invoices:read"><CreditNotes /></PermissionRoute>} />
          <Route path="/reports" element={<PermissionRoute permission="proposals:read"><Reports /></PermissionRoute>} />
          <Route path="/csat-report" element={<PermissionRoute permission="instances:read"><CSATReport /></PermissionRoute>} />
          <Route path="/labels" element={<PermissionRoute permission="labels:read"><PlanGate featureKey="maxLabels"><Labels /></PlanGate></PermissionRoute>} />
          <Route path="/canned-responses" element={<PermissionRoute permission="canned_responses:read"><CannedResponses /></PermissionRoute>} />
          <Route path="/custom-attributes" element={<PermissionRoute permission="custom_attributes:read"><CustomAttributes /></PermissionRoute>} />
          <Route path="/conversation-automations" element={<PermissionRoute permission="automations:read"><PlanGate featureKey="maxAutomations"><ConversationAutomations /></PlanGate></PermissionRoute>} />
          <Route path="/macros" element={<PermissionRoute permission="macros:read"><PlanGate featureKey="maxAutomations"><Macros /></PlanGate></PermissionRoute>} />
          <Route path="/ai-agents" element={<PermissionRoute permission="ai_agents:read"><PlanGate featureKey="maxAiAgents"><AIAgents /></PlanGate></PermissionRoute>} />
          <Route path="/fleet" element={<PermissionRoute permission="fleet:read"><Fleet /></PermissionRoute>} />
          <Route path="/ai-agents/new" element={<PermissionRoute permission="ai_agents:manage"><PlanGate featureKey="maxAiAgents"><AIAgentEdit /></PlanGate></PermissionRoute>} />
          <Route path="/ai-agents/:id" element={<PermissionRoute permission="ai_agents:manage"><PlanGate featureKey="maxAiAgents"><AIAgentEdit /></PlanGate></PermissionRoute>} />
          <Route path="/ai-templates" element={<PermissionRoute permission="ai_agents:read"><PlanGate featureKey="maxAiAgents"><AITemplates /></PlanGate></PermissionRoute>} />
          <Route path="/ai-providers" element={<PermissionRoute permission="ai_providers:read"><PlanGate featureKey="maxAiProviders"><AIProviders /></PlanGate></PermissionRoute>} />
          <Route path="/ai-knowledge" element={<PermissionRoute permission="ai_knowledge:read"><PlanGate featureKey="maxKnowledgeBases"><AIKnowledgeBase /></PlanGate></PermissionRoute>} />
          <Route path="/ai-knowledge/:id" element={<PermissionRoute permission="ai_knowledge:manage"><PlanGate featureKey="maxKnowledgeBases"><AIKnowledgeBaseDetail /></PlanGate></PermissionRoute>} />
          <Route path="/ai-sessions" element={<PermissionRoute permission="ai_sessions:read"><PlanGate featureKey="maxAiAgents"><AISessions /></PlanGate></PermissionRoute>} />
          <Route path="/ai-tool-logs" element={<PermissionRoute permission="ai_tools:read"><PlanGate featureKey="maxAiAgents"><AIToolLogs /></PlanGate></PermissionRoute>} />
          <Route path="/ai-mcp-servers" element={<PermissionRoute permission="ai_tools:manage"><PlanGate featureKey="maxAiAgents"><AIMCPServers /></PlanGate></PermissionRoute>} />
          <Route path="/ai-skills" element={<PermissionRoute permission="ai_agents:read"><PlanGate featureKey="maxAiAgents"><AISkills /></PlanGate></PermissionRoute>} />
          <Route path="/ai-daily-brain" element={<PermissionRoute permission="ai_brain:read"><AIDailyBrain /></PermissionRoute>} />
          <Route path="/ai-token-reports" element={<PermissionRoute permission="ai_reports:read"><PlanGate featureKey="maxAiAgents"><AITokenReports /></PlanGate></PermissionRoute>} />
          <Route path="/ai-learnings" element={<PermissionRoute permission="ai_agents:read"><AILearnings /></PermissionRoute>} />
          <Route path="/ai-artifacts" element={<PermissionRoute permission="ai_agents:read"><AIArtifacts /></PermissionRoute>} />
          <Route path="/fleet/critic-reviews" element={<PermissionRoute permission="fleet:read"><FleetCriticReviews /></PermissionRoute>} />
          <Route path="/flows/awaiting-input" element={<PermissionRoute permission="flows:read"><FlowAwaitingInput /></PermissionRoute>} />
          <Route path="/integrations" element={<PermissionRoute permission="integrations:read"><IntegrationsPage /></PermissionRoute>} />
          <Route path="/ai-brain/:subjectType/:subjectId" element={<PermissionRoute permission="ai_brain:read"><AIBrainProfile /></PermissionRoute>} />
        </Route>

        {/* FlowEditor has its own layout */}
        <Route
          path="/flows/:id"
          element={
            <PrivateRoute>
              <PermissionRoute permission="flows:manage">
                <PlanGate featureKey="maxFlows">
                  <FlowEditor />
                </PlanGate>
              </PermissionRoute>
            </PrivateRoute>
          }
        />

        {/* Prompt Studio has its own full-screen layout */}
        <Route
          path="/ai-agents/:id/prompt-studio"
          element={
            <PrivateRoute>
              <PermissionRoute permission="ai_agents:manage">
                <PlanGate featureKey="maxAiAgents">
                  <AIPromptWorkspace />
                </PlanGate>
              </PermissionRoute>
            </PrivateRoute>
          }
        />

        {/* Admin panel has its own layout */}
        <Route
          path="/admin"
          element={
            <PrivateRoute>
              <SuperAdminRoute>
                <AdminLayout />
              </SuperAdminRoute>
            </PrivateRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="companies" element={<AdminCompanies />} />
          <Route path="companies/:id" element={<AdminCompanyDetail />} />
          <Route path="plans" element={<AdminPlans />} />
          <Route path="modules" element={<AdminModules />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="users/:id" element={<AdminUserDetail />} />
          <Route path="ai-debug" element={<AdminAIDebug />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </InstallationGuard>
    </ToastProvider>
  )
}
