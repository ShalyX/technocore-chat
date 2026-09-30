#!/usr/bin/env python3
"""Poll a health URL until it answers 2xx, or fail closed.

Used by CI readiness steps. A shell `for` loop that ends on `sleep` exits 0 when the
service never comes up; this process exits non-zero instead so the job stops at the
gate rather than later with a confusing probe/client error.
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request


def wait_for_healthz(url: str, timeout: float = 30.0, interval: float = 1.0) -> bool:
    """Return True once `url` responds with HTTP success; False if the budget expires."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=min(interval, 5.0)) as resp:
                if 200 <= getattr(resp, "status", 200) < 300:
                    return True
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(interval, remaining))
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Health check URL, e.g. http://localhost:8099/healthz")
    parser.add_argument("--timeout", type=float, default=30.0, help="Seconds to wait (default 30)")
    parser.add_argument(
        "--interval", type=float, default=1.0, help="Seconds between attempts (default 1)"
    )
    args = parser.parse_args(argv)
    if wait_for_healthz(args.url, timeout=args.timeout, interval=args.interval):
        return 0
    print(f"error: service did not become healthy: {args.url}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
