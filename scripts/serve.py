"""Serves docs/ for local preview, telling the browser not to cache anything.

The page is several JavaScript files. A browser that keeps old copies of some
and loads new copies of others runs a mix that misbehaves, so every response
says no-store. Usage: python3 scripts/serve.py [port]
"""

import functools
import http.server
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4317
    handler = functools.partial(NoCacheHandler, directory=str(DOCS))
    try:
        server = http.server.ThreadingHTTPServer(("", port), handler)
    except OSError as error:
        if error.errno in (48, 98):  # address already in use (macOS, Linux)
            sys.exit(
                f"Port {port} is already in use, probably by Quick Draw running in another window.\n"
                f"Open http://localhost:{port}, or stop the other server (Ctrl+C in its window),\n"
                f"or use another port: python3 scripts/serve.py {port + 1}"
            )
        raise
    with server:
        print(f"Quick Draw is at http://localhost:{port} (Ctrl+C to stop)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
