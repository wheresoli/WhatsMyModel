"""Minimal static dev server for the demo, rooted at the repo.

Sends `Cache-Control: no-store` so buildless ES modules are always re-fetched —
without it browsers cache the module graph and reloads silently run stale code.
Usage: python scripts/serve.py [port]   (default 8099)
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):  # keep the console quiet
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"WMM dev server on http://localhost:{PORT}/apps/demo/ (no-store)")
    httpd.serve_forever()
