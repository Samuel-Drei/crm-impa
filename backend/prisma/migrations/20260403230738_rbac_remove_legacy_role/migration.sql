/*
  Warnings:

  - You are about to drop the column `role` on the `users` table. All the data in the column will be lost.
  - Made the column `roleId` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- Preencher roleId nos users que ainda não têm
DO $$ 
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN 
    SELECT u.id as user_id, 
           COALESCE(
             (SELECT r.id FROM roles r WHERE r."companyId" = u."companyId" AND r."isDefault" = true LIMIT 1),
             (SELECT r.id FROM roles r WHERE r."companyId" = u."companyId" LIMIT 1)
           ) as role_id
    FROM users u
    WHERE u."roleId" IS NULL
  LOOP
    IF rec.role_id IS NOT NULL THEN
      UPDATE users SET "roleId" = rec.role_id WHERE id = rec.user_id;
    END IF;
  END LOOP;
END $$;

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_roleId_fkey";

-- AlterTable
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role') THEN
    ALTER TABLE "users" DROP COLUMN "role";
  END IF;
END $$;
ALTER TABLE "users" ALTER COLUMN "roleId" SET NOT NULL;

-- DropEnum
DROP TYPE IF EXISTS "UserRole";

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
