// 兼容旧导入路径：真正实现已迁到独立 host-only 包 `qq-mode/`。
// 这里只是 re-export，不再作为 Loader 行直接挂载（见 cordis.patch.yml）。
export { name, inject, Config, apply } from '../qq-mode/index.js';
