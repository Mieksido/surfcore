/**
 * 内核自己的设置项（阈值类）
 * ============================================================================
 * 位置：内核 settings 模块的**声明表**。它只是数据：告诉设置页"有这几项、默认多少、代价是什么"。
 * 真正的生效在 memory.configure()（读这张表的值）。
 *
 * 为什么单列一个文件：这是"可调参数"，和"模块策略"分开——
 * 改阈值的人不需要看算法，看算法的人不需要背阈值。
 */
export const KERNEL_IDENTITY = Object.freeze({ publisher: 'surfcore', name: 'kernel' });

export const KERNEL_SETTINGS = Object.freeze([
  {
    key: 'memory.mode',
    label: '记忆方式',
    description: '读取哪一套：叙事（衰减卡+全量卡）或向量（按当前消息检索）',
    defaultValue: 'narrative',
    options: ['narrative', 'vector'],
    cost: '切换只改读取/注入；两套存储都继续写入，不会停止任何一边',
    group: 'basic',
  },
  {
    key: 'memory.vector.enabled',
    label: '启用向量存储',
    description: '关掉 = 不再摄取/编码；不影响叙事记忆',
    defaultValue: true,
    options: [true, false],
    cost: '关掉后新记忆不进向量线；已有向量索引还在',
    group: 'basic',
  },
  {
    key: 'memory.vector.modelSpace',
    label: '当前向量模型索引',
    description: '每个模型一套索引；换模型就换这个标识（例如 bge-m3@1024-cloud-v1）',
    defaultValue: 'default',
    type: 'text',
    maxChars: 80,
    cost: '换标识后旧索引不会删，但也不会被读取；需要时可以重建新索引',
    group: 'advanced',
  },
  {
    key: 'memory.vector.batchSize',
    label: '每批编码多少条',
    description: '一次请求送给 embedding 服务的条数',
    defaultValue: 8,
    options: [4, 8, 16],
    cost: '越大越快，但单次失败影响更多条',
    group: 'advanced',
  },
  {
    key: 'memory.vector.maxChars',
    label: '向量记忆注入上限（字）',
    description: '向量检索结果最多拼多少字进提示词',
    defaultValue: 1200,
    options: [800, 1200, 2000],
    cost: '越大越完整，也越贵',
    group: 'advanced',
  },
  {
    key: 'memory.maxRecords',
    label: '记忆条数上限',
    description: '衰减卡最多留多少条，超了就把最不重要的挪走（全量卡里仍在）',
    defaultValue: 600,
    options: [200, 600, 1500],
    cost: '太少会忘得快；太多会拖慢检索、也让提示词更难选中',
    group: 'advanced',
  },
  {
    key: 'memory.dedupeDays',
    label: '重复判定的时间窗（天）',
    description: '同一个人重复说同一句话，多少天内算"已经记过"',
    defaultValue: 2,
    options: [1, 2, 7],
    cost: '窗口太长：重复的真心话只记一次；太短：刷屏似的重复会堆满记忆',
    group: 'advanced',
  },
  {
    key: 'memory.initialDays',
    label: '「最初」的时间窗（天）',
    description: '多久以内的记录才可能被标成"最初"',
    defaultValue: 30,
    options: [7, 30, 90],
    cost: '窗口越大，"最初"越可能落在平淡的事上',
    group: 'experiment',
  },
]);

/** 把设置值翻译成 memory.configure() 能直接吃的参数 */
export function limitsFromSettings(values = {}) {
  const out = {};
  const max = Number(values['memory.maxRecords']);
  if (Number.isFinite(max) && max > 0) out.maxRecords = max;
  const days = Number(values['memory.dedupeDays']);
  if (Number.isFinite(days) && days > 0) out.dedupeWindowMs = days * 24 * 60 * 60 * 1000;
  const initDays = Number(values['memory.initialDays']);
  if (Number.isFinite(initDays) && initDays > 0) out.initialWindowDays = initDays;
  return out;
}
