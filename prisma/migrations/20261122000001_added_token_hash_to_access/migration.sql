-- AlterTable
ALTER TABLE "Access" ADD COLUMN "tokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Access_tokenHash_key" ON "Access"("tokenHash");
