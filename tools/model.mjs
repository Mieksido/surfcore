/**
 * 模型接入：进程外模型（OpenAI 兼容）与离线桩之间的一步切换
 * ============================================================================
 * 位置：组装层（app）。**选哪个模型是部署决定**，不是内核的事、也不是包的事。
 * 内核只认 `model.complete({messages, tools})` 这个端口（已有的 model-http.js 实现它）。
 *
 * 三条规矩：
 *   · 没配地址就用离线桩（`createRuleModel`），并**明说**自己是桩
 *   · 配了地址才连真模型；连不上时如实报错（内核会降级成"说一句/沉默"）
 *   · 密钥只从环境读，不落到状态文件、不进日志
 */
import { createRuleModel } from '../kernel/expression/model-port.js';
import { createHttpModelPort } from '../kernel/expression/model-http.js';

/**
 * @param {object} env 环境变量（测试可注入）
 * @returns {{model:object, kind:'http'|'stub', info:string}}
 */
export function pickModel(env = process.env) {
  const endpoint = String(env.SURFCORE_MODEL_ENDPOINT ?? '').trim();
  const name = String(env.SURFCORE_MODEL ?? '').trim();
  const apiKey = String(env.SURFCORE_MODEL_KEY ?? '').trim();

  if (!endpoint || !name) {
    return {
      kind: 'stub',
      model: createRuleModel({ name: '小鲸鱼' }),
      info: '离线桩：只会按规则回话（配 SURFCORE_MODEL_ENDPOINT + SURFCORE_MODEL 才会连真模型）',
    };
  }

  return {
    kind: 'http',
    model: createHttpModelPort({ endpoint, model: name, apiKey }),
    info: `真模型：${name} @ ${endpoint}`,
  };
}
