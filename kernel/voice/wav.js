/**
 * WAV 头解析：从字节算时长（不依赖 ffprobe）
 * ============================================================================
 * 位置：内核 voice 的纯数据工具。旧代码 voice-tts.js 的 wavDurationMs 搬过来，
 * 只认 WAV 头；坏文件返回 0，绝不抛。
 */

export function wavDurationMs(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return 0;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return 0;
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buffer.length) {
    const id = buffer.toString('ascii', off, off + 4);
    const size = buffer.readUInt32LE(off + 4);
    if (id === 'fmt ' && off + 20 <= buffer.length) byteRate = buffer.readUInt32LE(off + 16);
    if (id === 'data') {
      if (!byteRate || !size) return 0;
      return Math.round((size / byteRate) * 1000);
    }
    off += 8 + size + (size % 2);
  }
  return 0;
}
