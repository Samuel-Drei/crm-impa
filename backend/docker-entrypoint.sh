#!/bin/sh
set -e

echo "🔄 Running pending Prisma migrations..."
npx prisma migrate deploy 2>&1 || echo "⚠️  Migration failed or no pending migrations"

echo "🔄 Regenerating Prisma client..."
npx prisma generate 2>&1

echo "� Running credential encryption migration..."
npx tsx migrate-encrypt-credentials.ts 2>&1 || echo "⚠️  Encryption migration skipped or failed (non-fatal)"

echo "�🚀 Starting backend server..."
exec npx tsx watch src/server.ts
