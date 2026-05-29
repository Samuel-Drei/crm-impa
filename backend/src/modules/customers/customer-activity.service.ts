import { prisma } from '../../config/database.js'

interface LogActivityParams {
  companyId: string
  customerAccountId: string
  contactId?: string
  userId?: string
  action: string
  entity?: string
  entityId?: string
  description: string
  oldValue?: string
  newValue?: string
  metadata?: any
}

export async function logCustomerActivity(params: LogActivityParams) {
  try {
    await prisma.customerActivityLog.create({ data: params })
  } catch (e) {
    console.error('[CustomerActivity] Erro ao registrar atividade:', e)
  }
}

/**
 * Busca o customerAccountId a partir de um contactId.
 * Retorna o primeiro encontrado ou null.
 */
export async function findCustomerAccountByContact(companyId: string, contactId: string): Promise<string | null> {
  const member = await prisma.customerAccountContact.findFirst({
    where: {
      contactId,
      customerAccount: { companyId },
    },
    select: { customerAccountId: true },
  })
  return member?.customerAccountId || null
}

/**
 * Loga atividade automaticamente resolvendo o customerAccountId a partir do contactId.
 * Se não encontrar customer account vinculado, não faz nada.
 */
export async function logActivityByContact(params: Omit<LogActivityParams, 'customerAccountId'> & { contactId: string }) {
  const customerAccountId = await findCustomerAccountByContact(params.companyId, params.contactId)
  if (!customerAccountId) return
  await logCustomerActivity({ ...params, customerAccountId })
}
