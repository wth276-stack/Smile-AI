import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface VisionAnalysisResult {
  description: string;
  skinConcerns: string[];
  suggestedServices: string[];
  rawResponse: string;
}

export async function analyzeImageWithVision(
  imageBuffer: Buffer,
  mimeType: string,
  context?: {
    conversationHistory?: string;
    availableServices?: string;
  },
): Promise<VisionAnalysisResult> {
  const base64Image = imageBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  const systemPrompt = buildVisionSystemPrompt(context?.availableServices);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1000,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: context?.conversationHistory
              ? `客人之前嘅對話：\n${context.conversationHistory}\n\n請分析呢張圖片。`
              : '請分析呢張圖片。',
          },
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'high' },
          },
        ],
      },
    ],
  });

  const rawContent = response.choices[0]?.message?.content || '';
  return parseVisionResponse(rawContent);
}

export async function analyzeImageFromUrl(
  imageUrl: string,
  context?: {
    conversationHistory?: string;
    availableServices?: string;
  },
): Promise<VisionAnalysisResult> {
  const systemPrompt = buildVisionSystemPrompt(context?.availableServices);

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1000,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: context?.conversationHistory
              ? `客人之前嘅對話：\n${context.conversationHistory}\n\n請分析呢張圖片。`
              : '請分析呢張圖片。',
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl, detail: 'high' },
          },
        ],
      },
    ],
  });

  const rawContent = response.choices[0]?.message?.content || '';
  return parseVisionResponse(rawContent);
}

function buildVisionSystemPrompt(availableServices?: string): string {
  return `你係一間美容院嘅 AI 助手。客人傳咗一張圖片俾你。

你嘅任務：
1. 描述你睇到嘅嘢（用廣東話）
2. 如果係皮膚/面部相片，分析可能嘅皮膚問題（例如：暗瘡、色斑、毛孔粗大、皺紋、鬆弛等）
3. 根據分析，建議適合嘅服務

${availableServices ? `我哋提供嘅服務：\n${availableServices}` : ''}

請用以下 JSON 格式回答（唔好加其他文字）：
{
  "description": "圖片描述",
  "skinConcerns": ["問題1", "問題2"],
  "suggestedServices": ["服務1", "服務2"],
  "replyToCustomer": "用廣東話回覆客人嘅友善訊息"
}

如果圖片唔係皮膚/美容相關，skinConcerns 同 suggestedServices 留空 array，正常描述圖片並友善回應。
絕對唔好提供醫療診斷。用「可能」、「建議」等字眼。`;
}

function parseVisionResponse(rawResponse: string): VisionAnalysisResult {
  try {
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        description?: string;
        skinConcerns?: string[];
        suggestedServices?: string[];
        replyToCustomer?: string;
      };
      return {
        description: parsed.description || '',
        skinConcerns: parsed.skinConcerns || [],
        suggestedServices: parsed.suggestedServices || [],
        rawResponse: parsed.replyToCustomer || rawResponse,
      };
    }
  } catch {
    // fall through
  }

  return {
    description: rawResponse,
    skinConcerns: [],
    suggestedServices: [],
    rawResponse: rawResponse,
  };
}
