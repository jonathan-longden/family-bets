import http.server, functools, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # exactly what GitHub Pages does to static assets
        self.send_header('Cache-Control', 'public, max-age=600')
        super().end_headers()
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', 8788),
    functools.partial(H, directory=sys.argv[1])).serve_forever()
