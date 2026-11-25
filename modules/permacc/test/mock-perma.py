#!/usr/bin/env python3
"""A local stand-in for api.perma.cc, for exercising lawcite's Perma.cc part inside a real Zotero without spending
quota or touching the network.   python3 mock-perma.py [port] [logfile]

Implements what permacc.js calls: GET /v1/user/, folders (list/create), POST /v1/archives/, GET /v1/archives/?limit&offset (the
account's archive list), GET/PATCH an archive. The account starts with one archive already in it, of
https://example.org/live-existing, to exercise "record the existing archive instead of paying again".
Test hooks by URL text: "reject" in the page URL -> 400; "failcapture" -> the capture later reports failed.
Key: MOCKKEY. Prints one line per request and appends it to the log file."""
import json, re, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 23400
LOG = sys.argv[2] if len(sys.argv) > 2 else None
KEY = 'MOCKKEY'
folders = {10: {'id': 10, 'name': 'Personal Links', 'parent': None, 'organization': None}}
archives = {
    'EXST-0001': {'guid': 'EXST-0001', 'url': 'https://example.org/live-existing', 'folder': 10, 'title': 'Already archived', 'is_private': False},
}
state = {'folder': 100, 'guid': 1}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, status, obj=None):
        body = b'' if obj is None else json.dumps(obj).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def note(self, text):
        print(text, flush=True)
        if LOG: open(LOG, 'a').write(text + '\n')
    def handle_any(self, method):
        n = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(n)) if n else None
        self.note(f'{method} {self.path}' + (f' {json.dumps(body, sort_keys=True)}' if body else ''))
        if self.headers.get('Authorization') != 'ApiKey ' + KEY:
            return self.send(401, {'detail': 'Authentication credentials were not provided.'})
        path = self.path.split('?')[0]
        m = None
        if method == 'GET' and path == '/v1/user/':
            return self.send(200, {'id': 7, 'full_name': 'Mock User', 'top_level_folders': [{'id': 10, 'name': 'Personal Links', 'organization': None}]})
        m = re.match(r'^/v1/folders/(\d+)/folders/?$', path)
        if m:
            pid = int(m.group(1))
            if pid not in folders: return self.send(404, {'detail': 'Not found.'})
            if method == 'GET': return self.send(200, {'objects': [f for f in folders.values() if f['parent'] == pid]})
            if method == 'POST':
                fid = state['folder']; state['folder'] += 1
                folders[fid] = {'id': fid, 'name': body['name'], 'parent': pid, 'organization': None}
                return self.send(201, folders[fid])
        if method == 'GET' and path == '/v1/archives/':
            q = dict(kv.split('=') for kv in self.path.split('?', 1)[1].split('&')) if '?' in self.path else {}
            limit, offset = int(q.get('limit', 300)), int(q.get('offset', 0))
            allx = [{'guid': a['guid'], 'url': a['url'], 'user_deleted': False, 'creation_timestamp': '2026-01-01T00:00:00Z',
                     'captures': [{'role': 'primary', 'status': 'failed' if 'failcapture' in a['url'] else 'success'}]} for a in archives.values()]
            return self.send(200, {'meta': {'limit': limit, 'offset': offset}, 'objects': allx[offset:offset + limit]})
        if method == 'POST' and path == '/v1/archives/':
            if 'reject' in body['url']: return self.send(400, {'url': ['Not a valid URL.']})
            if body.get('folder') not in folders: return self.send(404, {'detail': 'Not found.'})
            guid = 'MOCK-%04d' % (1000 + state['guid']); state['guid'] += 1
            archives[guid] = {'guid': guid, 'url': body['url'], 'folder': body['folder'], 'title': body.get('title'), 'is_private': False}
            return self.send(201, {'guid': guid, 'url': body['url'], 'captures': [{'role': 'primary', 'status': 'pending'}]})
        m = re.match(r'^/v1/archives/([A-Z0-9-]+)/$', path)
        if m and m.group(1) in archives:
            a = archives[m.group(1)]
            if method == 'PATCH': a['is_private'] = bool(body.get('is_private')); return self.send(200, a)
            if method == 'GET':
                status = 'failed' if 'failcapture' in a['url'] else 'success'
                return self.send(200, {'guid': a['guid'], 'captures': [{'role': 'primary', 'status': status}]})
        return self.send(404, {'detail': 'no route'})
    def do_GET(self): self.handle_any('GET')
    def do_POST(self): self.handle_any('POST')
    def do_PATCH(self): self.handle_any('PATCH')

if __name__ == '__main__':
    HTTPServer(('127.0.0.1', PORT), H).serve_forever()
