import { describe, expect, it } from 'vitest';
import { classifyQuestion, buildOpeningHoursReply } from './question-router';

describe('faq_hours pattern matching', () => {
  it('detects 唔開門 as faq_hours', () => {
    const r = classifyQuestion('4月28號唔開門？');
    expect(r.questionType).toBe('faq_hours');
    expect(r.isGlobalFaq).toBe(true);
  });

  it('detects 收幾點 as faq_hours', () => {
    const r = classifyQuestion('28號收幾點？');
    expect(r.questionType).toBe('faq_hours');
    expect(r.isGlobalFaq).toBe(true);
  });

  it('detects 邊日開門 as faq_hours', () => {
    const r = classifyQuestion('邊日開門？');
    expect(r.questionType).toBe('faq_hours');
    expect(r.isGlobalFaq).toBe(true);
  });

  it('detects 星期日有冇開 as faq_hours', () => {
    const r = classifyQuestion('星期日有冇開？');
    expect(r.questionType).toBe('faq_hours');
    expect(r.isGlobalFaq).toBe(true);
  });

  it('detects 營業時間 as faq_hours', () => {
    const r = classifyQuestion('你哋營業時間係幾多？');
    expect(r.questionType).toBe('faq_hours');
    expect(r.isGlobalFaq).toBe(true);
  });
});

describe('buildOpeningHoursReply', () => {
  const settings = {
    businessName: 'Beauty Salon',
    businessHoursText: '星期一至六 10:00–21:00\n星期日休息',
    businessHours: {
      mon: '10:00-21:00',
      tue: '10:00-21:00',
      wed: '10:00-21:00',
      thu: '10:00-21:00',
      fri: '10:00-21:00',
      sat: '10:00-21:00',
      sun: 'closed',
    },
  };

  it('answers a general opening-hours question with full text', () => {
    const reply = buildOpeningHoursReply('營業時間係幾多？', settings);
    expect(reply).not.toBeNull();
    expect(reply).toContain('Beauty Salon');
    expect(reply).toContain('星期一至六');
  });

  it('answers 星期日有冇開 with closed status', () => {
    const reply = buildOpeningHoursReply('星期日有冇開？', settings);
    expect(reply).not.toBeNull();
    expect(reply).toContain('休息');
    expect(reply).toContain('星期日');
  });

  it('answers 星期一 with specific hours', () => {
    const reply = buildOpeningHoursReply('星期一幾點開？', settings);
    expect(reply).not.toBeNull();
    expect(reply).toContain('10:00-21:00');
  });

  it('returns null when no business hours data', () => {
    const reply = buildOpeningHoursReply('營業時間？', {});
    expect(reply).toBeNull();
  });
});
