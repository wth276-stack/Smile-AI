-- AlterTable
ALTER TABLE "knowledge_documents" ADD COLUMN     "steps" TEXT[] DEFAULT ARRAY[]::TEXT[];
