export { prisma } from './client';
export { withTenantScope } from './tenant-scope';
export { PrismaClient, Prisma } from '@prisma/client';
export type * from '@prisma/client';
export {
  submitV2Booking,
  getV2ConversationState,
  saveV2ConversationState,
  getBookingsForPhone,
  modifyBooking,
  cancelBooking,
  getActiveServices,
  type ActiveServiceKnowledgeChunk,
} from './v2-helpers';
export {
  findOrCreateWebchatConversation,
  loadConversationHistory,
  saveMessages,
  getBookingDraft,
  getConversationBookingState,
  updateBookingDraft,
  mergeConversationMetadata,
  resetConversation,
  closeConversation,
} from './conversation-helpers';
export { getActiveServicesAsChunks, getKnowledgeChunksFromDB } from './service-helpers';
export {
  getBusinessHours,
  updateBusinessHours,
  generateTimeSlots,
  getAvailableSlots,
  getBusinessHoursForPrompt,
} from './business-hours-helpers';
export {
  saveMediaFromBuffer,
  saveMediaFromUrl,
  updateMediaAnalysis,
  getMediaById,
  getMediaByMessageId,
  readMediaFile,
} from './media-helpers';
export {
  DEMO_TENANT_ID,
  DEMO_TENANT_CANONICAL_SLOT_SETTINGS,
  tenantJsonMissingStructuredBusinessHours,
  mergeDemoTenantSettingsPreservingKeys,
  ensureDemoTenantStructuredSlotSettings,
  type EnsureDemoTenantSlotSettingsResult,
} from './demo-tenant-slot-settings';
export {
  INDUSTRY_ID_TO_DEMO_TENANT_ID,
  ALL_DEMO_INDUSTRY_TENANT_IDS,
  getDemoTenantIdForIndustryId,
  getIndustryIdForDemoTenantId,
  isDemoIndustryTenantId,
  mapIndustryIdToBusinessType,
} from './demo-industry-tenants';
export { applyIndustrySeedToTenant } from './apply-industry-seed';
export { ensureDemoIndustryTenantsStructuredSlotSettings } from './demo-industry-tenants-bootstrap';
export {
  getIndustrySeed,
  getAllIndustryIds,
  industrySeedData,
  type IndustryService,
  type IndustryKB,
  type IndustrySeed,
  type StructuredBusinessHours,
} from './industry-seeds';
