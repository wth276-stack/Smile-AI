-- AlterTable
ALTER TABLE "knowledge_documents" ADD COLUMN     "discountPrice" TEXT,
ADD COLUMN     "faq_items" JSONB,
ADD COLUMN     "price" TEXT;
