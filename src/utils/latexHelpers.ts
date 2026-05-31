export interface BracedGroup {
  value: string;
  end: number;
}

export function readBracedGroup(input: string, start: number): BracedGroup | null {
  if (input[start] !== '{') return null;
  let depth = 0;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return { value: input.slice(start + 1, index), end: index + 1 };
  }
  return null;
}

export function skipWhitespace(input: string, start: number): number {
  let index = start;
  while (/\s/.test(input[index] || '')) index += 1;
  return index;
}
