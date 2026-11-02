#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""p-memory sidecar 的黑盒测试（只用标准库）。

每个用例都真的起一个 server.py 子进程、真的走 HTTP，端口用 `--port 0` 由服务自己报。

跑法：
    python -X utf8 -m unittest -v test_server.py
"""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from urllib.parse import urlencode

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "server.py")
PYTHON = sys.executable
START_TIMEOUT = 120.0
TOKEN = "test-token-7f3a9c"

RECORD_HUG = {
    "text": "主人深夜会讨抱紧，我收紧手臂把她圈进怀里",
    "reasoning": "深夜私聊，情绪疲惫",
    "type": "bond",
    "importance": 82,
    "tags": ["主人", "抱抱"],
    "scope": "qq",
    "key": "private:2533801935",
    "surfcoreId": "mem-hug-001",
    "createdAt": 1793280860206,
}

RECORD_MISS = {
    "text": "主人今天说想我了，我把这句话收好",
    "reasoning": "白天私聊",
    "type": "bond",
    "importance": 61,
    "tags": ["主人"],
    "scope": "qq",
    "key": "private:2533801935",
    "createdAt": 1793280861206,
}


class Sidecar:
    """一个真实跑着的 sidecar 子进程。"""

    def __init__(self, extra_args=(), data_dir=None, new_process_group=False):
        self._owns_data_dir = data_dir is None
        self.data_dir = data_dir or tempfile.mkdtemp(prefix="pmemory-sidecar-test-")
        self._queue: queue.Queue = queue.Queue()
        self._lines: list[tuple[str, str]] = []
        self._log_lock = threading.Lock()
        flags = 0
        if new_process_group:
            # 只为了让测试能给子进程单独发 CTRL_BREAK 而不误伤跑测试的自己；
            # 注意该 flag 同时让新进程组默认收不到 CTRL+C，所以这里验证的是
            # 同一条收尾路径上的 CTRL_BREAK。
            flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        self.proc = subprocess.Popen(
            [
                PYTHON,
                "-X",
                "utf8",
                SERVER,
                "--data-dir",
                self.data_dir,
                "--port",
                "0",
                *extra_args,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=flags,
        )
        self.port = None
        threading.Thread(
            target=self._pump, args=("stdout", self.proc.stdout), daemon=True
        ).start()
        threading.Thread(
            target=self._pump, args=("stderr", self.proc.stderr), daemon=True
        ).start()
        deadline = time.time() + START_TIMEOUT
        while time.time() < deadline:
            remaining = max(0.1, deadline - time.time())
            try:
                stream, line = self._queue.get(timeout=remaining)
            except queue.Empty:
                break
            match = re.search(r"port\s+(\d+)", line)
            if stream == "stdout" and match:
                self.port = int(match.group(1))
                break
            if self.proc.poll() is not None:
                break
        if self.port is None:
            self.stop()
            raise RuntimeError(f"sidecar did not report a port; logs:\n{self.stderr_text()}")

    def _pump(self, name, stream):
        try:
            for line in stream:
                text = line.rstrip("\r\n")
                with self._log_lock:
                    self._lines.append((name, text))
                self._queue.put((name, text))
        except Exception:  # noqa: BLE001 - 进程退出时管道关闭
            return

    def stderr_text(self) -> str:
        with self._log_lock:
            return "\n".join(text for name, text in self._lines if name == "stderr")

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def request(self, method, path, body=None, headers=None, timeout=30):
        data = (
            json.dumps(body, ensure_ascii=False).encode("utf-8")
            if body is not None
            else None
        )
        head = {"Content-Type": "application/json; charset=utf-8"}
        if headers:
            head.update(headers)
        req = urllib.request.Request(self.url(path), data=data, method=method, headers=head)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def stop(self):
        proc = getattr(self, "proc", None)
        if proc is None:
            return
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=10)
        for stream in (proc.stdout, proc.stderr):
            try:
                if stream is not None:
                    stream.close()
            except Exception:  # noqa: BLE001
                pass
        self.proc = None
        if self._owns_data_dir:
            shutil.rmtree(self.data_dir, ignore_errors=True)


class SidecarTest(unittest.TestCase):
    extra_args: tuple = ()

    @classmethod
    def setUpClass(cls):
        cls.sidecar = Sidecar(cls.extra_args)

    @classmethod
    def tearDownClass(cls):
        cls.sidecar.stop()

    def setUp(self):
        self.s = self.sidecar

    # -- helpers ----------------------------------------------------------- #

    def seed(self, namespace: str):
        status, data = self.s.request(
            "POST",
            "/consume",
            {"namespace": namespace, "records": [RECORD_HUG, RECORD_MISS]},
        )
        self.assertEqual(status, 200, data)
        self.assertTrue(data.get("ok"), data)
        self.assertEqual(data.get("upserted"), 2, data)
        self.assertEqual(data.get("skipped"), 0, data)

    def recall(self, namespace: str, query: str, extra=None):
        params = {"q": query, "namespace": namespace}
        if extra:
            params.update(extra)
        return self.s.request("GET", "/recall?" + urlencode(params))

    def overview(self, namespace: str, max_chars=None):
        params = {"namespace": namespace}
        if max_chars is not None:
            params["maxChars"] = str(max_chars)
        return self.s.request("GET", "/overview?" + urlencode(params))


class TestMainApi(SidecarTest):
    def test_01_health(self):
        status, data = self.s.request("GET", "/health")
        self.assertEqual(status, 200, data)
        self.assertTrue(data.get("ok"), data)
        self.assertEqual(data.get("engine"), "p-memory")
        self.assertEqual(data.get("engineVersion"), "0.3.4")
        self.assertIsInstance(data.get("schemaVersion"), int)
        self.assertIsInstance(data.get("total"), int)
        self.assertIsInstance(data.get("namespaces"), list)
        self.assertEqual(data.get("dataDir"), os.path.abspath(self.s.data_dir))

    def test_02_consume_is_idempotent(self):
        namespace = "idem-ns"
        status, first = self.s.request(
            "POST",
            "/consume",
            {"namespace": namespace, "records": [RECORD_HUG, RECORD_MISS]},
        )
        self.assertEqual(status, 200, first)
        self.assertEqual(first.get("upserted"), 2, first)
        self.assertEqual(first.get("skipped"), 0, first)
        total_after_first = first["total"]

        # 同文本再写一遍：仍然成功，但库里总量不增（upsert_by_judgment 去重）。
        status, second = self.s.request(
            "POST",
            "/consume",
            {"namespace": namespace, "records": [RECORD_HUG, RECORD_MISS]},
        )
        self.assertEqual(status, 200, second)
        self.assertTrue(second.get("ok"), second)
        self.assertEqual(second.get("upserted"), 2, second)
        self.assertEqual(second["total"], total_after_first, second)

        status, overview = self.overview(namespace)
        self.assertEqual(status, 200, overview)
        self.assertEqual(overview.get("count"), 2, overview)

        # text 为空 / 非法记录的丢到 skipped 里，不报错。
        status, skipped = self.s.request(
            "POST",
            "/consume",
            {
                "namespace": namespace,
                "records": [{"text": "   "}, {"text": 123}, "not-a-record"],
            },
        )
        self.assertEqual(status, 200, skipped)
        self.assertEqual(skipped.get("upserted"), 0, skipped)
        self.assertEqual(skipped.get("skipped"), 3, skipped)

    def test_03_recall(self):
        namespace = "recall-ns"
        self.seed(namespace)

        status, data = self.recall(namespace, "抱紧")
        self.assertEqual(status, 200, data)
        self.assertTrue(data.get("ok"), data)
        self.assertEqual(data.get("query"), "抱紧")
        self.assertEqual(len(data.get("hits")), 1, data)
        hit = data["hits"][0]
        self.assertEqual(hit.get("text"), RECORD_HUG["text"], hit)
        self.assertEqual(hit.get("type"), "bond", hit)
        self.assertEqual(hit.get("importance"), 82, hit)
        self.assertEqual(hit.get("tags"), ["主人", "抱抱"], hit)
        self.assertEqual(hit.get("reasoning"), RECORD_HUG["reasoning"], hit)
        self.assertEqual(hit.get("createdAt"), RECORD_HUG["createdAt"], hit)
        self.assertIsInstance(hit.get("id"), int)
        self.assertIn("score", hit)
        self.assertIn("degraded", data)
        self.assertIn("tookMs", data)

        # q 为空 / 只有空白：直接回空列表，不做全表 dump。
        status, empty = self.recall(namespace, "")
        self.assertEqual(status, 200, empty)
        self.assertTrue(empty.get("ok"), empty)
        self.assertEqual(empty.get("hits"), [])

        status, blank = self.recall(namespace, "   ")
        self.assertEqual(status, 200, blank)
        self.assertEqual(blank.get("hits"), [])

        # limit 会被夹在 1..30。
        status, clamped = self.recall(namespace, "主人", extra={"limit": "999"})
        self.assertEqual(status, 200, clamped)
        self.assertLessEqual(len(clamped.get("hits") or []), 2)

    def test_04_overview(self):
        namespace = "overview-ns"
        self.seed(namespace)

        status, data = self.overview(namespace)
        self.assertEqual(status, 200, data)
        self.assertTrue(data.get("ok"), data)
        self.assertEqual(data.get("count"), 2, data)
        text = data.get("text") or ""
        self.assertIn("【长期记忆 · 全量库（p-memory）】", text)
        self.assertIn(RECORD_HUG["text"], text)
        self.assertIn(RECORD_MISS["text"], text)
        self.assertIn("（共 2 条，此处仅列 2 条）", text)

        # 空 namespace 返回空文本。
        status, none = self.overview("overview-empty-ns")
        self.assertEqual(status, 200, none)
        self.assertEqual(none.get("text"), "")
        self.assertEqual(none.get("count"), 0)

        # maxChars 截断必须按整行：每一行都得原样出现在完整渲染里。
        # 契约把 maxChars 夹在 200..10000，所以 30 会被抬到 200。
        long_ns = "overview-long-ns"
        records = [
            {
                "text": f"第{i}条较长的记忆，用来验证按整行截断不会把一行切成两半",
                "reasoning": "truncation",
                "type": "bond",
                "importance": 50 + i,
                "scope": "qq",
                "createdAt": 1793280860206 + i * 1000,
            }
            for i in range(10)
        ]
        status, seeded = self.s.request(
            "POST", "/consume", {"namespace": long_ns, "records": records}
        )
        self.assertEqual(status, 200, seeded)
        self.assertEqual(seeded.get("upserted"), 10, seeded)

        status, full = self.overview(long_ns)
        self.assertEqual(status, 200, full)
        self.assertEqual(full.get("count"), 10, full)
        full_lines = full["text"].split("\n")

        status, short = self.overview(long_ns, max_chars=200)
        self.assertEqual(status, 200, short)
        short_text = short.get("text") or ""
        self.assertLessEqual(len(short_text), 200)
        self.assertLess(len(short_text), len(full["text"]))
        short_lines = short_text.split("\n")
        for line in short_lines:
            self.assertIn(line, full_lines, short_text)
        self.assertEqual(short_lines[0], "【长期记忆 · 全量库（p-memory）】")

        # maxChars=30 被夹到 200，结果与 200 完全一致。
        status, clamped_low = self.overview(long_ns, max_chars=30)
        self.assertEqual(status, 200, clamped_low)
        self.assertEqual(clamped_low.get("text"), short_text)

        # 上限夹在 10000：结果与默认渲染一致。
        status, clamped_high = self.overview(long_ns, max_chars=99999)
        self.assertEqual(status, 200, clamped_high)
        self.assertEqual(clamped_high.get("text"), full["text"])

    def test_05_forget(self):
        namespace = "forget-ns"
        self.seed(namespace)

        status, data = self.recall(namespace, "抱紧")
        self.assertEqual(status, 200, data)
        self.assertEqual(len(data["hits"]), 1, data)
        target_id = data["hits"][0]["id"]

        status, deleted = self.s.request(
            "POST", "/forget", {"namespace": namespace, "ids": [target_id]}
        )
        self.assertEqual(status, 200, deleted)
        self.assertTrue(deleted.get("ok"), deleted)
        self.assertEqual(deleted.get("deleted"), 1, deleted)

        status, gone = self.recall(namespace, "抱紧")
        self.assertEqual(status, 200, gone)
        self.assertEqual(gone.get("hits"), [])

        # q 形式：按查询词删掉剩下的那条。
        status, by_query = self.s.request(
            "POST", "/forget", {"namespace": namespace, "q": "想我"}
        )
        self.assertEqual(status, 200, by_query)
        self.assertGreaterEqual(by_query.get("deleted"), 1, by_query)
        status, empty = self.recall(namespace, "想我")
        self.assertEqual(empty.get("hits"), [])

        # 两个都没给 → 400。
        status, bad = self.s.request("POST", "/forget", {"namespace": namespace})
        self.assertEqual(status, 400, bad)
        self.assertFalse(bad.get("ok"), bad)

    def test_06_decay(self):
        namespace = "decay-ns"
        self.seed(namespace)
        status, data = self.s.request("POST", "/decay", {"namespace": namespace})
        self.assertEqual(status, 200, data)
        self.assertTrue(data.get("ok"), data)
        self.assertIsInstance(data.get("changed"), int)

    def test_07_reset_disabled_without_flag(self):
        status, data = self.s.request("POST", "/reset", {"namespace": "idem-ns"})
        self.assertEqual(status, 403, data)
        self.assertFalse(data.get("ok"), data)
        self.assertEqual(data.get("error"), "reset disabled")

    def test_08_unknown_route_and_bad_body(self):
        status, data = self.s.request("GET", "/nope")
        self.assertEqual(status, 404, data)
        self.assertFalse(data.get("ok"), data)

        status, data = self.s.request("POST", "/consume", {"namespace": "x", "records": "nope"})
        self.assertEqual(status, 400, data)
        self.assertFalse(data.get("ok"), data)

    def test_09_concurrent_recall(self):
        namespace = "conc-ns"
        self.seed(namespace)

        errors: list[str] = []
        statuses: list[int] = []
        lock = threading.Lock()

        def worker():
            for _ in range(20):
                try:
                    status, _ = self.recall(namespace, "抱紧")
                except Exception as exc:  # noqa: BLE001
                    with lock:
                        errors.append(repr(exc))
                    continue
                with lock:
                    statuses.append(status)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)

        self.assertEqual(errors, [])
        self.assertEqual(len(statuses), 160, len(statuses))
        self.assertEqual(set(statuses), {200}, set(statuses))

        # 进程没被并发打死。
        self.assertIsNone(self.s.proc.poll(), "sidecar process died under load")
        status, health = self.s.request("GET", "/health")
        self.assertEqual(status, 200, health)
        self.assertTrue(health.get("ok"), health)

    def test_10_log_format(self):
        namespace = "log-ns"
        self.seed(namespace)
        self.recall(namespace, "抱紧")
        time.sleep(0.3)
        text = self.s.stderr_text()
        self.assertIn("[pmemory] listening http://127.0.0.1:", text)
        self.assertRegex(
            text,
            r"\[pmemory\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z "
            r"GET /recall q=抱紧 ns=log-ns hits=1 \d+ms",
        )
        self.assertRegex(
            text,
            r"\[pmemory\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z "
            r"POST /consume ns=log-ns upserted=2 skipped=0 total=\d+",
        )


class TestResetEnabled(SidecarTest):
    extra_args = ("--allow-reset",)

    def test_reset_deletes_namespace(self):
        namespace = "reset-ns"
        self.seed(namespace)
        status, overview = self.overview(namespace)
        self.assertEqual(overview.get("count"), 2, overview)

        status, data = self.s.request("POST", "/reset", {"namespace": namespace})
        self.assertEqual(status, 200, data)
        self.assertTrue(data.get("ok"), data)
        self.assertEqual(data.get("deleted"), 2, data)

        status, overview = self.overview(namespace)
        self.assertEqual(status, 200, overview)
        self.assertEqual(overview.get("count"), 0, overview)
        self.assertEqual(overview.get("text"), "")

        status, recall = self.recall(namespace, "抱紧")
        self.assertEqual(recall.get("hits"), [])


class TestTokenAuth(SidecarTest):
    extra_args = ("--token", TOKEN, "--allow-reset")

    def test_missing_header_is_401(self):
        status, data = self.s.request("GET", "/health")
        self.assertEqual(status, 401, data)
        self.assertFalse(data.get("ok"), data)
        self.assertEqual(data.get("error"), "unauthorized")

        status, data = self.s.request(
            "POST", "/consume", {"namespace": "auth-ns", "records": [RECORD_HUG]}
        )
        self.assertEqual(status, 401, data)

    def test_wrong_header_is_401(self):
        status, data = self.s.request(
            "GET", "/health", headers={"x-pmemory-token": "wrong-token"}
        )
        self.assertEqual(status, 401, data)

    def test_correct_header_is_200(self):
        headers = {"x-pmemory-token": TOKEN}
        status, data = self.s.request("GET", "/health", headers=headers)
        self.assertEqual(status, 200, data)
        self.assertTrue(data.get("ok"), data)

        status, data = self.s.request(
            "POST",
            "/consume",
            {"namespace": "auth-ns", "records": [RECORD_HUG]},
            headers=headers,
        )
        self.assertEqual(status, 200, data)
        self.assertEqual(data.get("upserted"), 1, data)

        status, data = self.recall("auth-ns", "抱紧")
        self.assertEqual(status, 401, data)

        status, data = self.s.request(
            "GET", "/recall?" + urlencode({"q": "抱紧", "namespace": "auth-ns"}), headers=headers
        )
        self.assertEqual(status, 200, data)
        self.assertEqual(len(data.get("hits")), 1, data)

        # token 不能进日志。
        time.sleep(0.2)
        self.assertNotIn(TOKEN, self.s.stderr_text())


class TestRestartPersistence(unittest.TestCase):
    """重启后还得能召回：scope 不在默认列表里，靠启动时从 sqlite 补回来。"""

    def test_recall_survives_restart(self):
        data_dir = tempfile.mkdtemp(prefix="pmemory-sidecar-restart-")
        first = Sidecar(data_dir=data_dir)
        try:
            status, data = first.request(
                "POST", "/consume", {"namespace": "restart-ns", "records": [RECORD_HUG]}
            )
            self.assertEqual(status, 200, data)
            self.assertEqual(data.get("upserted"), 1, data)
            # scope=qq 已经写进库，读的时候必须能被找回来。
            status, data = first.request(
                "GET", "/recall?" + urlencode({"q": "抱紧", "namespace": "restart-ns"})
            )
            self.assertEqual(status, 200, data)
            self.assertEqual(len(data.get("hits")), 1, data)
        finally:
            first.stop()

        second = Sidecar(data_dir=data_dir)
        try:
            status, data = second.request("GET", "/health")
            self.assertEqual(status, 200, data)
            self.assertGreaterEqual(data.get("total"), 1, data)

            status, data = second.request(
                "GET", "/recall?" + urlencode({"q": "抱紧", "namespace": "restart-ns"})
            )
            self.assertEqual(status, 200, data)
            self.assertEqual(len(data.get("hits")), 1, data)
            self.assertEqual(data["hits"][0].get("text"), RECORD_HUG["text"])

            status, overview = second.request(
                "GET", "/overview?" + urlencode({"namespace": "restart-ns"})
            )
            self.assertEqual(status, 200, overview)
            self.assertIn(RECORD_HUG["text"], overview.get("text") or "")
        finally:
            second.stop()
            shutil.rmtree(data_dir, ignore_errors=True)


@unittest.skipUnless(hasattr(signal, "CTRL_BREAK_EVENT"), "Windows console signals only")
class TestGracefulShutdown(unittest.TestCase):
    """SIGINT / SIGTERM / SIGBREAK 必须走同一条收尾路径：关服务 → close 引擎 → 退出码 0。"""

    def test_ctrl_break_closes_cleanly(self):
        sidecar = Sidecar(new_process_group=True)
        try:
            status, data = sidecar.request("GET", "/health")
            self.assertEqual(status, 200, data)
            sidecar.proc.send_signal(signal.CTRL_BREAK_EVENT)
            code = sidecar.proc.wait(timeout=30)
            self.assertEqual(code, 0, sidecar.stderr_text())
            deadline = time.time() + 5
            while time.time() < deadline:
                if "stopped" in sidecar.stderr_text():
                    break
                time.sleep(0.05)
            self.assertIn("stopped", sidecar.stderr_text())
        finally:
            sidecar.stop()


if __name__ == "__main__":
    unittest.main(verbosity=2)
