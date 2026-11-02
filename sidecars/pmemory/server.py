#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""p-memory HTTP sidecar for surfcore.

为什么存在：p-memory 的存储/索引/检索全在 Rust 扩展（PyO3）里，Node 进程调不动，
所以用 Python 起一个只监听回环地址的 HTTP 服务包一层，给 `src/pmemory-client.js` 用。

契约见同目录 API.md（不要改它）。依赖只有标准库 + p_memory。
"""

from __future__ import annotations

import argparse
import json
import math
import os
import signal
import sqlite3
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import p_memory

ENGINE = "p-memory"
ENGINE_VERSION = getattr(p_memory, "__version__", "unknown")
LOG_PREFIX = "[pmemory]"

DEFAULT_NAMESPACE = "default"
DEFAULT_SCOPE = "public"
BASE_SCOPES = ("public",)

MAX_TAGS = 20
MAX_TAG_CHARS = 32
DEFAULT_IMPORTANCE = 50

DEFAULT_RECALL_LIMIT = 8
MAX_RECALL_LIMIT = 30

DEFAULT_OVERVIEW_CHARS = 2200
MIN_OVERVIEW_CHARS = 200
MAX_OVERVIEW_CHARS = 10000
OVERVIEW_MAX_RECORDS = 40
OVERVIEW_FETCH_CAP = 2000

FORGET_SEARCH_LIMIT = 200
LIST_PAGE_SIZE = 200
MAX_BODY_BYTES = 8 * 1024 * 1024

# 所有对 KnowledgeBase 的调用都必须在这把锁里串行（sqlite / tantivy 单写者）。
LOCK = threading.Lock()

_QUIET = False


class SidecarError(Exception):
    """带 HTTP 状态码的可预期失败（400 / 403 / 404 ...）。"""

    def __init__(self, status: int, error: str) -> None:
        super().__init__(error)
        self.status = status
        self.error = error


def log(message: str) -> None:
    if _QUIET:
        return
    try:
        sys.stderr.write(f"{LOG_PREFIX} {message}\n")
        sys.stderr.flush()
    except Exception:  # noqa: BLE001 - 日志失败不能影响请求
        pass


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- #
# 参数归一化
# --------------------------------------------------------------------------- #

def _first(query: dict, key: str) -> str:
    values = query.get(key) or []
    return str(values[0]) if values else ""


def _namespace_value(value) -> str:
    text = str(value).strip() if value is not None else ""
    return text or DEFAULT_NAMESPACE


def _clamp_int(value, default: int, low: int, high: int) -> int:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return max(low, min(high, int(round(number))))


def _importance_of(value, default: int = DEFAULT_IMPORTANCE) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return max(1, min(100, int(round(number))))


def _normalize_tags(value) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    tags: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        tag = item.strip()[:MAX_TAG_CHARS]
        if not tag or tag in seen:
            continue
        seen.add(tag)
        tags.append(tag)
        if len(tags) >= MAX_TAGS:
            break
    return tags


def _record_importance(record: dict) -> int:
    metadata = record.get("metadata") or {}
    state = record.get("state") or {}
    raw = metadata.get("importance")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raw = state.get("strength", DEFAULT_IMPORTANCE)
    return _importance_of(raw)


def _receipt_count(receipt) -> int:
    """从 WriteReceipt 里抠出「改了几条」，抠不到就 0。"""
    value = receipt.get("value") if isinstance(receipt, dict) else receipt
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, dict):
        for key in ("deleted", "decayed", "changed", "updated", "count"):
            item = value.get(key)
            if isinstance(item, bool) or not isinstance(item, int):
                continue
            return item
    return 0


def _truncate_lines(lines: list[str], max_chars: int) -> str:
    """按整行截断：一行放不下就整行丢掉，绝不切半行。"""
    kept: list[str] = []
    used = 0
    for line in lines:
        cost = len(line) + (1 if kept else 0)
        if used + cost > max_chars:
            break
        kept.append(line)
        used += cost
    return "\n".join(kept)


def _discover_scopes(data_dir: str) -> set[str]:
    """从 p-memory 的 sqlite 里读出已存在的 scope 名。

    读路径必须显式给 scopes，而重启后进程不一定知道历史写入用过哪些 scope
    （surfcore 会写 `qq` 之类），所以启动时补一次。只读连接，失败就算了。
    """
    path = os.path.join(data_dir, "store.sqlite3")
    if not os.path.exists(path):
        return set()
    uri = "file:" + path.replace("\\", "/") + "?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=3)
    except sqlite3.Error:
        return set()
    try:
        rows = conn.execute(
            "select distinct s.text from records r join strings s on s.id = r.scope_id"
        ).fetchall()
    except sqlite3.Error:
        return set()
    finally:
        conn.close()
    scopes: set[str] = set()
    for row in rows:
        if not row:
            continue
        text = row[0]
        if isinstance(text, str) and text.strip() and text == text.strip():
            scopes.add(text)
    return scopes


# --------------------------------------------------------------------------- #
# 引擎：把 HTTP 请求翻译成 p-memory 调用
# --------------------------------------------------------------------------- #

class Engine:
    def __init__(self, data_dir: str) -> None:
        self.data_dir = os.path.abspath(data_dir)
        os.makedirs(self.data_dir, exist_ok=True)
        self.scopes: set[str] = set(BASE_SCOPES)
        self.scopes |= _discover_scopes(self.data_dir)
        self.kb = p_memory.KnowledgeBase(
            self.data_dir,
            namespace=DEFAULT_NAMESPACE,
            scopes=tuple(sorted(self.scopes)),
            write_scope=DEFAULT_SCOPE,
        )

    # -- 内部工具 ---------------------------------------------------------- #

    def _read_scopes(self) -> list[str]:
        """把当前已知 scope 同步到 KB 实例，再返回给 filter 用。"""
        scopes = sorted(self.scopes) or [DEFAULT_SCOPE]
        self.kb.scopes = tuple(scopes)
        return scopes

    def _remember_scope(self, scope: str) -> None:
        if scope and scope not in self.scopes:
            self.scopes.add(scope)
            self.kb.scopes = tuple(sorted(self.scopes))

    def _search_memories(self, query: str, namespace: str, scopes: list[str], limit: int):
        """在若干 scope 上检索，返回 (hits, degraded)。

        为什么不是一次 `kb.search(..., filter={"scopes": scopes})`：p-memory 0.3.4 的
        多 scope 检索有个坑——请求里的 scope 只要有一个在该 namespace 下没有任何记录，
        整次检索就回空（实测：qq 有记录、public 为空时 `["public","qq"]` 一条都不给）。
        逐 scope 查再按分数合并，结果才和预期一致；scope 数量本来就很少，代价可忽略。
        """
        if not scopes:
            return [], []
        if len(scopes) == 1:
            result = self.kb.search(
                query, limit=limit, filter={"namespace": namespace, "scopes": list(scopes)}
            )
            degraded = (result.get("diagnostics") or {}).get("degraded") or []
            return list(result.get("hits") or []), [str(item) for item in degraded]

        merged: dict = {}
        degraded: list[str] = []
        for scope in scopes:
            result = self.kb.search(
                query, limit=limit, filter={"namespace": namespace, "scopes": [scope]}
            )
            for item in (result.get("diagnostics") or {}).get("degraded") or []:
                if item not in degraded:
                    degraded.append(str(item))
            for hit in result.get("hits") or []:
                record = hit.get("record") or {}
                record_id = record.get("id")
                key = record_id if record_id is not None else id(hit)
                previous = merged.get(key)
                if previous is None or float(hit.get("score") or 0.0) > float(
                    previous.get("score") or 0.0
                ):
                    merged[key] = hit
        hits = sorted(
            merged.values(),
            key=lambda item: (-float(item.get("score") or 0.0), str(item.get("record", {}).get("id"))),
        )
        return hits[:limit], degraded

    def _fetch_records(self, namespace: str, cap: int) -> list[dict]:
        items: list[dict] = []
        scopes = self._read_scopes()
        after = None
        while len(items) < cap:
            page = self.kb.memories.list(
                filter={"namespace": namespace, "scopes": scopes},
                limit=min(LIST_PAGE_SIZE, cap - len(items)),
                after=after,
            )
            batch = page.get("items") or []
            if not batch:
                break
            items.extend(batch)
            after = page.get("next_cursor")
            if not after:
                break
        return items[:cap]

    def _all_ids(self, namespace: str, cap: int = 100000) -> list[int]:
        ids: list[int] = []
        scopes = self._read_scopes()
        after = None
        while len(ids) < cap:
            page = self.kb.memories.ids(
                filter={"namespace": namespace, "scopes": scopes},
                limit=min(1000, cap - len(ids)),
                after=after,
            )
            batch = page.get("items") or []
            if not batch:
                break
            for item in batch:
                if isinstance(item, int):
                    ids.append(item)
            after = page.get("next_cursor")
            if not after:
                break
        return ids[:cap]

    def _namespace_total(self, namespace: str, fallback: int) -> int:
        try:
            for entry in self.kb.namespaces():
                if str(entry.get("namespace")) == namespace:
                    records = entry.get("records")
                    if isinstance(records, int) and not isinstance(records, bool):
                        return records
        except Exception:  # noqa: BLE001 - 统计失败退回列表长度
            pass
        return fallback

    @staticmethod
    def _memory_fields(raw, namespace: str):
        """把一条请求记录翻成 upsert_by_judgment 的字段；text 为空返回 None。"""
        if not isinstance(raw, dict):
            return None
        text = raw.get("text")
        if not isinstance(text, str) or not text.strip():
            return None

        importance = _importance_of(raw.get("importance"))
        scope = str(raw.get("scope") or "").strip() or DEFAULT_SCOPE

        created_at = raw.get("createdAt")
        created_at_us = 0
        if isinstance(created_at, (int, float)) and not isinstance(created_at, bool):
            if math.isfinite(float(created_at)) and created_at > 0:
                created_at_us = int(round(float(created_at) * 1000))
        if created_at_us <= 0:
            created_at_us = time.time_ns() // 1000

        metadata = {"importance": importance}
        key = raw.get("key")
        if isinstance(key, str) and key.strip():
            metadata["key"] = key.strip()
        surfcore_id = raw.get("surfcoreId")
        if isinstance(surfcore_id, str) and surfcore_id.strip():
            metadata["surfcore_id"] = surfcore_id.strip()

        fields = {
            "judgment": text,
            "namespace": namespace,
            "scope": scope,
            "state": {"strength": importance},
            "metadata": metadata,
            "created_at_us": created_at_us,
        }
        reasoning = raw.get("reasoning")
        if isinstance(reasoning, str) and reasoning.strip():
            fields["reasoning"] = reasoning
        memory_type = raw.get("type")
        if isinstance(memory_type, str) and memory_type.strip():
            fields["memory_type"] = memory_type.strip()
        tags = _normalize_tags(raw.get("tags"))
        if tags:
            fields["tags"] = tags
        return fields

    # -- 端点 -------------------------------------------------------------- #

    def health(self) -> dict:
        with LOCK:
            try:
                counts = self.kb.counts()
                total = counts.get("total", 0)
            except Exception:  # noqa: BLE001
                total = 0
            try:
                schema_version = self.kb.health().get("schema_version")
            except Exception:  # noqa: BLE001
                schema_version = None
            try:
                namespaces = [
                    str(item.get("namespace"))
                    for item in self.kb.namespaces()
                    if isinstance(item, dict) and item.get("namespace")
                ]
            except Exception:  # noqa: BLE001 - 契约：出错则 []
                namespaces = []
            return {
                "ok": True,
                "engine": ENGINE,
                "engineVersion": ENGINE_VERSION,
                "schemaVersion": schema_version,
                "total": total,
                "namespaces": namespaces,
                "dataDir": self.data_dir,
            }

    def consume(self, namespace: str, records: list) -> dict:
        with LOCK:
            upserted = 0
            skipped = 0
            for raw in records:
                fields = self._memory_fields(raw, namespace)
                if fields is None:
                    skipped += 1
                    continue
                self._remember_scope(fields["scope"])
                self.kb.memories.upsert_by_judgment(**fields)
                upserted += 1
            self.kb.update_index()
            total = self.kb.counts().get("total", 0)
            return {"ok": True, "upserted": upserted, "skipped": skipped, "total": total}

    def recall(self, query: str, namespace: str, limit: int, scope: str | None) -> dict:
        started = time.perf_counter()
        q = (query or "").strip()
        if not q:
            return {"ok": True, "query": "", "tookMs": 0, "degraded": [], "hits": []}
        with LOCK:
            scopes = [scope] if scope else self._read_scopes()
            raw_hits, degraded = self._search_memories(q, namespace, scopes, limit)
            hits = [self._hit_to_json(hit) for hit in raw_hits]
        took_ms = int(round((time.perf_counter() - started) * 1000))
        return {
            "ok": True,
            "query": q,
            "tookMs": took_ms,
            "degraded": degraded,
            "hits": hits,
        }

    @staticmethod
    def _hit_to_json(hit: dict) -> dict:
        record = hit.get("record") or {}
        score = hit.get("score")
        try:
            score = round(float(score), 6) if score is not None else 0.0
        except (TypeError, ValueError):
            score = 0.0
        created_at_us = record.get("created_at_us")
        if not isinstance(created_at_us, int) or isinstance(created_at_us, bool):
            created_at_us = 0
        tags = record.get("tags")
        return {
            "id": record.get("id"),
            "text": str(record.get("judgment") or ""),
            "reasoning": str(record.get("reasoning") or ""),
            "type": str(record.get("memory_type") or ""),
            "tags": [str(tag) for tag in tags] if isinstance(tags, list) else [],
            "importance": _record_importance(record),
            "score": score,
            "createdAt": created_at_us // 1000,
        }

    def overview(self, namespace: str, max_chars: int) -> dict:
        with LOCK:
            records = self._fetch_records(namespace, OVERVIEW_FETCH_CAP)
            if not records:
                return {"ok": True, "text": "", "count": 0}
            total = self._namespace_total(namespace, len(records))
            ordered = sorted(
                records,
                key=lambda rec: (
                    0 if (rec.get("state") or {}).get("pinned") else 1,
                    -_record_importance(rec),
                    -int(rec.get("created_at_us") or 0),
                ),
            )[:OVERVIEW_MAX_RECORDS]
            lines = ["【长期记忆 · 全量库（p-memory）】"]
            for record in ordered:
                importance = _record_importance(record)
                memory_type = str(record.get("memory_type") or "memory")
                text = str(record.get("judgment") or "").strip()
                lines.append(f"· {text}（{memory_type}，重要度 {importance}）")
            lines.append(f"（共 {total} 条，此处仅列 {len(ordered)} 条）")
            text = _truncate_lines(lines, max_chars)
        return {"ok": True, "text": text, "count": total}

    def forget(self, namespace: str, ids=None, q=None) -> dict:
        with LOCK:
            targets: list[int] = []
            if ids:
                if not isinstance(ids, list):
                    raise SidecarError(400, "ids must be a list")
                for value in ids:
                    if isinstance(value, bool):
                        continue
                    try:
                        targets.append(int(value))
                    except (TypeError, ValueError):
                        continue
                if not targets:
                    raise SidecarError(400, "ids invalid")
            elif isinstance(q, str) and q.strip():
                hits, _ = self._search_memories(
                    q.strip(), namespace, self._read_scopes(), FORGET_SEARCH_LIMIT
                )
                for hit in hits:
                    record = hit.get("record") or {}
                    record_id = record.get("id")
                    if isinstance(record_id, int) and not isinstance(record_id, bool):
                        targets.append(record_id)
            else:
                raise SidecarError(400, "ids or q required")

            deleted = 0
            if targets:
                receipt = self.kb.memories.delete(targets)
                deleted = _receipt_count(receipt)
            self.kb.update_index()
            return {"ok": True, "deleted": deleted}

    def decay(self, namespace: str) -> dict:
        with LOCK:
            receipt = self.kb.memories.decay(
                filter={"namespace": namespace, "scopes": self._read_scopes()}
            )
            changed = _receipt_count(receipt)
            self.kb.update_index()
        return {"ok": True, "changed": changed}

    def reset(self, namespace: str) -> dict:
        with LOCK:
            ids = self._all_ids(namespace)
            deleted = 0
            if ids:
                receipt = self.kb.memories.delete(ids)
                deleted = _receipt_count(receipt)
            self.kb.update_index()
            return {"ok": True, "deleted": deleted}

    def close(self) -> None:
        with LOCK:
            self.kb.close()


# --------------------------------------------------------------------------- #
# HTTP 层
# --------------------------------------------------------------------------- #

class PmemoryHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "pmemory-sidecar"
    sys_version = ""
    timeout = 60

    # BaseHTTPRequestHandler 的默认 stderr 日志太吵，自己打一行结构化日志。
    def log_message(self, format, *args) -> None:  # noqa: A002 - 覆盖父类签名
        return

    def do_GET(self) -> None:  # noqa: N802 - 父类命名
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    # -- 分发 -------------------------------------------------------------- #

    def _dispatch(self, method: str) -> None:
        started = time.perf_counter()
        path = self.path.split("?", 1)[0]
        detail = ""
        status = 500
        try:
            parsed = urlparse(self.path)
            route = parsed.path.rstrip("/") or "/"
            query = parse_qs(parsed.query, keep_blank_values=True)
            body = self._read_body() if method == "POST" else None
            token = self.server.token
            if token and self.headers.get("x-pmemory-token", "") != token:
                status, payload, detail = 401, {"ok": False, "error": "unauthorized"}, "unauthorized"
            else:
                status, payload, detail = self._route(method, route, query, body)
        except SidecarError as exc:
            status = exc.status
            payload = {"ok": False, "error": exc.error}
            detail = f"error={exc.error}"
        except Exception as exc:  # noqa: BLE001 - handler 里任何异常都不能让进程崩掉
            status = 500
            payload = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
            detail = f"error={type(exc).__name__}"
        self._write_json(status, payload)
        elapsed_ms = int(round((time.perf_counter() - started) * 1000))
        suffix = f" {detail}" if detail else ""
        log(f"{utc_stamp()} {method} {path}{suffix} {elapsed_ms}ms")

    def _route(self, method: str, route: str, query: dict, body) -> tuple:
        engine = self.server.engine

        if method == "GET" and route == "/health":
            data = engine.health()
            return 200, data, f"total={data.get('total', 0)}"

        if method == "GET" and route == "/recall":
            q = _first(query, "q")
            namespace = _namespace_value(_first(query, "namespace"))
            limit = _clamp_int(
                _first(query, "limit"), DEFAULT_RECALL_LIMIT, 1, MAX_RECALL_LIMIT
            )
            scope = _first(query, "scope").strip() or None
            data = engine.recall(q, namespace, limit, scope)
            return 200, data, f"q={q.strip()} ns={namespace} hits={len(data['hits'])}"

        if method == "GET" and route == "/overview":
            namespace = _namespace_value(_first(query, "namespace"))
            max_chars = _clamp_int(
                _first(query, "maxChars"),
                DEFAULT_OVERVIEW_CHARS,
                MIN_OVERVIEW_CHARS,
                MAX_OVERVIEW_CHARS,
            )
            data = engine.overview(namespace, max_chars)
            return 200, data, f"ns={namespace} count={data['count']}"

        if method == "POST" and route == "/consume":
            body = body or {}
            namespace = _namespace_value(body.get("namespace"))
            records = body.get("records")
            if records is None:
                raise SidecarError(400, "records required")
            if not isinstance(records, list):
                raise SidecarError(400, "records must be a list")
            data = engine.consume(namespace, records)
            return (
                200,
                data,
                f"ns={namespace} upserted={data['upserted']} "
                f"skipped={data['skipped']} total={data['total']}",
            )

        if method == "POST" and route == "/forget":
            body = body or {}
            namespace = _namespace_value(body.get("namespace"))
            data = engine.forget(namespace, ids=body.get("ids"), q=body.get("q"))
            return 200, data, f"ns={namespace} deleted={data['deleted']}"

        if method == "POST" and route == "/decay":
            body = body or {}
            namespace = _namespace_value(body.get("namespace"))
            data = engine.decay(namespace)
            return 200, data, f"ns={namespace} changed={data['changed']}"

        if method == "POST" and route == "/reset":
            if not self.server.allow_reset:
                raise SidecarError(403, "reset disabled")
            body = body or {}
            namespace = _namespace_value(body.get("namespace"))
            data = engine.reset(namespace)
            return 200, data, f"ns={namespace} deleted={data['deleted']}"

        raise SidecarError(404, "not found")

    # -- IO ---------------------------------------------------------------- #

    def _read_body(self) -> dict:
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length) if raw_length is not None else 0
        except (TypeError, ValueError):
            raise SidecarError(400, "invalid content-length")
        if length < 0 or length > MAX_BODY_BYTES:
            raise SidecarError(400, "body too large")
        data = self.rfile.read(length) if length > 0 else b""
        if not data.strip():
            return {}
        try:
            value = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise SidecarError(400, f"invalid json body: {exc}")
        if not isinstance(value, dict):
            raise SidecarError(400, "json body must be an object")
        return value

    def _write_json(self, status: int, payload: dict) -> None:
        try:
            raw = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (TypeError, ValueError):
            status = 500
            raw = json.dumps(
                {"ok": False, "error": "response serialization failed"}, ensure_ascii=False
            ).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(raw)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            # 客户端提前断线：安静收场，进程继续跑。
            self.close_connection = True


class PmemoryHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, engine, token: str, allow_reset: bool) -> None:
        self.engine = engine
        self.token = token
        self.allow_reset = allow_reset
        super().__init__(address, PmemoryHandler)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _configure_stdio() -> None:
    """重定向到文件/管道时把 stdio 统一成 UTF-8。

    Windows 控制台默认是 cp936，同一份日志在终端里正常、被父进程按 UTF-8 读时
    却会乱码。tty 保持控制台编码，只改非 tty 的那一支。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            if stream is None or stream.isatty():
                continue
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except Exception:  # noqa: BLE001 - 老解释器/被包装的流不支持就算了
            pass


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="p-memory HTTP sidecar for surfcore (server should stay on loopback)"
    )
    parser.add_argument("--data-dir", required=True, help="p-memory data directory")
    parser.add_argument("--port", type=int, default=8791, help="listen port (0 = ephemeral)")
    parser.add_argument("--host", default="127.0.0.1", help="listen host (loopback only)")
    parser.add_argument(
        "--token",
        default=None,
        help="require x-pmemory-token header (defaults to $PMEMORY_TOKEN)",
    )
    parser.add_argument("--allow-reset", action="store_true", help="enable POST /reset")
    parser.add_argument("--quiet", action="store_true", help="suppress per-request logs")
    return parser


def _announce(host: str, port: int, data_dir: str, ephemeral: bool) -> None:
    line = (
        f"{LOG_PREFIX} listening http://{host}:{port} "
        f"data={data_dir} engine={ENGINE} {ENGINE_VERSION}"
    )
    try:
        sys.stderr.write(line + "\n")
        sys.stderr.flush()
    except Exception:  # noqa: BLE001
        pass
    if ephemeral:
        # --port 0 时给测试一个稳定可解析的 stdout 提示（契约只要求 stderr 日志）。
        try:
            sys.stdout.write(f"{LOG_PREFIX} port {port}\n")
            sys.stdout.flush()
        except Exception:  # noqa: BLE001
            pass


def main(argv=None) -> int:
    global _QUIET

    _configure_stdio()
    parser = _build_parser()
    args = parser.parse_args(argv)
    _QUIET = bool(args.quiet)

    if args.host not in ("127.0.0.1", "localhost"):
        parser.error("refusing non-loopback host (use 127.0.0.1); 0.0.0.0 is forbidden")

    token = args.token
    if token is None:
        token = os.environ.get("PMEMORY_TOKEN", "")
    token = (token or "").strip()

    try:
        engine = Engine(args.data_dir)
    except Exception as exc:  # noqa: BLE001 - 打不开库就别装作起来了
        sys.stderr.write(f"{LOG_PREFIX} failed to open data dir {args.data_dir}: {exc}\n")
        return 2

    try:
        httpd = PmemoryHttpServer(
            (args.host, args.port), engine, token=token, allow_reset=bool(args.allow_reset)
        )
    except OSError as exc:
        sys.stderr.write(f"{LOG_PREFIX} failed to bind {args.host}:{args.port}: {exc}\n")
        try:
            engine.close()
        except Exception:  # noqa: BLE001
            pass
        return 2

    actual_port = httpd.server_address[1]
    stop = threading.Event()

    def _handle_signal(signum, frame) -> None:  # noqa: ARG001
        stop.set()

    # Windows 下 Ctrl+Break / 服务停止走 SIGBREAK；和 SIGINT/SIGTERM 共用同一条
    # 收尾路径（关 serve_forever → close engine）。注意 CREATE_NEW_PROCESS_GROUP
    # 创建的子进程默认收不到 CTRL+C，所以集成测试用 CTRL_BREAK 验证这条路径。
    stop_signals = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, "SIGBREAK"):
        stop_signals.append(signal.SIGBREAK)
    for sig in stop_signals:
        try:
            signal.signal(sig, _handle_signal)
        except (ValueError, OSError):  # 非主线程/平台不支持时就退化
            pass

    worker = threading.Thread(target=httpd.serve_forever, name="pmemory-http", daemon=True)
    worker.start()
    _announce(args.host, actual_port, engine.data_dir, ephemeral=args.port == 0)

    try:
        while not stop.is_set():
            stop.wait(0.5)
    except KeyboardInterrupt:
        stop.set()

    httpd.shutdown()
    worker.join(timeout=5)
    httpd.server_close()
    try:
        engine.close()
    except Exception:  # noqa: BLE001
        pass
    log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
