"""
server.py: a small web server for The Market Maker's Dilemma.

Run with:  python server.py          (then open http://127.0.0.1:8000)

Uses only the Python standard library. It serves the page in web/ and a tiny
JSON API (api.py). Game state lives on the server; the browser only ever
receives public information (see api.py).
"""
import argparse
import json
import mimetypes
import pathlib
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from api import ApiError, GameApi

WEB = (pathlib.Path(__file__).parent / "web").resolve()
API = GameApi()
LOCK = threading.Lock()
MAX_BODY = 10_000
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml"}
HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                               "font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; "
                               "frame-ancestors 'none'",
}

ACTIONS = {
    "config": lambda b: API.config(),
    "start": lambda b: API.start(b.get("mode")),
    "state": lambda b: API.state(b.get("sid")),
    "lock": lambda b: API.lock(b.get("sid"), b.get("bid"), b.get("ask")),
    "settle": lambda b: API.settle(b.get("sid")),
    "next": lambda b: API.next_round(b.get("sid")),
}


class Handler(BaseHTTPRequestHandler):
    server_version = "MarketMakersDilemma"

    def log_message(self, fmt, *args):      # keep the terminal quiet
        pass

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in {**HEADERS, **(extra or {})}.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj).encode(), "application/json")

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/log":
            sid = (parse_qs(url.query).get("sid") or [""])[0]
            try:
                with LOCK:
                    text = API.log(sid)
            except ApiError as e:
                return self._json(400, {"error": str(e)})
            return self._send(200, text.encode(), "application/x-ndjson",
                              {"Content-Disposition": 'attachment; filename="mmd_session.jsonl"'})
        rel = "index.html" if url.path == "/" else url.path.lstrip("/")
        target = (WEB / rel).resolve()
        if WEB not in target.parents or not target.is_file():
            return self._send(404, b"not found", "text/plain")
        ctype = TYPES.get(target.suffix) or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self._send(200, target.read_bytes(), ctype)

    def do_POST(self):
        path = urlparse(self.path).path
        action = ACTIONS.get(path[5:]) if path.startswith("/api/") else None
        if action is None:
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._json(400, {"error": "bad request"})
        if length > MAX_BODY:
            return self._json(413, {"error": "request too large"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self._json(400, {"error": "bad request"})
        try:
            with LOCK:
                result = action(body)
        except ApiError as e:
            return self._json(400, {"error": str(e)})
        self._json(200, result)


def make_server(host: str = "127.0.0.1", port: int = 8000) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), Handler)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    srv = make_server(a.host, a.port)
    url = f"http://{a.host}:{srv.server_address[1]}"
    print(f"The Market Maker's Dilemma is running at {url}\nPress Ctrl+C to stop.")
    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
