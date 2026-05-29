import { prisma } from '../../config/database.js'

/**
 * Obtém o próximo número sequencial para documentos (faturas, propostas, contratos)
 * usando lock atômico com upsert no banco para evitar race conditions.
 */
export async function getNextNumber(
  companyId: string,
  documentType: string,
  prefix: string = ''
): Promise<number> {
  // Upsert atômico: cria se não existe, incrementa se existe
  const counter = await prisma.documentCounter.upsert({
    where: {
      companyId_documentType_prefix: {
        companyId,
        documentType,
        prefix,
      },
    },
    update: {
      lastNumber: { increment: 1 },
    },
    create: {
      companyId,
      documentType,
      prefix,
      lastNumber: 1,
    },
  })

  return counter.lastNumber
}

/**
 * Retorna o último número usado (sem incrementar)
 */
export async function getCurrentNumber(
  companyId: string,
  documentType: string,
  prefix: string = ''
): Promise<number> {
  const counter = await prisma.documentCounter.findUnique({
    where: {
      companyId_documentType_prefix: {
        companyId,
        documentType,
        prefix,
      },
    },
  })

  return counter?.lastNumber ?? 0
}

/**
 * Formata número do documento com prefixo
 * Ex: formatDocumentNumber('PROP-', 42) => 'PROP-000042'
 */
export function formatDocumentNumber(prefix: string, number: number, pad: number = 6): string {
  return `${prefix}${String(number).padStart(pad, '0')}`
}
