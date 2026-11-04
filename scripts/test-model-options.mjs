// DSH 模型目录 → 前端选项：不硬编码模型名，保留 reasoning/图片能力/价格。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { catalogChoices, findCatalogModel, pickCatalogFallback } from '../src/model-options.js';

const priceTable = {
  models: {
    'deepseek-flash': { label: 'Flash', off: { cacheMiss: 1, output: 4 } },
    'deepseek-v4-pro': { label: 'Pro', off: { cacheMiss: 4.5, output: 13.5 } },
  },
};
const catalog = {
  routableProviders: ['deepseek-official'],
  groups: [
    {
      id: 'deepseek-official',
      models: [
        {
          id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash',
          inputModalities: ['text', 'image'],
          reasoning: { defaultEffort: 'high', efforts: [{ id: 'low' }, { id: 'high' }, { id: 'max' }] },
        },
        {
          id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro',
          inputModalities: ['text'],
          reasoning: { defaultEffort: 'high', efforts: [{ id: 'low' }, { id: 'high' }] },
        },
      ],
    },
    { id: 'not-routable', models: [{ id: 'ghost', name: 'Ghost' }] },
  ],
};

const { models, providers } = catalogChoices(catalog, { priceTable });
assert.deepEqual(providers, ['deepseek-official']);
assert.equal(models.length, 2, '不可路由 provider 必须过滤');
const flash = findCatalogModel(models, 'deepseek-official', 'deepseek-flash');
assert.ok(flash);
assert.equal(flash.imageInput, true, 'flash 支持图片');
assert.deepEqual(flash.efforts, ['low', 'high', 'max']);
assert.equal(flash.defaultEffort, 'high');
assert.equal(flash.price.tier, 'cheap');
const pro = findCatalogModel(models, 'deepseek-official', 'deepseek-v4-pro');
assert.equal(pro.imageInput, false, 'pro 仅文本');
assert.equal(pro.price.tier, 'expensive');
assert.deepEqual(pro.efforts, ['low', 'high']);
assert.equal(findCatalogModel(models, 'deepseek-official', 'nope'), null);
assert.equal(pickCatalogFallback(models, 'deepseek-official', 'deepseek-flash'), null, '当前模型可用时不回退');
const sameModel = pickCatalogFallback(models, 'deepseek-account', 'deepseek-flash');
assert.equal(sameModel.provider, 'deepseek-official', '优先同名模型换 provider');
const first = pickCatalogFallback(models, 'missing-provider', 'missing-model');
assert.equal(first.model, 'deepseek-flash', '没有同名模型才取目录第一项');
assert.equal(pickCatalogFallback([], 'x', 'y'), null);
const bridge = fs.readFileSync('src/bridge.js', 'utf8');
assert.ok(bridge.includes('pickCatalogFallback(choices.models, provider, model)'),
  'selectModel 不可用时必须从真实目录挑 fallback');
assert.ok(bridge.includes('model-unavailable|select an available model'),
  '只对模型不可用错误做 fallback，不吞别的错误');

console.log('✅ DSH 模型目录选项测试通过');
