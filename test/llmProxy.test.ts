import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import handler from '../api/llm.js';

class MockResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  body = '';

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
  }

  end(value = '') {
    this.body = String(value);
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('llm proxy forwards parsed JSON bodies without exposing browser-side keys', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalBase = process.env.DEEPSEEK_API_BASE;
  let forwardedBody = '';
  let authorization = '';

  process.env.DEEPSEEK_API_KEY = 'server-side-test-key';
  process.env.DEEPSEEK_API_BASE = 'https://example.test';
  globalThis.fetch = (async (_url, init) => {
    forwardedBody = String(init?.body);
    authorization = String((init?.headers as Record<string, string>)?.Authorization || '');
    return new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const response = new MockResponse();
    await handler({ method: 'POST', body: { model: 'deepseek-chat', messages: [] } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(forwardedBody, '{"model":"deepseek-chat","messages":[]}');
    assert.equal(authorization, 'Bearer server-side-test-key');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('DEEPSEEK_API_KEY', originalKey);
    restoreEnv('DEEPSEEK_API_BASE', originalBase);
  }
});

test('llm proxy reads raw request streams for Node-style deployments', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let forwardedBody = '';

  process.env.DEEPSEEK_API_KEY = 'server-side-test-key';
  globalThis.fetch = (async (_url, init) => {
    forwardedBody = String(init?.body);
    return new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const request = Readable.from(['{"model":"deepseek-chat","messages":[]}']) as Readable & { method: string };
    request.method = 'POST';
    const response = new MockResponse();

    await handler(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(forwardedBody, '{"model":"deepseek-chat","messages":[]}');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('DEEPSEEK_API_KEY', originalKey);
  }
});

test('llm proxy reports a safe error when the server key is missing', async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;

  try {
    const response = new MockResponse();
    await handler({ method: 'POST', body: {} }, response);

    assert.equal(response.statusCode, 500);
    assert.deepEqual(JSON.parse(response.body), { error: 'LLM proxy is not configured.' });
  } finally {
    restoreEnv('DEEPSEEK_API_KEY', originalKey);
  }
});
