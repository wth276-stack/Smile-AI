-- CreateTable
CREATE TABLE IF NOT EXISTS "media_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT,
    "channel" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "mimeType" TEXT,
    "originalUrl" TEXT,
    "localPath" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "aiAnalysis" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "media_messages_tenantId_idx" ON "media_messages"("tenantId");
CREATE INDEX IF NOT EXISTS "media_messages_messageId_idx" ON "media_messages"("messageId");
