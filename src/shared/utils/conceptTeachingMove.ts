function compactText(value = '', maxLength = 180): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).replace(/\s+\S*$/, '')}...`;
}

export interface ConceptTeachingMove {
  teaching_move: string;
  teaching_move_zh: string;
  source_sentence: string;
}

export function conceptTeachingMoveFromContext(context = ''): ConceptTeachingMove | null {
  const normalized = context.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const sentences = normalized
    .replace(/\$\$[\s\S]*?\$\$/g, ' [formula] ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const patterns: Array<{ move: string; zh: string; test: RegExp }> = [
    { move: 'recalls prior equations to propose an estimator', zh: '回忆前式后提出估计量', test: /\brecalling\b.*\b(suggests?|estimator|approach)\b/i },
    { move: 'introduces an estimator', zh: '作为估计量引入', test: /\bestimat(?:or|e|ed|ing)\b/i },
    { move: 'uses a named correction to modify an existing measure', zh: '在已有度量上加入校正项', test: /\bcorrected\s+version\b|\bdiffers\s+from\b|\baddition\s+of\b/i },
    { move: 'states the formula for a design or case', zh: '针对特定设计给出公式', test: /\b(?:is|are)\s+given\s+(?:in|by)|\bbecomes\b|\bresponse\s+becomes\b/i },
    { move: 'defines a quantity explicitly', zh: '直接定义一个量', test: /\bdefined\s+as\b/i },
    { move: 'derives a simplified ratio after cancellation', zh: '通过消去共同项得到简化比值', test: /\bcancel\b|\bcancelled\b|\bcanceling\b|\bhence\b.*\broughly the same\b/i },
    { move: 'names a quantity used in the literature', zh: '给出文献中的名称', test: /\b(?:called|denoted\s+by)\b/i },
    { move: 'sets notation before the formula', zh: '先设定符号再写公式', test: /\b(?:let|letting)\b/i },
    { move: 'explains symbols with a where clause', zh: '用 where 解释符号', test: /\bwhere\b/i },
  ];
  for (const pattern of patterns) {
    const hit = sentences.find((sentence) => pattern.test.test(sentence));
    if (hit) {
      return {
        teaching_move: pattern.move,
        teaching_move_zh: pattern.zh,
        source_sentence: compactText(hit, 210),
      };
    }
  }
  return {
    teaching_move: 'uses nearby prose as formula evidence',
    teaching_move_zh: '由邻近段落支撑',
    source_sentence: compactText(sentences[0] || normalized, 210),
  };
}
