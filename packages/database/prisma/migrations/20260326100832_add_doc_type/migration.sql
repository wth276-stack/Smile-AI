-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('SERVICE', 'FAQ', 'GENERAL');

-- AlterTable
ALTER TABLE "knowledge_documents" ADD COLUMN     "docType" "DocType" NOT NULL DEFAULT 'GENERAL';
