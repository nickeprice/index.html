"""Local development server.

Serves the repository root statically and delegates ``/api/*`` to the real
production handler in ``api/water_report.py``.

``api/water_report.py`` only defines a ``handler`` class - it has no
``__main__`` block, because Vercel's Python serverless runtime supplies the
server. That means there is otherwise no way to run the frontend and the API
together locally.

IMPORTANT: this subclasses the production handler instead of constructing a
second ``BaseHTTPRequestHandler``. Constructing a new handler re-runs
``handle()``, which reads a *new* request line off the socket - but this handler
has already consumed it, so the second handler blocks forever on the keep-alive
socket. Subclassing and delegating to ``do_GET`` avoids that entirely.

Usage::

    python3 scripts/dev_server.py 8000
"""

import mimetypes
import os
import sys
from http.server import ThreadingHTTPServer
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'api'))

import water_report  # noqa: E402  (path set up above)


class Handler(water_report.handler):
    """Static file server that delegates ``/api/*`` to the production handler."""

    protocol_version = 'HTTP/1.0'   # sidestep keep-alive edge cases

    def do_GET(self):
        if urlparse(self.path).path.startswith('/api/'):
            return water_report.handler.do_GET(self)
        return self.serve_static()

    def serve_static(self):
        path = unquote(urlparse(self.path).path)
        if path == '/':
            path = '/index.html'
        full = os.path.normpath(os.path.join(ROOT, path.lstrip('/')))
        # Refuse anything that escapes the repository root.
        if not full.startswith(ROOT) or not os.path.isfile(full):
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'not found')
            return
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        with open(full, 'rb') as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write('[dev] %s\n' % (fmt % args))
        sys.stderr.flush()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    httpd = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print('Puyallup River Companion dev server')
    print('  root : %s' % ROOT)
    print('  url  : http://127.0.0.1:%d/index.html' % port)
    print('  api  : /api/* -> api/water_report.handler')
    print('Ctrl-C to stop.')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nstopping')
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()
