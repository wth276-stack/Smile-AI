-- AlterTable
ALTER TABLE "knowledge_documents" ADD COLUMN     "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];
