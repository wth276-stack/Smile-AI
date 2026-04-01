// ── Auth & Users ──

export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  STAFF = 'STAFF',
}

// ── Channels ──

export enum ChannelType {
  WHATSAPP = 'WHATSAPP',
  INSTAGRAM = 'INSTAGRAM',
  FACEBOOK = 'FACEBOOK',
  WEBCHAT = 'WEBCHAT',
  EMAIL = 'EMAIL', // P2
}

// ── Conversations & Messages ──

export enum ConversationStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  ARCHIVED = 'ARCHIVED',
  HANDED_OFF = 'HANDED_OFF', // P2
}

export enum MessageSender {
  CUSTOMER = 'CUSTOMER',
  AI = 'AI',
  HUMAN = 'HUMAN',
}

export enum MessageContentType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  FILE = 'FILE',
  LOCATION = 'LOCATION',
  TEMPLATE = 'TEMPLATE',
}

// ── Orders & Bookings ──

export enum OrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  PAID = 'PAID',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW',
  CANCELLED = 'CANCELLED',
}

// ── Follow-ups & Reminders ──

export enum FollowUpStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  SKIPPED = 'SKIPPED',
  OVERDUE = 'OVERDUE',
}

export enum FollowUpType {
  DELIVERY_REMINDER = 'DELIVERY_REMINDER',
  APPOINTMENT_REMINDER = 'APPOINTMENT_REMINDER',
  PAYMENT_FOLLOW_UP = 'PAYMENT_FOLLOW_UP',
  GENERAL_FOLLOW_UP = 'GENERAL_FOLLOW_UP',
  RE_ENGAGEMENT = 'RE_ENGAGEMENT', // P2
}

export enum ReminderTarget {
  OWNER = 'OWNER',
  CUSTOMER = 'CUSTOMER',
}

export enum ReminderStatus {
  SCHEDULED = 'SCHEDULED',
  SENT = 'SENT',
  CANCELLED = 'CANCELLED',
}

// ── AI Engine ──

export enum AiRunStatus {
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
  TIMEOUT = 'TIMEOUT',
  FILTERED = 'FILTERED',
}

// ── P2: Lead & Sales ──

export enum LeadStage {
  NEW = 'NEW',
  ENGAGING = 'ENGAGING',
  QUALIFYING = 'QUALIFYING',
  QUOTING = 'QUOTING',
  NEGOTIATING = 'NEGOTIATING',
  CLOSING = 'CLOSING',
  WON = 'WON',
  LOST = 'LOST',
  DORMANT = 'DORMANT',
}

export enum HandoffReason {
  CUSTOMER_REQUEST = 'CUSTOMER_REQUEST',
  COMPLEX_QUERY = 'COMPLEX_QUERY',
  HIGH_VALUE_DEAL = 'HIGH_VALUE_DEAL',
  COMPLAINT = 'COMPLAINT',
  AI_UNSURE = 'AI_UNSURE',
  REPEATED_OBJECTION = 'REPEATED_OBJECTION',
}

export enum ObjectionType {
  PRICE = 'PRICE',
  TIMING = 'TIMING',
  NEED = 'NEED',
  TRUST = 'TRUST',
  COMPETITOR = 'COMPETITOR',
  AUTHORITY = 'AUTHORITY',
}

// ── P3: Decision Identity ──

export enum DecisionStyle {
  ANALYTICAL = 'ANALYTICAL',
  DRIVER = 'DRIVER',
  EXPRESSIVE = 'EXPRESSIVE',
  AMIABLE = 'AMIABLE',
}

// ── Notification ──

export enum NotificationType {
  REMINDER = 'REMINDER',
  NEW_INQUIRY = 'NEW_INQUIRY',
  HANDOFF = 'HANDOFF',
  ORDER_UPDATE = 'ORDER_UPDATE',
  SYSTEM = 'SYSTEM',
}
