import type { BookingDraft } from './types';
import type { SlotExtraction } from './booking-state';
import type { ConversationMode } from './conversation-mode';

interface ServiceCandidate {
  serviceName: string;
  serviceDisplayName: string;
}

export interface DraftPatchOptions {
  message: string;
  priorMode?: ConversationMode;
  slots: SlotExtraction;
  nextService?: ServiceCandidate | null;
}

export interface DraftPatchResult {
  draft: BookingDraft;
  appliedFields: (keyof BookingDraft)[];
}

const EXPLICIT_CORRECTION_PATTERN =
  /改(做|為|去|返)?|更正|唔係|不是|not\s+this|wrong|改期|改時間|改電話|改名|轉做|轉返|想改/i;

function emptyDraft(): BookingDraft {
  return {
    serviceName: null,
    serviceDisplayName: null,
    date: null,
    time: null,
    customerName: null,
    phone: null,
  };
}

function canOverwriteField(
  field: keyof BookingDraft,
  prior: BookingDraft,
  nextValue: string | null,
  options: DraftPatchOptions,
): boolean {
  if (!nextValue) return false;
  const currentValue = prior[field];
  if (!currentValue || currentValue === nextValue) return true;
  if (options.priorMode !== 'CONFIRMATION_PENDING') return true;
  return EXPLICIT_CORRECTION_PATTERN.test(options.message);
}

export function applyDraftPatch(
  priorDraft: BookingDraft | undefined,
  options: DraftPatchOptions,
): DraftPatchResult {
  const prior: BookingDraft = priorDraft ? { ...priorDraft } : emptyDraft();
  const draft = { ...prior };
  const appliedFields: (keyof BookingDraft)[] = [];

  const applyField = (field: keyof BookingDraft, value: string | null) => {
    if (!value) return;
    if (!canOverwriteField(field, prior, value, options)) return;
    if (draft[field] === value) return;
    draft[field] = value;
    appliedFields.push(field);
  };

  applyField('date', options.slots.date);
  applyField('time', options.slots.time);
  applyField('customerName', options.slots.customerName);
  applyField('phone', options.slots.phone);

  if (options.nextService) {
    const serviceChanged =
      prior.serviceName &&
      prior.serviceName !== options.nextService.serviceName;
    const canChangeService =
      !serviceChanged ||
      options.priorMode !== 'CONFIRMATION_PENDING' ||
      EXPLICIT_CORRECTION_PATTERN.test(options.message);

    if (canChangeService) {
      if (draft.serviceName !== options.nextService.serviceName) {
        draft.serviceName = options.nextService.serviceName;
        appliedFields.push('serviceName');
      }
      if (draft.serviceDisplayName !== options.nextService.serviceDisplayName) {
        draft.serviceDisplayName = options.nextService.serviceDisplayName;
        appliedFields.push('serviceDisplayName');
      }
    }
  }

  return { draft, appliedFields };
}
