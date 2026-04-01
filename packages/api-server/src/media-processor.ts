import {
  saveMediaFromBuffer,
  saveMediaFromUrl,
  updateMediaAnalysis,
} from '../../database/src/media-helpers';
import { analyzeImageWithVision } from './vision-ai';
import { getActiveServicesAsChunks } from '../../database/src/service-helpers';

export interface MediaInput {
  tenantId: string;
  channel: 'whatsapp' | 'webchat';
  messageId?: string;
  mediaType: 'image' | 'video' | 'audio' | 'document';
  mimeType: string;
  fileName?: string;
  conversationHistory?: string;
  buffer?: Buffer;
  url?: string;
  authToken?: string;
}

export interface MediaProcessResult {
  mediaId: string;
  aiReply: string | null;
  analysis: {
    description: string;
    skinConcerns: string[];
    suggestedServices: string[];
  } | null;
}

export async function processIncomingMedia(input: MediaInput): Promise<MediaProcessResult> {
  let mediaId: string;
  let imageBuffer: Buffer | null = null;

  if (input.buffer) {
    const saved = await saveMediaFromBuffer(input.buffer, {
      tenantId: input.tenantId,
      channel: input.channel,
      mediaType: input.mediaType,
      mimeType: input.mimeType,
      messageId: input.messageId,
      fileName: input.fileName,
    });
    mediaId = saved.id;
    imageBuffer = input.buffer;
  } else if (input.url) {
    const saved = await saveMediaFromUrl(input.url, {
      tenantId: input.tenantId,
      channel: input.channel,
      mediaType: input.mediaType,
      mimeType: input.mimeType,
      messageId: input.messageId,
      fileName: input.fileName,
      authToken: input.authToken,
    });
    mediaId = saved.id;
    imageBuffer = saved.buffer;
  } else {
    throw new Error('Must provide either buffer or url');
  }

  if (input.mediaType === 'image' && imageBuffer) {
    try {
      const services = await getActiveServicesAsChunks(input.tenantId);
      const servicesText = services
        .filter((s) => s.documentId !== 'no-services')
        .map((s) => `${s.title}${s.price ? `（${s.price}）` : ''}`)
        .join('\n');

      const result = await analyzeImageWithVision(imageBuffer, input.mimeType, {
        conversationHistory: input.conversationHistory,
        availableServices: servicesText || undefined,
      });

      await updateMediaAnalysis(mediaId, JSON.stringify(result));

      return {
        mediaId,
        aiReply: result.rawResponse,
        analysis: {
          description: result.description,
          skinConcerns: result.skinConcerns,
          suggestedServices: result.suggestedServices,
        },
      };
    } catch (err) {
      console.error('[media-processor] Vision AI failed:', err);
      return {
        mediaId,
        aiReply:
          '多謝你傳相片俾我！不過我暫時未能分析呢張圖片，你可以用文字描述你嘅需要，我再幫你推薦適合嘅服務 😊',
        analysis: null,
      };
    }
  }

  const typeReplies: Record<string, string> = {
    video: '多謝你傳片段俾我！你可以用文字描述你想改善嘅問題，我幫你推薦適合嘅服務 😊',
    audio: '收到你嘅語音訊息！不過我暫時只可以處理文字同圖片，你可以打字話我知你嘅需要嗎？😊',
    document: '收到你嘅文件！如果你有任何美容方面嘅問題，歡迎直接問我 😊',
  };

  return {
    mediaId,
    aiReply: typeReplies[input.mediaType] || '收到！有咩可以幫到你？😊',
    analysis: null,
  };
}
