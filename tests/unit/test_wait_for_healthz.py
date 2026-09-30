"""CI readiness must fail closed when /healthz never answers."""

from __future__ import annotations

import importlib.util
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts" / "wait_for_healthz.py"


def _load():
    spec = importlib.util.spec_from_file_location("wait_for_healthz", HELPER)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def wait_mod():
    if not HELPER.is_file():
        pytest.fail(
            "scripts/wait_for_healthz.py missing — readiness gate has no fail-closed helper"
        )
    return _load()


def test_wait_for_healthz_returns_true_when_service_answers(wait_mod):
    class Ok(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, format, *args):  # noqa: A003
            return

    server = HTTPServer(("127.0.0.1", 0), Ok)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        assert wait_mod.wait_for_healthz(f"http://127.0.0.1:{port}/healthz", timeout=5.0)
        assert wait_mod.main([f"http://127.0.0.1:{port}/healthz", "--timeout", "5"]) == 0
    finally:
        server.shutdown()


def test_wait_for_healthz_fails_closed_when_nothing_listens(wait_mod):
    # High unused port; nothing bound. Must not return success.
    url = "http://127.0.0.1:9/healthz"
    assert wait_mod.wait_for_healthz(url, timeout=0.4, interval=0.1) is False
    assert wait_mod.main([url, "--timeout", "0.4", "--interval", "0.1"]) == 1
