// DSH 模型目录 → 前端选项：不硬编码模型名，保留 reasoning/图片能力/价格。
import assert from 'node:assert/strict';
import { catalogChoices, findCatalogModel } from '../src/model-options.js';

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

console.log('✅ DSH 模型目录选项测试通过');
