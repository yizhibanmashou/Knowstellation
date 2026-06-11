import type {
  ChapterDependencies,
  FormulaDependency,
  FormulaPrerequisite,
  SymbolSenseAmbiguousSymbol,
  SymbolSenseFormulaResult,
  SymbolSenseMatchType,
  SymbolSenseMergeDecision,
  SymbolSensePayload,
  SymbolSenseRegistryEntry,
  SymbolSenseResolution,
  SymbolSenseSource,
} from '../types/formula.ts';

const MATCH_TYPES = new Set<SymbolSenseMatchType>([
  'formula_dependency',
  'variable_definition',
  'self_defined',
  'unresolved',
]);

const MERGE_ACTIONS = new Set(['merge', 'create_new', 'ambiguous']);
const RESOLUTION_STRATEGIES = new Set(['deferred_to_human', 'nearest_prior', 'context_match']);

export interface SymbolSenseValidationIssue {
  formula_id?: string;
  field?: string;
  message: string;
}

export interface SymbolSenseNormalizeOptions {
  chapter: ChapterDependencies;
  generatedAt?: string;
}

export interface SymbolSenseConversion {
  dependencies: FormulaDependency[];
  ambiguous: SymbolSenseAmbiguousSymbol[];
  registry: Record<string, SymbolSenseRegistryEntry>;
  issues: SymbolSenseValidationIssue[];
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export interface SymbolSensePromptRecord {
  formula_id: string;
  chapter_id: string;
  latex: string;
  label: string;
  section: string;
  subsection: string;
  position: number;
  symbols_used: string[];
  symbols_defined: string[];
  nearby_text: string;
  chapter_context: {
    formulas_before: Array<{
      id: string;
      latex: string;
      label: string;
      section: string;
      subsection: string;
      position: number;
      symbols_defined: string[];
    }>;
  };
  prompt: string;
}

export function buildSymbolSensePromptRecords(chapter: ChapterDependencies): SymbolSensePromptRecord[] {
  const formulas = [...chapter.formulas].sort((a, b) => a.position - b.position);

  return formulas.map((formula, index) => {
    const formulasBefore = formulas.slice(0, index).map((prior) => ({
      id: prior.id,
      latex: prior.latex,
      label: prior.label,
      section: prior.section,
      subsection: prior.subsection,
      position: prior.position,
      symbols_defined: prior.symbols_defined,
    }));

    return {
      formula_id: formula.id,
      chapter_id: chapter.chapter_id,
      latex: formula.latex,
      label: formula.label,
      section: formula.section,
      subsection: formula.subsection,
      position: formula.position,
      symbols_used: formula.symbols_used,
      symbols_defined: formula.symbols_defined,
      nearby_text: formula.context_text,
      chapter_context: {
        formulas_before: formulasBefore,
      },
      prompt: buildPromptText(chapter.chapter_id, formula, formulasBefore),
    };
  });
}

export function normalizeSymbolSensePayload(
  raw: unknown,
  options: SymbolSenseNormalizeOptions,
): { payload: SymbolSensePayload | null; issues: SymbolSenseValidationIssue[] } {
  const issues: SymbolSenseValidationIssue[] = [];
  const chapter = options.chapter;
  const formulaIds = new Set(chapter.formulas.map((formula) => formula.id));

  const rawResults = extractRawResults(raw, issues);
  if (!rawResults) {
    return { payload: null, issues };
  }

  const results: SymbolSenseFormulaResult[] = [];
  for (const rawResult of rawResults) {
    const result = normalizeFormulaResult(rawResult, formulaIds, issues);
    if (result) {
      results.push(result);
    }
  }

  if (results.length !== chapter.formulas.length) {
    issues.push({
      field: 'results',
      message: `Expected ${chapter.formulas.length} formula results, received ${results.length}.`,
    });
  }

  const seen = new Set(results.map((result) => result.formula_id));
  for (const formula of chapter.formulas) {
    if (!seen.has(formula.id)) {
      issues.push({
        formula_id: formula.id,
        field: 'formula_id',
        message: 'Missing Symbol Sense result for formula.',
      });
    }
  }

  return {
    payload: {
      chapter_id: chapter.chapter_id,
      version: 1,
      generated_at: options.generatedAt ?? new Date().toISOString(),
      results,
    },
    issues,
  };
}

export function convertSymbolSenseToDependencies(
  chapter: ChapterDependencies,
  payload: SymbolSensePayload,
): SymbolSenseConversion {
  const issues: SymbolSenseValidationIssue[] = [];
  const formulasById = new Map(chapter.formulas.map((formula) => [formula.id, formula]));
  const positionById = new Map(chapter.formulas.map((formula) => [formula.id, formula.position]));
  const dependencies: FormulaDependency[] = [];
  const ambiguous: SymbolSenseAmbiguousSymbol[] = [];
  const registry: Record<string, SymbolSenseRegistryEntry> = {};
  const resultByFormulaId = new Map(payload.results.map((result) => [result.formula_id, result]));

  for (const formula of chapter.formulas) {
    const result = resultByFormulaId.get(formula.id);
    const prerequisites: FormulaPrerequisite[] = [];
    const seen = new Set<string>();

    if (!result) {
      dependencies.push({ dependent_id: formula.id, prerequisites });
      continue;
    }

    ambiguous.push(...result.ambiguous_symbols);
    for (const decision of result.merge_decisions) {
      addMergeDecisionToRegistry(registry, decision, result.formula_id);
    }

    for (const resolution of result.resolution) {
      addResolutionToRegistry(registry, resolution, result.formula_id);

      if (resolution.match_type === 'self_defined') {
        continue;
      }

      if (resolution.match_type === 'unresolved' || resolution.confidence < 0.4) {
        ambiguous.push({
          symbol: resolution.symbol,
          candidates: resolution.candidates,
          resolution_strategy: 'deferred_to_human',
          note: resolution.reason || 'Symbol could not be resolved with sufficient confidence.',
        });
        continue;
      }

      if (resolution.match_type === 'formula_dependency') {
        const targetId = resolution.source.type === 'formula' ? resolution.source.formula_id : '';
        const targetPosition = positionById.get(targetId);
        if (!targetId || !formulasById.has(targetId)) {
          issues.push({
            formula_id: result.formula_id,
            field: 'resolution.source.formula_id',
            message: `Unknown prerequisite formula id "${targetId}".`,
          });
          continue;
        }
        if (targetPosition === undefined || targetPosition >= formula.position) {
          issues.push({
            formula_id: result.formula_id,
            field: 'resolution.source.formula_id',
            message: `Formula dependency "${targetId}" is not upstream of "${result.formula_id}".`,
          });
          continue;
        }

        const key = `formula:${targetId}:${resolution.symbol}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        prerequisites.push({
          type: 'formula',
          target_id: targetId,
          via_symbol: resolution.symbol,
          relation: 'defines_symbol',
          reason: resolution.reason,
          confidence: resolution.confidence,
          cross_chapter: false,
          edge_status: 'accepted',
          edge_evidence: 'llm_reasoned',
          canonical_symbol: resolution.symbol,
          symbol_role: 'symbol',
          edge_weight: 0.45,
          sense_id: resolution.sense_id,
          relationship: resolution.relationship,
          meaning: resolution.meaning,
          candidates: resolution.candidates,
        });
        continue;
      }

      if (resolution.match_type === 'variable_definition') {
        const key = `variable:${resolution.symbol}:${resolution.sense_id}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        prerequisites.push({
          type: 'variable_definition',
          symbol: resolution.symbol,
          definition: resolution.source.type === 'text' ? resolution.source.text_excerpt : resolution.meaning,
          meaning: resolution.meaning,
          source: resolution.source.type === 'text' ? 'nearby_text' : resolution.source.type,
          source_excerpt: resolution.source.type === 'text' ? resolution.source.text_excerpt : undefined,
          relation: 'defines_symbol',
          reason: resolution.reason,
          confidence: resolution.confidence,
          edge_status: 'accepted',
          edge_evidence: 'text_definition',
          canonical_symbol: resolution.symbol,
          symbol_role: 'symbol',
          edge_weight: 0.65,
          sense_id: resolution.sense_id,
          relationship: resolution.relationship,
          candidates: resolution.candidates,
        });
      }
    }

    dependencies.push({ dependent_id: formula.id, prerequisites });
  }

  return { dependencies, ambiguous, registry, issues };
}

export function buildDevelopmentDependencyPayload(
  chapter: ChapterDependencies,
  payload: SymbolSensePayload,
  generatedAt = new Date().toISOString(),
): { chapter: ChapterDependencies; registry: Record<string, SymbolSenseRegistryEntry>; issues: SymbolSenseValidationIssue[] } {
  const conversion = convertSymbolSenseToDependencies(chapter, payload);
  return {
    chapter: {
      ...chapter,
      version: chapter.version + 1,
      generated_at: generatedAt,
      dependencies: conversion.dependencies,
      ambiguous: conversion.ambiguous,
    },
    registry: conversion.registry,
    issues: conversion.issues,
  };
}

function buildPromptText(
  chapterId: string,
  formula: ChapterDependencies['formulas'][number],
  formulasBefore: SymbolSensePromptRecord['chapter_context']['formulas_before'],
): string {
  const input = {
    formula_id: formula.id,
    latex: formula.latex,
    section: formula.section,
    subsection: formula.subsection,
    position: formula.position,
    symbols_used: formula.symbols_used,
    symbols_defined: formula.symbols_defined,
    chapter_context: {
      formulas_before: formulasBefore,
    },
    nearby_text: formula.context_text,
  };

  return [
    '你是一名专业的数学知识工程师。请分析当前教材公式中每个符号的含义来源。',
    '严格只使用当前公式之前的公式作为公式级定义来源，不允许引用下游公式。',
    '请返回 JSON，字段必须包含 formula_id, symbols_used, symbols_defined, resolution, ambiguous_symbols, merge_decisions。',
    'match_type 只能是 formula_dependency, variable_definition, self_defined, unresolved。',
    `章节: ${chapterId}`,
    '输入:',
    JSON.stringify(input, null, 2),
  ].join('\n\n');
}

function extractRawResults(raw: unknown, issues: SymbolSenseValidationIssue[]): unknown[] | null {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (isRecord(raw)) {
    const results = raw.results;
    if (Array.isArray(results)) {
      return results;
    }
  }
  issues.push({
    field: 'results',
    message: 'Symbol Sense input must be an array or an object with a results array.',
  });
  return null;
}

function normalizeFormulaResult(
  raw: unknown,
  formulaIds: Set<string>,
  issues: SymbolSenseValidationIssue[],
): SymbolSenseFormulaResult | null {
  if (!isRecord(raw)) {
    issues.push({ message: 'Formula result must be an object.' });
    return null;
  }

  const formulaId = asString(raw.formula_id);
  if (!formulaId) {
    issues.push({ field: 'formula_id', message: 'Missing formula_id.' });
    return null;
  }
  if (!formulaIds.has(formulaId)) {
    issues.push({ formula_id: formulaId, field: 'formula_id', message: 'Unknown formula_id.' });
    return null;
  }

  const result: SymbolSenseFormulaResult = {
    formula_id: formulaId,
    symbols_used: asStringArray(raw.symbols_used),
    symbols_defined: asStringArray(raw.symbols_defined),
    resolution: [],
    ambiguous_symbols: [],
    merge_decisions: [],
  };

  if (!Array.isArray(raw.resolution)) {
    issues.push({ formula_id: formulaId, field: 'resolution', message: 'resolution must be an array.' });
  } else {
    for (const item of raw.resolution) {
      const resolution = normalizeResolution(item, formulaId, issues);
      if (resolution) {
        result.resolution.push(resolution);
      }
    }
  }

  if (Array.isArray(raw.ambiguous_symbols)) {
    result.ambiguous_symbols = raw.ambiguous_symbols.map((item) => normalizeAmbiguous(item)).filter(isPresent);
  }

  if (Array.isArray(raw.merge_decisions)) {
    result.merge_decisions = raw.merge_decisions.map((item) => normalizeMergeDecision(item)).filter(isPresent);
  }

  return result;
}

function normalizeResolution(
  raw: unknown,
  formulaId: string,
  issues: SymbolSenseValidationIssue[],
): SymbolSenseResolution | null {
  if (!isRecord(raw)) {
    issues.push({ formula_id: formulaId, field: 'resolution', message: 'Resolution item must be an object.' });
    return null;
  }

  const matchType = asString(raw.match_type) as SymbolSenseMatchType;
  if (!MATCH_TYPES.has(matchType)) {
    issues.push({
      formula_id: formulaId,
      field: 'resolution.match_type',
      message: `Invalid match_type "${asString(raw.match_type)}".`,
    });
    return null;
  }

  const symbol = asString(raw.symbol);
  const senseId = asString(raw.sense_id);
  if (!symbol || !senseId) {
    issues.push({
      formula_id: formulaId,
      field: 'resolution',
      message: 'Resolution item requires symbol and sense_id.',
    });
    return null;
  }

  return {
    symbol,
    sense_id: senseId,
    match_type: matchType,
    source: normalizeSource(raw.source),
    meaning: asString(raw.meaning),
    scope: {
      section: isRecord(raw.scope) ? asString(raw.scope.section) : '',
      position_range: {
        start: isRecord(raw.scope) && isRecord(raw.scope.position_range) ? asNullableNumber(raw.scope.position_range.start) : null,
        end: isRecord(raw.scope) && isRecord(raw.scope.position_range) ? asNullableNumber(raw.scope.position_range.end) : null,
      },
    },
    relationship: asString(raw.relationship),
    confidence: clampConfidence(raw.confidence),
    reason: asString(raw.reason),
    candidates: Array.isArray(raw.candidates) ? raw.candidates.map((item) => normalizeCandidate(item)).filter(isPresent) : [],
  };
}

function normalizeSource(raw: unknown): SymbolSenseSource {
  if (!isRecord(raw)) {
    return { type: 'none' };
  }

  const type = asString(raw.type);
  if (type === 'formula') {
    return {
      type: 'formula',
      formula_id: asString(raw.formula_id),
      text_excerpt: asString(raw.text_excerpt) || undefined,
    };
  }
  if (type === 'text') {
    return {
      type: 'text',
      text_excerpt: asString(raw.text_excerpt),
      formula_id: asString(raw.formula_id) || undefined,
    };
  }
  return { type: 'none' };
}

function normalizeCandidate(raw: unknown) {
  if (!isRecord(raw)) {
    return null;
  }
  return {
    sense_id: asString(raw.sense_id),
    meaning: asString(raw.meaning),
    confidence: clampConfidence(raw.confidence),
    reason: asString(raw.reason) || undefined,
    source: asString(raw.source) || undefined,
  };
}

function normalizeAmbiguous(raw: unknown): SymbolSenseAmbiguousSymbol | null {
  if (!isRecord(raw)) {
    return null;
  }
  const strategy = asString(raw.resolution_strategy);
  return {
    symbol: asString(raw.symbol),
    candidates: Array.isArray(raw.candidates) ? raw.candidates.map((item) => normalizeCandidate(item)).filter(isPresent) : [],
    resolution_strategy: RESOLUTION_STRATEGIES.has(strategy) ? strategy as SymbolSenseAmbiguousSymbol['resolution_strategy'] : 'deferred_to_human',
    note: asString(raw.note),
  };
}

function normalizeMergeDecision(raw: unknown): SymbolSenseMergeDecision | null {
  if (!isRecord(raw)) {
    return null;
  }
  const action = asString(raw.action);
  return {
    symbol: asString(raw.symbol),
    existing_sense_id: raw.existing_sense_id === null ? null : asString(raw.existing_sense_id) || null,
    new_sense_id: asString(raw.new_sense_id),
    action: MERGE_ACTIONS.has(action) ? action as SymbolSenseMergeDecision['action'] : 'ambiguous',
    reason: asString(raw.reason),
  };
}

function addResolutionToRegistry(
  registry: Record<string, SymbolSenseRegistryEntry>,
  resolution: SymbolSenseResolution,
  formulaId: string,
) {
  const entry = registry[resolution.sense_id] ?? {
    sense_id: resolution.sense_id,
    symbol: resolution.symbol,
    meaning: resolution.meaning,
    source: resolution.source,
    scope: resolution.scope,
    evidence_formula_ids: [],
    merge_actions: [],
  };
  if (!entry.evidence_formula_ids.includes(formulaId)) {
    entry.evidence_formula_ids.push(formulaId);
  }
  entry.meaning ||= resolution.meaning;
  registry[resolution.sense_id] = entry;
}

function addMergeDecisionToRegistry(
  registry: Record<string, SymbolSenseRegistryEntry>,
  decision: SymbolSenseMergeDecision,
  formulaId: string,
) {
  const key = decision.new_sense_id || decision.existing_sense_id;
  if (!key) {
    return;
  }
  const entry = registry[key] ?? {
    sense_id: key,
    symbol: decision.symbol,
    meaning: '',
    source: { type: 'none' },
    scope: { section: '', position_range: { start: null, end: null } },
    evidence_formula_ids: [],
    merge_actions: [],
  };
  if (!entry.evidence_formula_ids.includes(formulaId)) {
    entry.evidence_formula_ids.push(formulaId);
  }
  entry.merge_actions.push(decision);
  registry[key] = entry;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
