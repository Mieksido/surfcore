// 群里的「#sl」这类短指令：只拦非主人、非 @/引用的纯指令，避免模型被刷屏指令带着走。
// 不拦普通话题标签（#B站#）或中文标签；只认 # + ASCII 命令词，可带尾随文本。
const COMMAND_RE = /^[#＃][A-Za-z0-9_]{1,24}(?:[\s，。！？,.!?].{0,80})?$/u

export function isSpamCommandText(text) {
  const s = String(text ?? '').trim();
  if (!s) return false;
  return COMMAND_RE.test(s);
}
