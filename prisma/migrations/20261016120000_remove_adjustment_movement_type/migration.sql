-- AlterEnum
BEGIN;
CREATE TYPE "MovementType_new" AS ENUM ('ENTRY', 'EXIT');
ALTER TABLE "stock_movements" ALTER COLUMN "type" TYPE "MovementType_new" USING ("type"::text::"MovementType_new");
ALTER TYPE "MovementType" RENAME TO "MovementType_old";
ALTER TYPE "MovementType_new" RENAME TO "MovementType";
DROP TYPE "MovementType_old";
COMMIT;
