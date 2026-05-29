#!/bin/sh
set -e

echo "🔄 Unblocking any previously failed migrations (mark as rolled-back)..."
# Usa pg via Prisma Client para marcar migrations failed como rolled-back no _prisma_migrations
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    const failed = await p.\$queryRawUnsafe(\`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL\`);
    for (const r of failed) {
      console.log('  → rolling back: ' + r.migration_name);
      await p.\$executeRawUnsafe(\`UPDATE _prisma_migrations SET rolled_back_at = NOW() WHERE migration_name = '\${r.migration_name}'\`);
    }
    if (!failed.length) console.log('  (nenhuma migration failed pendente)');
  } catch (e) { console.log('  (skip: ' + e.message + ')'); }
  finally { await p.\$disconnect(); }
})();
" 2>&1 || echo "⚠️  Unblock step skipped"

echo "🔄 Running pending Prisma migrations..."
npx prisma migrate deploy 2>&1 || echo "⚠️  Migration failed or no pending migrations"

echo "🔄 Regenerating Prisma client..."
npx prisma generate 2>&1

echo "� Running credential encryption migration..."
npx tsx migrate-encrypt-credentials.ts 2>&1 || echo "⚠️  Encryption migration skipped or failed (non-fatal)"

echo "�🚀 Starting backend server (production)..."
exec node --import tsx src/server.ts
