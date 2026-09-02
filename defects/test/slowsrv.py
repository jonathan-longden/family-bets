# A deliberately slow link, for swupgrade.mjs.
#
# Every file under vendor/tfjs/ takes VENDOR_DELAY seconds to answer. That is
# past the four-second timeout the old service worker used and irrelevant to the
# cache-first path that replaced it, which is the difference the suite is there
# to measure.
#
#   python3 slowsrv.py <directory-to-serve> [port]
#
# The directory is passed in rather than assumed, because the site under test is
# a copy staged in a temporary directory that gets rewritten mid-run.
import http.server
import os
import socketserver
import sys
import time

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1
                       else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'stage'))
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.environ.get('SLOW_PORT', '8779'))
DELAY = float(os.environ.get('VENDOR_DELAY', '6'))


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
        if '/vendor/tfjs/' in self.path:
            time.sleep(DELAY)
        super().do_GET()

    def end_headers(self):
        # What GitHub Pages sends, so the worker's cache:'reload' is doing the
        # same work here as it does in the field.
        self.send_header('Cache-Control', 'max-age=600')
        super().end_headers()

    def log_message(self, *a):
        pass


class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


S(('127.0.0.1', PORT), H).serve_forever()
