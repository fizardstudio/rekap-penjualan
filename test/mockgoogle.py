# Server Google tiruan untuk menguji backup Google Drive (OAuth + Drive API v3 + upload resumable)
import json, hashlib, base64, uuid, time, threading, urllib.parse as up
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ST = {"challenges": {}, "rt": {}, "files": {}, "sessions": {}, "fail": False, "calls": []}
BASE = "http://127.0.0.1:9900"
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def j(self, code, obj, hdr=None):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json")
        for k, v in (hdr or {}).items(): self.send_header(k, v)
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0); return self.rfile.read(n) if n else b""
    def auth_ok(self):
        a = self.headers.get("Authorization", "")
        return a.startswith("Bearer AT-") and a[7:] in ST["rt"].values()
    def do_GET(self):
        u = up.urlparse(self.path); q = dict(up.parse_qsl(u.query)); ST["calls"].append("GET " + u.path)
        if u.path == "/auth":
            code = "CODE-" + uuid.uuid4().hex[:8]; ST["challenges"][code] = q.get("code_challenge")
            assert "drive.file" in q["scope"] and q["code_challenge_method"] == "S256" and q["access_type"] == "offline"
            loc = q["redirect_uri"] + "?" + up.urlencode({"code": code, "state": q["state"], "scope": q["scope"]})
            self.send_response(302); self.send_header("Location", loc); self.end_headers(); return
        if u.path == "/__state":
            return self.j(200, {"files": [{k: v for k, v in f.items() if k != "data"} | {"size": len(f.get("data") or b"")} for f in ST["files"].values()], "calls": ST["calls"][-30:]})
        if u.path == "/__reset": ST["files"].clear(); return self.j(200, {})
        if u.path == "/__fail": ST["fail"] = q.get("on") == "1"; return self.j(200, {"fail": ST["fail"]})
        if u.path == "/__revoke_all": ST["rt"].clear(); return self.j(200, {})
        if u.path == "/__nodrive": ST["nodrive"] = q.get("on") == "1"; return self.j(200, {})
        if u.path.startswith("/__file/"):
            f = ST["files"][u.path.split("/")[-1]]; self.send_response(200); self.end_headers(); self.wfile.write(f["data"]); return
        if not self.auth_ok(): return self.j(401, {"error": {"message": "Invalid Credentials"}})
        if u.path == "/userinfo": return self.j(200, {"email": "irwan.test@gmail.com", "email_verified": True})
        if u.path == "/drive/v3/files":
            qs = q.get("q", ""); out = []
            for f in ST["files"].values():
                if f["trashed"] and "trashed=false" in qs: continue
                ok = True
                for part in qs.split(" and "):
                    part = part.strip()
                    if part.startswith("name='"): ok &= f["name"] == part[6:-1].replace("\\'", "'")
                    elif part.startswith("name contains '"): ok &= part[15:-1] in f["name"]
                    elif " in parents" in part: ok &= part.split("'")[1] in f["parents"]
                    elif part.startswith("mimeType='"): ok &= f["mimeType"] == part[10:-1]
                if ok: out.append({"id": f["id"], "name": f["name"], "createdTime": f["created"], "modifiedTime": f.get("modified", f["created"]), "size": str(len(f.get("data") or b"")), "appProperties": f.get("props", {})})
            return self.j(200, {"files": out})
        if u.path.startswith("/drive/v3/files/"):
            fid = u.path.split("/")[-1]; f = ST["files"].get(fid)
            if not f: return self.j(404, {"error": {"message": "File not found"}})
            if q.get("alt") == "media":
                self.send_response(200); self.send_header("Content-Length", str(len(f["data"]))); self.end_headers(); self.wfile.write(f["data"]); return
            return self.j(200, {"id": fid, "trashed": f["trashed"]})
        self.j(404, {})
    def do_POST(self):
        u = up.urlparse(self.path); q = dict(up.parse_qsl(u.query)); raw = self.body(); ST["calls"].append("POST " + u.path + ("?" + u.query if u.query else ""))
        if u.path == "/token":
            p = dict(up.parse_qsl(raw.decode()))
            if p.get("client_secret") != "GOCSPX-test": return self.j(401, {"error": "invalid_client"})
            if p["grant_type"] == "authorization_code":
                ch = ST["challenges"].pop(p["code"], None)
                if not ch or b64(hashlib.sha256(p["code_verifier"].encode()).digest()) != ch: return self.j(400, {"error": "invalid_grant", "error_description": "PKCE salah"})
                rt = "RT-" + uuid.uuid4().hex[:6]; ST["rt"][rt] = "AT-" + uuid.uuid4().hex[:6]
                sc = "openid https://www.googleapis.com/auth/userinfo.email" + ("" if ST.get("nodrive") else " https://www.googleapis.com/auth/drive.file")
                return self.j(200, {"access_token": ST["rt"][rt], "refresh_token": rt, "expires_in": 3600, "token_type": "Bearer", "scope": sc})
            if p["grant_type"] == "refresh_token":
                if p["refresh_token"] not in ST["rt"]: return self.j(400, {"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
                ST["rt"][p["refresh_token"]] = "AT-" + uuid.uuid4().hex[:6]
                return self.j(200, {"access_token": ST["rt"][p["refresh_token"]], "expires_in": 3600})
        if u.path == "/revoke":
            t = dict(up.parse_qsl(raw.decode())).get("token"); ST["rt"].pop(t, None); return self.j(200, {})
        if not self.auth_ok(): return self.j(401, {"error": {"message": "Invalid Credentials"}})
        if u.path == "/drive/v3/files":
            m = json.loads(raw); fid = "F" + uuid.uuid4().hex[:8]
            ST["files"][fid] = {"id": fid, "name": m["name"], "mimeType": m.get("mimeType", ""), "parents": m.get("parents", []), "trashed": False, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "data": b""}
            return self.j(200, {"id": fid})
        if u.path == "/upload/drive/v3/files" and q.get("uploadType") == "resumable":
            if ST["fail"]: return self.j(503, {"error": {"message": "Backend Error"}})
            m = json.loads(raw); sid = uuid.uuid4().hex; ST["sessions"][sid] = {"new": m}
            return self.j(200, {}, {"Location": BASE + "/upload/session/" + sid})
        self.j(404, {})
    def do_PATCH(self):
        u = up.urlparse(self.path); raw = self.body(); ST["calls"].append("PATCH " + u.path)
        if not self.auth_ok(): return self.j(401, {"error": {"message": "Invalid Credentials"}})
        if u.path.startswith("/upload/drive/v3/files/"):
            if ST["fail"]: return self.j(503, {"error": {"message": "Backend Error"}})
            sid = uuid.uuid4().hex; ST["sessions"][sid] = {"upd": u.path.split("/")[-1], "props": (json.loads(raw or b"{}").get("appProperties") or {})}
            return self.j(200, {}, {"Location": BASE + "/upload/session/" + sid})
        self.j(404, {})
    def do_PUT(self):
        u = up.urlparse(self.path); raw = self.body(); ST["calls"].append("PUT " + u.path[:24])
        s = ST["sessions"].pop(u.path.split("/")[-1], None)
        if not s: return self.j(404, {"error": {"message": "session"}})
        if "upd" in s:
            fid = s["upd"]; ST["files"][fid].setdefault("props", {}).update(s["props"])
        else:
            m = s["new"]; fid = "F" + uuid.uuid4().hex[:8]
            ST["files"][fid] = {"id": fid, "name": m["name"], "mimeType": m.get("mimeType", ""), "parents": m.get("parents", []), "trashed": False, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "props": m.get("appProperties") or {}}
        ST["files"][fid]["modified"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
        ST["files"][fid]["data"] = raw; ST["files"][fid]["updates"] = ST["files"][fid].get("updates", 0) + 1
        self.j(200, {"id": fid})
    def do_DELETE(self):
        u = up.urlparse(self.path); ST["calls"].append("DELETE " + u.path)
        if not self.auth_ok(): return self.j(401, {})
        ST["files"].pop(u.path.split("/")[-1], None); self.send_response(204); self.end_headers()
ThreadingHTTPServer(("127.0.0.1", 9900), H).serve_forever()
