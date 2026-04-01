CREATE UNIQUE INDEX "contacts_tenantId_phone_key"
ON "contacts" ("tenantId", "phone")
WHERE "phone" IS NOT NULL;
