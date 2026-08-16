"use strict";

// Same DI philosophy as worker.test.js: fakes in, no DB, no filesystem.
// Run with: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert');
const { handleReportJob } = require('../report');

const fakeStats = {
  generatedAt: '2026-08-16T00:00:00.000Z',
  totals: { total: 5, done: 2, pending: 3 },
  pending: [{ id: 1, title: 'Buy milk' }],
  queue: [{ kind: 'task_judge', status: 'done', count: 4 }],
};

test('handleReportJob renders the pdf and returns path + stats only', async () => {
  const rendered = [];
  const deps = {
    collectStats: async () => fakeStats,
    renderPdf: async (stats, filePath) => { rendered.push({ stats, filePath }); },
  };

  const result = await handleReportJob({ id: 'abc-123' }, deps);

  assert.equal(rendered.length, 1);
  assert.ok(rendered[0].filePath.endsWith('abc-123.pdf'));
  assert.deepEqual(result.stats, fakeStats.totals);
  // the artifact is linked, not shipped: result carries a path, not bytes
  assert.ok(result.file.endsWith('abc-123.pdf'));
  assert.ok(!result.file.includes('..'));
});

test('handleReportJob propagates render failures so the worker retries', async () => {
  const deps = {
    collectStats: async () => fakeStats,
    renderPdf: async () => { throw new Error('disk full'); },
  };

  await assert.rejects(() => handleReportJob({ id: 'x' }, deps), /disk full/);
});
