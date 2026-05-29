-- CreateTable
CREATE TABLE "crm_modules" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_modules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedBy" TEXT,

    CONSTRAINT "company_modules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_modules_slug_key" ON "crm_modules"("slug");

-- CreateIndex
CREATE INDEX "company_modules_companyId_isActive_idx" ON "company_modules"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "company_modules_companyId_moduleId_key" ON "company_modules"("companyId", "moduleId");

-- AddForeignKey
ALTER TABLE "company_modules" ADD CONSTRAINT "company_modules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_modules" ADD CONSTRAINT "company_modules_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "crm_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: Insert all module definitions into crm_modules
INSERT INTO "crm_modules" ("id", "slug", "name", "description", "icon", "category", "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'comercial', 'Comercial / Vendas', 'Pipeline de vendas com funil comercial completo', '💼', 'crm', NOW(), NOW()),
  (gen_random_uuid(), 'advocacia', 'Advocacia', 'Gestão de processos jurídicos, audiências e prazos', '⚖️', 'legal', NOW(), NOW()),
  (gen_random_uuid(), 'clinica-estetica', 'Clínica de Estética', 'Gestão de pacientes, procedimentos e sessões', '💆', 'health', NOW(), NOW()),
  (gen_random_uuid(), 'imobiliario', 'Imobiliário', 'Gestão de imóveis, visitas e contratos', '🏠', 'realestate', NOW(), NOW()),
  (gen_random_uuid(), 'educacao', 'Educação', 'Captação de alunos, matrículas e acompanhamento', '🎓', 'education', NOW(), NOW()),
  (gen_random_uuid(), 'financeiro', 'Financeiro / Cobrança', 'Gestão de cobranças, acordos e recuperação de crédito', '💰', 'finance', NOW(), NOW()),
  (gen_random_uuid(), 'ecommerce', 'E-commerce', 'Gestão de pedidos, rastreamento e pós-venda', '🛒', 'ecommerce', NOW(), NOW());
