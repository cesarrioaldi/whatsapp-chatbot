#!/usr/bin/env python3
"""Search bridge — uses the same DDGS library as Hermes' web_search.
   Bot calls: GET http://localhost:32229/?q=Hime+no+Coffee
   Returns JSON with title, snippet, url.
"""
import json, sys, logging
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

logging.basicConfig(level=logging.INFO, format='%(asctime)s [SEARCH] %(message)s')
log = logging.getLogger('search')

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query).get('q', [None])[0]
        if not q:
            self.send_error(400, 'Missing ?q=')
            return
        limit = int(parse_qs(urlparse(self.path).query).get('limit', [5])[0])

        try:
            from ddgs import DDGS
            results = []
            with DDGS(timeout=10) as ddgs:
                for i, hit in enumerate(ddgs.text(q, max_results=limit)):
                    if i >= limit: break
                    results.append({
                        'title': hit.get('title', ''),
                        'snippet': hit.get('body', ''),
                        'url': hit.get('href', ''),
                    })
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'results': results, 'query': q}).encode())
            log.info(f'"{q}" → {len(results)} results')
        except Exception as e:
            log.error(f'"{q}" → {e}')
            self.send_error(500, str(e))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def log_message(self, fmt, *args):
        log.info(fmt % args)

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 32229
    server = HTTPServer(('0.0.0.0', port), Handler)
    print(f'SEARCH_BRIDGE_READY:{port}', flush=True)
    server.serve_forever()