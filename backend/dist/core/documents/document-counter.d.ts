/**
 * Obtém o próximo número sequencial para documentos (faturas, propostas, contratos)
 * usando lock atômico com upsert no banco para evitar race conditions.
 */
export declare function getNextNumber(companyId: string, documentType: string, prefix?: string): Promise<number>;
/**
 * Retorna o último número usado (sem incrementar)
 */
export declare function getCurrentNumber(companyId: string, documentType: string, prefix?: string): Promise<number>;
/**
 * Formata número do documento com prefixo
 * Ex: formatDocumentNumber('PROP-', 42) => 'PROP-000042'
 */
export declare function formatDocumentNumber(prefix: string, number: number, pad?: number): string;
//# sourceMappingURL=document-counter.d.ts.map