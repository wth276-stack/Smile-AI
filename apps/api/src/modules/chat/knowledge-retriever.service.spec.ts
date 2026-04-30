import { selectTopKnowledgeDocuments } from './knowledge-retriever.service';

describe('selectTopKnowledgeDocuments', () => {
  const docs = [
    { id: 'a', title: 'Low score current service', aliases: ['Current Service'], updatedAt: new Date('2026-01-01') },
    { id: 'b', title: 'Top 1', aliases: [], updatedAt: new Date('2026-01-02') },
    { id: 'c', title: 'Top 2', aliases: [], updatedAt: new Date('2026-01-03') },
    { id: 'd', title: 'Top 3', aliases: [], updatedAt: new Date('2026-01-04') },
  ];

  it('keeps the current booking service inside top-k even when its lexical score is low', () => {
    const selected = selectTopKnowledgeDocuments(
      docs,
      { a: 1, b: 100, c: 90, d: 80 },
      { topK: 2, draftService: 'Current Service' },
    );

    expect(selected.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('otherwise ranks by score', () => {
    const selected = selectTopKnowledgeDocuments(
      docs,
      { a: 1, b: 100, c: 90, d: 80 },
      { topK: 2 },
    );

    expect(selected.map((d) => d.id)).toEqual(['b', 'c']);
  });
});
