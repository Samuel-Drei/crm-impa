-- CreateTable
CREATE TABLE "shared_instance_links" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "passwordHash" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "currentUses" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastAccessedAt" TIMESTAMP(3),
    "lastAccessedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_instance_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_instance_links_token_key" ON "shared_instance_links"("token");

-- AddForeignKey
ALTER TABLE "shared_instance_links" ADD CONSTRAINT "shared_instance_links_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_instance_links" ADD CONSTRAINT "shared_instance_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_instance_links" ADD CONSTRAINT "shared_instance_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
