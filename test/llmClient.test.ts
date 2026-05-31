import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  __llmClientTestUtils,
  buildChapterOverviewChatRequest,
  buildFormulaNotesChatRequest,
  buildStorylineNarrativeChatRequest,
  buildVariableDetailsBatchChatRequest,
  buildVariableDetailsChatRequest,
  generateFormulaNotes,
} from '../src/services/llmClient.ts';

test('formula notes request uses chat-completions JSON contract', () => {
  const request = buildFormulaNotesChatRequest({
    formulaId: 'formula_2.1',
    latex: 'P_{ij}=...',
    context: 'Wright-Fisher transition probability.',
    section: 'Neutral evolution',
    prerequisites: [{ type: 'variable_definition', symbol: 'N', definition: 'population size', confidence: 0.9 }],
    language: 'zh',
  });

  assert.equal(request.model, 'deepseek-chat');
  assert.equal(request.response_format.type, 'json_object');
  assert.equal(request.messages[0].role, 'system');
  assert.match(request.messages[0].content, /只返回 JSON/);
  const payload = JSON.parse(request.messages[1].content);
  assert.equal(payload.task, 'formula_notes');
  assert.equal(payload.formula_id, 'formula_2.1');
  assert.match(payload.accepted_prerequisites, /symbol=N/);
});

test('variable details request carries the current formula and symbol', () => {
  const request = buildVariableDetailsChatRequest({
    formulaId: 'formula_6.5a',
    latex: '\\sum_i \\Delta q_i z_i',
    context: 'Price equation context',
    symbol: 'z_i',
    prerequisite: { type: 'variable_definition', symbol: 'z_i', meaning: 'trait value', confidence: 0.8 },
    language: 'zh',
  });
  const payload = JSON.parse(request.messages[1].content);

  assert.equal(payload.task, 'variable_details');
  assert.equal(payload.formula_id, 'formula_6.5a');
  assert.equal(payload.context, 'Price equation context');
  assert.equal(payload.symbol, 'z_i');
  assert.equal(payload.prerequisite.meaning, 'trait value');
  assert.match(payload.output_schema.shortLabel, /4-16/);
});

test('variable details batch request carries symbols and compound expressions', () => {
  const request = buildVariableDetailsBatchChatRequest({
    formulaId: 'formula_11.7b',
    latex: '\\sigma_{A A}^{2}(t)\\simeq(1-f_{t})^{2}\\sigma_{A A}^{2}(0)',
    context: 'additive by additive variance decays under inbreeding',
    symbols: [
      { symbol: '(1-f_{t})^2', kind: 'compound' },
      { symbol: 'f_t', kind: 'symbol', prerequisite: { type: 'variable_definition', symbol: 'f_t', meaning: 'inbreeding coefficient', confidence: 0.8 } },
    ],
    language: 'zh',
  });
  const payload = JSON.parse(request.messages[1].content);

  assert.equal(payload.task, 'variable_details_batch');
  assert.equal(payload.formula_id, 'formula_11.7b');
  assert.equal(payload.symbols[0].kind, 'compound');
  assert.equal(payload.symbols[0].symbol, '(1-f_{t})^2');
  assert.match(request.messages[0].content, /组合表达式解释整个组合/);
});

test('variable details parser accepts shortLabel and text', async () => {
  const result = await __llmClientTestUtils.postChatCompletion(
    buildVariableDetailsChatRequest({
      formulaId: 'formula_3.1',
      latex: 'N_e = N/(1+\\sigma_w^2)',
      context: 'Selection reduces Ne.',
      symbol: 'N_e',
      language: 'zh',
    }),
    __llmClientTestUtils.validateVariableDetails,
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"shortLabel":"有效种群大小","text":"N_e 表示经漂变与选择修正后的有效繁殖群体大小。"}',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );

  assert.equal(result.shortLabel, '有效种群大小');
  assert.match(result.text, /有效繁殖群体大小/);
});

test('variable details batch parser accepts multiple items', async () => {
  const result = await __llmClientTestUtils.postChatCompletion(
    buildVariableDetailsBatchChatRequest({
      formulaId: 'formula_11.7b',
      latex: '\\sigma_{A A}^{2}(t)\\simeq(1-f_{t})^{2}\\sigma_{A A}^{2}(0)',
      context: 'additive by additive variance decays under inbreeding',
      symbols: [{ symbol: '(1-f_{t})^2', kind: 'compound' }],
      language: 'zh',
    }),
    __llmClientTestUtils.validateVariableDetailsBatch,
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"items":[{"symbol":"(1-f_{t})^2","shortLabel":"未近交比例平方","text":"(1-f_t)^2 表示未近交比例连续作用两次后对加性×加性方差的缩放。"}]}',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );

  assert.equal(result.items[0].symbol, '(1-f_{t})^2');
  assert.equal(result.items[0].shortLabel, '未近交比例平方');
});

test('storyline narrative request defaults to Chinese formula-grounded narrative', () => {
  const request = buildStorylineNarrativeChatRequest({
    storyline: {
      id: 'allele-frequency',
      title_en: 'Allele frequency',
      title_zh: '等位基因频率',
      symbol: 'p',
      intro_en: 'Follow p.',
      intro_zh: '跟着 p 读。',
      steps: [],
    },
    selectedStep: { formula_id: 'formula_2.1', title: 'Formula 2.1', transition_en: '', transition_zh: '', support_formula_ids: [] },
    previousStep: null,
    nextStep: null,
    formula: { id: 'formula_2.1', latex: 'p', context: 'context', section: 'section', label: 'Formula 2.1' },
    formulaCopy: { plainMeaning: '含义', inThisChapter: '作用' },
    language: 'zh',
  });
  const payload = JSON.parse(request.messages[1].content);

  assert.equal(payload.task, 'storyline_narrative');
  assert.equal(payload.language, 'zh');
  assert.equal(payload.storyline.title, '等位基因频率');
  assert.match(request.messages[0].content, /不要编造教材外剧情/);
});

test('chapter overview request uses chapter formulas as grounded context', () => {
  const request = buildChapterOverviewChatRequest({
    chapterId: 'chapter15',
    chapterTitle: '第 15 章 Formula',
    chapterDescription: 'Short-term Changes in the Mean',
    language: 'zh',
    formulas: [
      {
        id: 'formula_15.15',
        label: 'Formula 15.15',
        section: 'Short-term Changes in the Mean',
        latex_preview: '\\mu_{t+1}=\\mu+\\rho(\\mu_t+S_t-\\mu)',
        context: 'This chapter tracks short-term response in the mean.',
        role: 'backbone',
      },
    ],
  });
  const payload = JSON.parse(request.messages[1].content);

  assert.equal(payload.task, 'chapter_overview');
  assert.equal(payload.chapter.id, 'chapter15');
  assert.equal(payload.formula_samples[0].role, 'backbone');
  assert.match(payload.output_schema.overview, /520-680/);
});

test('chat-completions parser extracts JSON content', async () => {
  const result = await __llmClientTestUtils.postChatCompletion(
    buildFormulaNotesChatRequest({
      formulaId: 'formula_2.1',
      latex: 'p',
      context: '',
      language: 'zh',
    }),
    __llmClientTestUtils.validateFormulaNotes,
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"plainMeaning":"一个含义","inThisChapter":"一个作用"}' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );

  assert.deepEqual(result, { plainMeaning: '一个含义', inThisChapter: '一个作用' });
});

test('formula notes parser rejects raw textbook leakage', async () => {
  await assert.rejects(
    __llmClientTestUtils.postChatCompletion(
      buildFormulaNotesChatRequest({
        formulaId: 'formula_2.8',
        latex: '\\varphi(p_t|p_0)',
        context: '',
        language: 'zh',
      }),
      __llmClientTestUtils.validateFormulaNotes,
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"plainMeaning":"Kimura used diffusion theory to obtain an analytical expression for the probability density of allele frequency at time t.","inThisChapter":"一个作用"}',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ),
    /raw textbook context/,
  );
});

test('storyline parser rejects generic bridge templates', async () => {
  await assert.rejects(
    __llmClientTestUtils.postChatCompletion(
      buildStorylineNarrativeChatRequest({
        storyline: {
          id: 'allele-frequency',
          title_en: 'Allele frequency',
          title_zh: '等位基因频率',
          symbol: 'p',
          intro_en: '',
          intro_zh: '',
          steps: [],
        },
        selectedStep: { formula_id: 'formula_2.8', title: 'Formula 2.8', transition_en: '', transition_zh: '', support_formula_ids: [] },
        previousStep: null,
        nextStep: null,
        formula: { id: 'formula_2.8', latex: '\\varphi(p_t|p_0)', context: '', label: 'Formula 2.8' },
        formulaCopy: null,
        language: 'zh',
      }),
      __llmClientTestUtils.validateStorylineNarrative,
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"role":"它很重要。","transition":"符号外形延续下来，承担新任务。","next":"下一步继续。"}',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ),
    /generic template/,
  );
});

test('chapter overview parser accepts grounded overview text', async () => {
  const result = await __llmClientTestUtils.postChatCompletion(
    buildChapterOverviewChatRequest({
      chapterId: 'chapter15',
      chapterTitle: '第 15 章 Formula',
      chapterDescription: '',
      language: 'zh',
      formulas: [],
    }),
    __llmClientTestUtils.validateChapterOverview,
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"overview":"本章围绕短期均值变化展开，先把响应写成递推关系，再用 Formula 15.15 追踪均值如何受选择和遗传结构牵引。读图时可以先看主干公式，再观察后续公式如何补充方差、衰减和时间累积。"}' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );

  assert.match(result.overview, /短期均值变化/);
});

test('chat-completions parser rejects non-JSON content', async () => {
  await assert.rejects(
    __llmClientTestUtils.postChatCompletion(
      buildFormulaNotesChatRequest({
        formulaId: 'formula_2.1',
        latex: 'p',
        context: '',
        language: 'zh',
      }),
      __llmClientTestUtils.validateFormulaNotes,
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'plain text only' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
    /did not contain JSON/,
  );
});

test('chat-completions request times out with a learner-safe error', async () => {
  await assert.rejects(
    __llmClientTestUtils.postChatCompletion(
      buildFormulaNotesChatRequest({
        formulaId: 'formula_2.1',
        latex: 'p',
        context: '',
        language: 'zh',
      }),
      __llmClientTestUtils.validateFormulaNotes,
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
      1,
    ),
    /timed out/,
  );
});

test('chat-completions request surfaces proxy JSON errors', async () => {
  await assert.rejects(
    __llmClientTestUtils.postChatCompletion(
      buildFormulaNotesChatRequest({
        formulaId: 'formula_2.1',
        latex: 'p',
        context: '',
        language: 'zh',
      }),
      __llmClientTestUtils.validateFormulaNotes,
      async () =>
        new Response(JSON.stringify({ error: 'LLM proxy is not configured.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
    /proxy is not configured/,
  );
});

test('public LLM methods dedupe repeated requests by formula and language', async () => {
  __llmClientTestUtils.requestCache.clear();
  __llmClientTestUtils.setStaticCacheForTest(null);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"plainMeaning":"去重含义","inThisChapter":"去重作用"}' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const input = {
      formulaId: 'formula_2.1',
      latex: 'p',
      context: '',
      language: 'zh' as const,
    };
    const [first, second] = await Promise.all([generateFormulaNotes(input), generateFormulaNotes(input)]);
    assert.equal(calls, 1);
    assert.equal(first.plainMeaning, '去重含义');
    assert.deepEqual(first, second);
  } finally {
    globalThis.fetch = originalFetch;
    __llmClientTestUtils.requestCache.clear();
    __llmClientTestUtils.resetStaticCache();
  }
});

test('public LLM methods prefer static cache before realtime fetch', async () => {
  __llmClientTestUtils.requestCache.clear();
  __llmClientTestUtils.setStaticCacheForTest({
    version: 1,
    generated_at: '2026-05-30T00:00:00.000Z',
    source: 'test',
    model: 'deepseek-chat',
    entries: {
      'formula-notes:formula_2.1:zh': {
        plainMeaning: '静态缓存含义',
        inThisChapter: '静态缓存作用',
      },
    },
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('fetch should not be called');
  }) as typeof fetch;

  try {
    const result = await generateFormulaNotes({
      formulaId: 'formula_2.1',
      latex: 'p',
      context: '',
      language: 'zh',
    });
    assert.equal(calls, 0);
    assert.equal(result.plainMeaning, '静态缓存含义');
  } finally {
    globalThis.fetch = originalFetch;
    __llmClientTestUtils.requestCache.clear();
    __llmClientTestUtils.resetStaticCache();
  }
});
