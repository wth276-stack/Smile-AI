export interface IndustryService {
  name: string;
  displayName: string;
  price: string;
  duration: string;
  description: string;
  suitable: string;
  caution: string;
  faq: { q: string; a: string }[];
}

export interface IndustryKB {
  title: string;
  content: string;
}

export interface IndustrySeed {
  id: string;
  displayName: string;
  businessHoursText: string;
  contactPhone: string;
  contactWhatsApp: string;
  persona: string;
  services: IndustryService[];
  knowledgeBase: IndustryKB[];
}

export const industrySeedData: Record<string, IndustrySeed> = {
  beauty: {
    id: 'beauty',
    displayName: '星悅美容中心',
    businessHoursText: '星期一至五：10:00 - 21:00\n星期六：10:00 - 19:00\n星期日及公眾假期：休息',
    contactPhone: '+852 2345 6789',
    contactWhatsApp: '+852 2345 6789',
    persona:
      '你係星悅美容中心嘅 WhatsApp 銷售助手。語氣親切專業、適當用 1-2 個 emoji、簡潔 WhatsApp 風格。價錢依從系統「Price answers」硬性規則（KB 嘅 price/discount 欄位），唔好自由發揮。',
    services: [
      {
        name: 'hifu',
        displayName: 'HIFU 緊緻療程',
        price: '$6,980 → $4,980',
        duration: '60-90 分鐘',
        description: '緊緻肌膚、提升輪廓、減淡皺紋、改善雙下巴',
        suitable: '面部鬆弛者、想要V臉效果的人士、想改善法令紋的人',
        caution: '術後一週內避免做臉、避免日曬、保濕要做好',
        faq: [
          { q: 'HIFU 會痛嗎', a: '過程可能有輕微痠痛感，可承受範圍內' },
          { q: '幾耐見效', a: '一般 2-3 個月後效果最明顯' },
        ],
      },
      {
        name: 'botox',
        displayName: 'Botox 瘦面療程',
        price: '$2,500 → $1,800',
        duration: '15-30 分鐘',
        description: '放鬆咀嚼肌、達到瘦面效果、改善國字臉',
        suitable: '咀嚼肌發達、國字臉型人士',
        caution: '注射後 4 小時內避免平躺、一週內避免按摩注射部位',
        faq: [
          { q: 'Botox 瘦面幾耐見效', a: '一般 1-2 週開始見效' },
          { q: '會唔會有副作用', a: '正常情況下副作用輕微，可能有輕微瘀青' },
        ],
      },
      {
        name: 'ipl',
        displayName: 'IPL 彩光嫩膚',
        price: '$800 → $498',
        duration: '30-45 分鐘',
        description: '改善色斑、均勻膚色、收細毛孔、減淡細紋',
        suitable: '有曬斑、雀斑、膚色不均者',
        caution: '療程後需加強防曬',
        faq: [
          { q: 'IPL 會痛嗎', a: '過程會有輕微溫熱感' },
          { q: '做完會唔會紅', a: '可能有輕微泛紅，通常幾小時內消退' },
        ],
      },
    ],
    knowledgeBase: [
      {
        title: '預約流程',
        content: '預約方式：\n1. WhatsApp / 電話預約\n2. 親臨門市預約\n3. 網上預約（會員專享）\n\n預約須知：\n- 首次預約請提前 24 小時\n- 如需改期，請提前 4 小時通知\n- 遲到超過 15 分鐘，療程時間將相應縮短\n- 未能出席且無事先通知，需繳付 HK$200 行政費',
      },
      {
        title: '退款政策',
        content: '- 未使用的預付款項可全額退款\n- 已使用的套票不設退款\n- 療程開始後不設退款\n- 特價優惠不設退款',
      },
      {
        title: '營業時間',
        content: '星期一至五：10:00 - 21:00\n星期六：10:00 - 19:00\n星期日及公眾假期：休息\n\n預約熱線：+852 2345 6789\nWhatsApp：+852 2345 6789',
      },
    ],
  },
  cleaning: {
    id: 'cleaning',
    displayName: '亮晶晶清潔服務',
    businessHoursText: '星期一至六：08:00 - 20:00\n星期日：09:00 - 18:00\n公眾假期照常服務（需提前預約）',
    contactPhone: '+852 3456 7890',
    contactWhatsApp: '+852 3456 7890',
    persona: '你係亮晶晶清潔服務嘅 WhatsApp 助手。語氣實際直接、重效率。客人問價時主動問面積/房間數以報準啲。強調「免費上門估價」。',
    services: [
      {
        name: 'home-deep-clean',
        displayName: '全屋深層清潔',
        price: '$1,200 起（視乎面積）',
        duration: '3-5 小時',
        description: '廚房油污、浴室水垢、地板打蠟、窗戶玻璃、家具除塵',
        suitable: '新年大掃除、換季清潔、日常深層清潔',
        caution: '請預先收好貴重物品、確保水電正常供應',
        faq: [
          { q: '幾大嘅單位收幾多', a: '400呎以下 $1,200、400-700呎 $1,800、700呎以上請聯絡報價' },
          { q: '要唔要我哋提供清潔用品', a: '我哋自備所有專業清潔用品同工具' },
        ],
      },
      {
        name: 'ac-clean',
        displayName: '冷氣機清洗',
        price: '$380/部（窗口機）、$580/部（分體機）',
        duration: '45-60 分鐘/部',
        description: '拆洗隔塵網、深層清洗蒸發器、消毒殺菌、去除異味',
        suitable: '冷氣有異味、制冷效果差、超過半年未清洗',
        caution: '清洗後建議開機運行 30 分鐘吹乾',
        faq: [
          { q: '幾耐洗一次', a: '建議每 6 個月清洗一次' },
          { q: '會唔會整濕地方', a: '我哋會鋪好防水布，唔會弄髒你嘅家居' },
        ],
      },
      {
        name: 'move-clean',
        displayName: '搬入/搬出清潔',
        price: '$1,800 起（視乎面積）',
        duration: '4-6 小時',
        description: '全屋深層清潔、廚廁重點除污、地板清洗、所有櫃桶內外抹淨',
        suitable: '新租客入伙前、舊租客退租交吉、新樓入伙前',
        caution: '最好喺搬傢俬之前進行，效果最佳',
        faq: [
          { q: '幾時做最好', a: '建議搬入前 1-2 日進行' },
          { q: '包唔包除甲醛', a: '除甲醛係獨立服務，可以一齊預約，另外收費' },
        ],
      },
      {
        name: 'office-clean',
        displayName: '辦公室定期清潔',
        price: '$2,500/月起（每週一次）',
        duration: '2-3 小時/次',
        description: '地面清潔、桌面消毒、洗手間清潔、垃圾處理、公共區域維護',
        suitable: '中小企辦公室、共享工作空間、診所',
        caution: '首次服務前需上門視察環境',
        faq: [
          { q: '可以揀時間嗎', a: '可以配合你哋嘅營業時間，放工後清潔都得' },
          { q: '合約期幾長', a: '最短 3 個月，之後可逐月續約' },
        ],
      },
    ],
    knowledgeBase: [
      {
        title: '預約流程',
        content: '預約方式：\n1. WhatsApp 查詢報價\n2. 電話預約\n3. 確認日期時間後，師傅準時上門\n\n預約須知：\n- 請提前 48 小時預約\n- 改期請提前 12 小時通知\n- 當日取消需收取 50% 費用\n- 師傅到場後如因客戶原因無法進行，需收取 $200 上門費',
      },
      {
        title: '服務範圍',
        content: '服務地區：港島、九龍、新界（偏遠地區可能需加收交通費）\n\n我哋嘅優勢：\n- 所有清潔員經嚴格背景審查\n- 自備專業清潔用品\n- 服務後 24 小時內免費補做\n- 公司投保第三者責任保險',
      },
      {
        title: '收費標準',
        content: '基本收費（全屋清潔）：\n- 400呎以下：$1,200\n- 400-700呎：$1,800\n- 700-1000呎：$2,500\n- 1000呎以上：另議\n\n附加服務：\n- 雪櫃深層清潔：+$300\n- 焗爐清潔：+$400\n- 窗戶連窗框（每隻）：+$80',
      },
      {
        title: '退款政策',
        content: '- 服務前 24 小時取消：全額退款\n- 服務前 12-24 小時取消：退 50%\n- 服務前 12 小時內取消：不設退款\n- 服務完成後如不滿意：24 小時內免費補做',
      },
    ],
  },
  renovation: {
    id: 'renovation',
    displayName: '匠心裝修工程',
    businessHoursText: '星期一至五：09:00 - 19:00\n星期六：09:00 - 13:00\n星期日及公眾假期：休息（緊急工程除外）',
    contactPhone: '+852 4567 8901',
    contactWhatsApp: '+852 4567 8901',
    persona: '你係匠心裝修工程嘅 WhatsApp 助手。語氣專業穩重、耐心解答。主動強調「免費度尺報價」。遇到複雜工程需求時建議安排師傅上門睇。',
    services: [
      {
        name: 'full-reno',
        displayName: '全屋裝修',
        price: '$800-1,500/呎（視乎用料及設計）',
        duration: '45-60 個工作天',
        description: '度身設計、拆舊、水電、泥水、木工、油漆、安裝，一條龍服務',
        suitable: '新樓裝修、舊樓翻新、劏房還原',
        caution: '需預留 2-3 星期做設計圖及報價、大廈可能有裝修時間限制',
        faq: [
          { q: '全屋裝修大概幾錢', a: '400呎單位一般 $30-50萬，視乎用料同設計複雜度' },
          { q: '工程期間可以住嗎', a: '建議搬出，粉塵同噪音會影響生活' },
        ],
      },
      {
        name: 'kitchen-reno',
        displayName: '廚房翻新',
        price: '$35,000 - $80,000',
        duration: '10-15 個工作天',
        description: '拆舊廚櫃、訂造新廚櫃、更換枱面、安裝抽油煙機、水電重鋪',
        suitable: '廚櫃老化、想改善煮食空間、更換石材枱面',
        caution: '工程期間無法使用廚房，建議預備替代煮食安排',
        faq: [
          { q: '可以只換廚櫃唔換地磚嗎', a: '可以，我哋會根據你嘅需要度身報價' },
          { q: '廚櫃用咩材料', a: '標準用防潮板，可升級至實木或不鏽鋼' },
        ],
      },
      {
        name: 'painting',
        displayName: '油漆翻新工程',
        price: '$8 - $15/呎（視乎油漆品牌）',
        duration: '3-7 個工作天',
        description: '鏟底、批灰、打磨、底漆、面漆兩遍，包傢俬保護',
        suitable: '牆身發黃、甩皮、有裂紋、想轉色',
        caution: '油漆後建議通風 3-5 日先入住',
        faq: [
          { q: '用咩油漆', a: '標準用立邦/多樂士，可升級至 Benjamin Moore 等進口品牌' },
          { q: '傢俬要搬走嗎', a: '唔使，我哋會用保護膜包好所有傢俬' },
        ],
      },
      {
        name: 'bathroom-reno',
        displayName: '浴室翻新',
        price: '$25,000 - $60,000',
        duration: '7-12 個工作天',
        description: '拆舊、防水工程、鋪磚、安裝潔具、更換企缸/浴缸',
        suitable: '浴室漏水、磁磚老化、想改善浴室佈局',
        caution: '工程期間該浴室無法使用，如只有一個浴室請做好安排',
        faq: [
          { q: '防水保養幾耐', a: '我哋嘅防水工程保養 5 年' },
          { q: '可以改位置嗎', a: '座廁移位需要考慮排水管，建議師傅上門睇實際情況' },
        ],
      },
    ],
    knowledgeBase: [
      {
        title: '預約流程',
        content: '預約方式：\n1. WhatsApp 傳相片/描述需求\n2. 我哋初步報價\n3. 安排師傅免費上門度尺\n4. 3-5 個工作天內出詳細報價單\n5. 確認後簽約、安排開工日期\n\n預約須知：\n- 度尺睇位完全免費\n- 報價有效期 14 天\n- 簽約後需付 40% 訂金\n- 工程分階段驗收付款',
      },
      {
        title: '保養政策',
        content: '工程保養：\n- 防水工程：5 年保養\n- 油漆工程：1 年保養（正常使用下甩皮起泡免費補油）\n- 木工訂造：2 年保養\n- 水電工程：2 年保養\n\n保養範圍不包括：\n- 人為損壞\n- 自然災害\n- 未經我司同意的改動',
      },
      {
        title: '收費說明',
        content: '付款方式：\n- 簽約：40% 訂金\n- 中期驗收：30%\n- 完工驗收：尾數 30%\n\n接受：銀行轉帳、支票、FPS\n\n注意：\n- 報價已包基本用料及人工\n- 如需更改設計，可能產生額外費用\n- 拆舊如發現隱蔽問題（如水管老化），會即時通知及報價',
      },
    ],
  },
  consulting: {
    id: 'consulting',
    displayName: '信諾私人咨詢中心',
    businessHoursText: '星期一至五：10:00 - 20:00\n星期六：10:00 - 16:00\n星期日及公眾假期：休息',
    contactPhone: '+852 5678 9012',
    contactWhatsApp: '+852 5678 9012',
    persona: '你係信諾私人咨詢中心嘅 WhatsApp 助手。語氣溫和專業、尊重私隱。唔好主動追問咨詢內容細節。強調「所有咨詢絕對保密」。遇到緊急情況（如情緒危機）建議即時聯絡專業熱線。',
    services: [
      {
        name: 'legal-consult',
        displayName: '法律咨詢（初次面談）',
        price: '$800/45分鐘（首次優惠）',
        duration: '45 分鐘',
        description: '由執業律師提供一對一法律意見，涵蓋商業、家事、物業、勞資等範疇',
        suitable: '需要法律意見但未確定是否需要聘用律師的人士',
        caution: '請帶齊相關文件以便律師提供更準確的意見',
        faq: [
          { q: '咨詢內容保密嗎', a: '絕對保密，受律師專業保密責任保障' },
          { q: '咨詢後一定要請你哋做嗎', a: '完全沒有義務，咨詢後你可以自行決定' },
        ],
      },
      {
        name: 'financial-plan',
        displayName: '財務規劃咨詢',
        price: '$1,200/60分鐘',
        duration: '60 分鐘',
        description: '個人或家庭財務規劃、退休計劃、稅務安排、資產配置建議',
        suitable: '想理清財務狀況、規劃退休、優化稅務的人士',
        caution: '建議預先準備近 3 個月收支紀錄及現有投資組合資料',
        faq: [
          { q: '會唔會推銷產品', a: '我哋係獨立咨詢，唔代銷任何金融產品' },
          { q: '一次就夠嗎', a: '首次面談會出初步建議，如需詳細方案可安排跟進' },
        ],
      },
      {
        name: 'counselling',
        displayName: '心理輔導',
        price: '$900/50分鐘',
        duration: '50 分鐘',
        description: '由註冊輔導員/臨床心理學家提供專業心理輔導，處理情緒、壓力、人際關係等',
        suitable: '感到焦慮、抑鬱、壓力大、人際困擾、失眠等',
        caution: '輔導不等於精神科治療，如需藥物治療會轉介精神科醫生',
        faq: [
          { q: '第一次會做咩', a: '首次主要了解你嘅情況同需要，建立互信關係' },
          { q: '要做幾多次', a: '因人而異，一般建議先做 4-6 次再評估' },
        ],
      },
    ],
    knowledgeBase: [
      {
        title: '預約流程',
        content: '預約方式：\n1. WhatsApp 預約（毋需說明咨詢詳情）\n2. 電話預約\n\n預約須知：\n- 首次預約請提前 48 小時\n- 改期請提前 24 小時通知\n- 未能出席且無事先通知，需繳付全額費用\n- 所有預約資料絕對保密',
      },
      {
        title: '私隱政策',
        content: '我哋重視你的私隱：\n- 所有咨詢內容絕對保密\n- 未經你同意不會向第三方透露任何資料\n- 咨詢紀錄安全儲存，只有你的咨詢師可以查閱\n- 如需轉介其他專業人士，會先徵得你的同意\n\n例外情況（法律要求披露）：\n- 涉及傷害自己或他人的即時風險\n- 法庭命令',
      },
      {
        title: '收費及付款',
        content: '付款方式：現金、信用卡、FPS、銀行轉帳\n\n收費：\n- 法律咨詢：$800/45分鐘（首次優惠）\n- 財務規劃：$1,200/60分鐘\n- 心理輔導：$900/50分鐘\n\n套票優惠：\n- 心理輔導 6 次套票：$4,800（即每次 $800，慳 $600）\n\n取消政策：\n- 24 小時前取消：全額退款\n- 24 小時內取消：收取 50%\n- 無故缺席：收取全額',
      },
    ],
  },
  fitness: {
    id: 'fitness',
    displayName: 'ZenFit Studio',
    businessHoursText: '星期一至五：07:00 - 22:00\n星期六日：08:00 - 20:00\n公眾假期：09:00 - 18:00',
    contactPhone: '+852 6789 0123',
    contactWhatsApp: '+852 6789 0123',
    persona: '你係 ZenFit Studio 嘅 WhatsApp 助手。語氣活力正面、鼓勵性、用少少 emoji 但唔好過火。強調「第一堂半價體驗」。主動問客人嘅運動經驗同目標。',
    services: [
      {
        name: 'private-yoga',
        displayName: '私人瑜珈課',
        price: '$600/堂 → 首堂體驗價 $300',
        duration: '60 分鐘',
        description: '一對一瑜珈指導，根據你嘅身體狀況度身設計課程',
        suitable: '初學者、想改善柔軟度、有腰背痛、孕婦瑜珈',
        caution: '請穿著舒適運動服、自備瑜珈墊或租用（$20/次）、空腹 2 小時以上',
        faq: [
          { q: '完全冇做過瑜珈得唔得', a: '完全冇問題！私人班會根據你嘅程度調整' },
          { q: '有冇團體班', a: '有，小組班最多 6 人，每堂 $200' },
        ],
      },
      {
        name: 'hiit-group',
        displayName: 'HIIT 小組訓練',
        price: '$250/堂（4-8人小組）',
        duration: '45 分鐘',
        description: '高強度間歇訓練，結合有氧同力量訓練，有效燃脂塑形',
        suitable: '想減脂、提升體能、喜歡團體氣氛的人',
        caution: '高強度運動，有心臟病、高血壓或關節問題請先諮詢醫生',
        faq: [
          { q: '要幾 fit 先可以參加', a: '我哋有分初級同進階班，初學者可以由初級開始' },
          { q: '要帶咩', a: '運動服、波鞋、毛巾、水樽，其他器材我哋提供' },
        ],
      },
      {
        name: 'pilates',
        displayName: '普拉提（器械/墊上）',
        price: '$500/堂（私人）、$220/堂（小組）',
        duration: '55 分鐘',
        description: '針對核心肌群訓練，改善體態、減輕腰背痛、提升身體控制力',
        suitable: '久坐辦公室、產後修復、想改善體態、運動員交叉訓練',
        caution: '器械班需提前預約（器材有限）、如有脊椎問題請先告知導師',
        faq: [
          { q: '普拉提同瑜珈有咩分別', a: '普拉提更注重核心力量同身體控制，瑜珈更注重柔軟度同呼吸' },
          { q: '器械班同墊上班邊個好', a: '器械班有 Reformer 輔助，更適合初學者同復康需要' },
        ],
      },
      {
        name: 'personal-training',
        displayName: '私人健身訓練',
        price: '$700/堂 → 首堂體驗價 $350',
        duration: '60 分鐘',
        description: '一對一度身訂造訓練計劃，包括力量訓練、體能提升、飲食建議',
        suitable: '想增肌、減脂、備戰比賽、或者唔知點開始做運動的人',
        caution: '首堂會做體能評估，請穿運動服、波鞋',
        faq: [
          { q: '會唔會幫我設計餐單', a: '會提供基本飲食建議，如需詳細營養計劃可額外安排營養師咨詢' },
          { q: '幾耐見效', a: '一般 4-6 星期開始見到明顯變化，前提係配合飲食同堅持訓練' },
        ],
      },
    ],
    knowledgeBase: [
      {
        title: '預約流程',
        content: '預約方式：\n1. WhatsApp 預約\n2. 網上預約系統（24小時開放）\n3. 親臨 Studio 預約\n\n預約須知：\n- 請提前 12 小時預約\n- 改期請提前 6 小時通知\n- 遲到超過 10 分鐘，課堂時間相應縮短\n- 24 小時內取消或無故缺席：扣除 1 堂\n\n首次體驗：\n- 所有私人班首堂半價\n- 體驗後即日報名套票再減 $200',
      },
      {
        title: '套票優惠',
        content: '私人瑜珈：\n- 單堂 $600\n- 10 堂套票 $5,000（即 $500/堂，慳 $1,000）\n- 20 堂套票 $8,800（即 $440/堂，慳 $3,200）\n\nHIIT 小組：\n- 單堂 $250\n- 月費任上 $1,800（每月最多 12 堂）\n\n普拉提私人：\n- 10 堂套票 $4,200（即 $420/堂）\n\n私人健身：\n- 10 堂套票 $5,800（即 $580/堂，慳 $1,200）\n- 20 堂套票 $10,000（即 $500/堂，慳 $4,000）\n\n套票有效期：6 個月（由第一堂開始計）\n套票不設退款、不可轉讓',
      },
      {
        title: '場地及設施',
        content: '地址：觀塘工業區 XX 大廈 12 樓\n\n設施：\n- 2 間瑜珈房（可加熱至 38°C 做 Hot Yoga）\n- 1 間器械普拉提房（4 部 Reformer）\n- 健身區（自由重量 + 機械）\n- 更衣室連淋浴間\n- 免費 Locker\n\n提供：瑜珈墊（免費）、毛巾（$10/條）、飲用水\n\n泊車：大廈停車場 $25/小時',
      },
      {
        title: '退款政策',
        content: '- 套票一經購買不設退款\n- 套票不可轉讓\n- 如因受傷無法繼續（需醫生證明），可申請暫停套票（最長 2 個月）\n- 單堂取消：24 小時前取消可全額退款\n- 體驗堂不滿意：可安排免費重新體驗另一位導師',
      },
    ],
  },
};

export const getIndustrySeed = (id: string): IndustrySeed | undefined => {
  return industrySeedData[id];
};

export const getAllIndustryIds = (): { id: string; displayName: string }[] => {
  return Object.values(industrySeedData).map(s => ({ id: s.id, displayName: s.displayName }));
};
