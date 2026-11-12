/**
 * 语音模型入口（内核 voice 的公共面）
 * ============================================================================
 * 对外只暴露模型语义：modelId / kind(local|cloud) / voiceId / label / state。
 * 不暴露目录、启动脚本、端口、spawn；这些是模型运行时的内部实现。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createModelRuntime, readModelConfig, upsertModelRecord, selectModel, relinkModel } from './model-runtime.js';
import { importModelArtifact } from './model-store.js';
import {
  listVoiceProviders, upsertVoiceProvider, removeVoiceProvider, resolveVoiceProvider, applyCloudProviderConfig,
} from './provider-config.js';
import { createHttpVoiceTransport } from './tts-http.js';

const DEFAULT_FILE = path.join('state', 'voice-models.json');
const DEFAULT_PROVIDERS = path.join('state', 'voice-providers.json');

function publicModel(model, state) {
  return {
    modelId: model.id,
    kind: model.kind,
    voiceId: model.voiceId,
    label: model.label,
    state,
    available: state === 'loaded',
  };
}

function deleteImportedZip(sourceDir) {
  const source = path.resolve(String(sourceDir ?? ''));
  if (!/\.zip$/i.test(source)) return { sourceDeleted: false, sourceDeleteError: '只删除 .zip 源文件' };
  try {
    const st = fs.statSync(source);
    if (!st.isFile()) return { sourceDeleted: false, sourceDeleteError: '源路径不是文件' };
    fs.unlinkSync(source);
    return { sourceDeleted: true };
  } catch (error) {
    return { sourceDeleted: false, sourceDeleteError: `删除源 zip 失败：${error?.message ?? error}` };
  }
}

export function createVoiceModels({ configFile = DEFAULT_FILE, providersFile = DEFAULT_PROVIDERS, runtime = null } = {}) {
  const file = configFile;
  const providers = providersFile;
  const rt = runtime ?? createModelRuntime({ file });

  return {
    async status() {
      const st = await rt.status();
      const providersList = listVoiceProviders({ file: providers });
      return { ok: st.ok, active: st.active ?? '', models: st.ok ? st.models : [], providers: providersList };
    },

    list() {
      const cfg = readModelConfig(file);
      if (!cfg.ok) return cfg;
      return { ok: true, models: Object.values(cfg.models).map((m) => publicModel(m, 'idle')) };
    },

    async load(modelId) {
      return rt.load(modelId);
    },

    async unload(modelId) {
      return rt.unload(modelId);
    },

    select(modelId) {
      return selectModel({ file, modelId });
    },

    relink(modelId, dir) {
      return relinkModel({ file, modelId, dir });
    },

    async probe(modelId, text = '你好。') {
      const cfg = readModelConfig(file);
      if (!cfg.ok) return cfg;
      const model = cfg.models[String(modelId ?? '')];
      if (!model) return { ok: false, code: 'voice-model.unknown', error: `没有这个模型：${modelId}` };
      // 试合成必须绕过服务端缓存：同一文本改了音色/配置后也要听见新声音。
      if (model.kind === 'cloud') {
        const provider = resolveVoiceProvider({ file: providers, id: model.id });
        if (provider?.endpoint) {
          return createHttpVoiceTransport({
            endpoint: provider.endpoint,
            apiKey: provider.apiKey ?? '',
            path: provider.path,
            bodyTemplate: { ...(provider.bodyTemplate ?? {}), cache: false },
          }).synthesize({ text, voiceId: provider.voiceId || model.voiceId });
        }
      }
      return rt.synthesize({ modelId, text, noCache: true });
    },

    async importModel({ sourceDir, targetDir, force = false, deleteSource = false, model = {} } = {}) {
      if (!sourceDir || !targetDir) return { ok: false, code: 'voice-model.import-args', error: '需要 sourceDir 和 targetDir' };
      const imported = importModelArtifact({ dir: sourceDir, target: targetDir, force });
      if (!imported.ok) return imported;
      const saved = upsertModelRecord({
        file,
        model: {
          id: model.id ?? imported.model,
          kind: model.kind,
          voiceId: model.voiceId ?? imported.voiceId,
          label: model.label,
          artifactDir: targetDir,
          runtime: imported.runtime ?? { endpoint: model.endpoint ?? '' },
        },
      });
      if (!saved.ok) return saved;
      const out = { ok: true, model: publicModel(saved.model, 'idle') };
      if (deleteSource === true) {
        const deleted = deleteImportedZip(sourceDir);
        out.sourceDeleted = deleted.sourceDeleted;
        if (!deleted.sourceDeleted) out.sourceDeleteError = deleted.sourceDeleteError;
      }
      return out;
    },

    listProviders() {
      return { ok: true, providers: listVoiceProviders({ file: providers }) };
    },

    setProvider(provider) {
      const out = upsertVoiceProvider({ file: providers, provider });
      if (!out.ok) return out;
      const { raw, ...pub } = out;
      const cfg = readModelConfig(file);
      if (raw?.kind === 'cloud' && cfg.ok) {
        const norm = (s) => String(s ?? '').toLowerCase().replace(/^voice[-_]/, '');
        const model = Object.values(cfg.models).find((m) => norm(m.id) === norm(raw.id) || norm(m.id) === norm(raw.voiceId));
        if (!model?.artifactDir) {
          return { ...pub, applied: false, applyError: '还没导入云端模型；配置已保存，导入/重新定位后再应用' };
        }
        const applied = applyCloudProviderConfig({ artifactDir: model.artifactDir, provider: raw, voiceId: model.voiceId || raw.voiceId });
        if (!applied.ok) return { ...pub, applied: false, applyError: applied.error, applyCode: applied.code };
        return { ...pub, applied: true, configToml: applied.configFile, voiceJson: applied.voiceFile };
      }
      return pub;
    },

    removeProvider(id) {
      return removeVoiceProvider({ file: providers, id });
    },

    async synthesize({ modelId, text = '', voiceId = '' } = {}) {
      const cfg = readModelConfig(file);
      if (!cfg.ok) return cfg;
      const model = cfg.models[String(modelId ?? '')];
      if (!model) return { ok: false, code: 'voice-model.unknown', error: `没有这个模型：${modelId}` };
      if (model.kind === 'cloud') {
        const provider = resolveVoiceProvider({ file: providers, id: model.id });
        if (provider?.endpoint) {
          return createHttpVoiceTransport({
            endpoint: provider.endpoint,
            apiKey: provider.apiKey ?? '',
            path: provider.path,
            bodyTemplate: provider.bodyTemplate,
          }).synthesize({ text, voiceId: voiceId || provider.voiceId || model.voiceId });
        }
      }
      return rt.synthesize({ modelId, text, voiceId });
    },
  };
}
