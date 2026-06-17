#!/usr/bin/env python3
"""Hermes Dashboard — Custom Flask server connected to real infrastructure."""

import os, sys, json, yaml, time, subprocess, glob, re
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, session
import psutil

ENV_FILE = "/opt/data/.env"
if os.path.exists(ENV_FILE):
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key not in os.environ:
                    os.environ[key] = val

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = os.environ.get("HCI_SECRET", os.urandom(24).hex())

ADMIN_PASSWORD = os.environ.get("HCI_PASSWORD")
if not ADMIN_PASSWORD:
    import secrets
    ADMIN_PASSWORD = secrets.token_hex(16)
    print(f"WARNING: No HCI_PASSWORD set. Generated: {ADMIN_PASSWORD}")
ADMIN_USERNAME = "admin"
DATA_DIR = "/opt/data"
CONFIG_PATH = f"{DATA_DIR}/config.yaml"
SKILLS_DIR = f"{DATA_DIR}/skills"
SESSIONS_DIR = f"{DATA_DIR}/sessions"

def check_auth():
    return session.get("authenticated") == True

@app.route("/api/auth", methods=["POST"])
def api_auth():
    data = request.get_json(force=True)
    if data.get("username") == ADMIN_USERNAME and data.get("password") == ADMIN_PASSWORD:
        session["authenticated"] = True
        session["username"] = ADMIN_USERNAME
        session["role"] = "admin"
        return jsonify({"ok": True, "username": ADMIN_USERNAME, "role": "admin"})
    return jsonify({"ok": False, "error": "Invalid credentials"}), 401

@app.route("/api/auth/check")
def api_auth_check():
    if check_auth():
        return jsonify({"ok": True, "username": session.get("username"), "role": session.get("role")})
    return jsonify({"ok": False}), 401

@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})

@app.route("/api/system")
def api_system():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    cpu = psutil.cpu_percent(interval=0.1)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    boot = datetime.fromtimestamp(psutil.boot_time()).strftime("%Y-%m-%d %H:%M")
    return jsonify({
        "cpu_percent": cpu, "memory_percent": mem.percent,
        "memory_used_gb": round(mem.used / (1024**3), 1),
        "memory_total_gb": round(mem.total / (1024**3), 1),
        "disk_percent": disk.percent,
        "disk_used_gb": round(disk.used / (1024**3), 1),
        "disk_total_gb": round(disk.total / (1024**3), 1),
        "boot_time": boot, "uptime_hours": round((time.time() - psutil.boot_time()) / 3600, 1),
    })

@app.route("/api/services")
def api_services():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    return jsonify({
        "gateway": check_port(8642), "tr4nsform_org": check_port(4174),
        "tjadvaita": check_port(8080), "kohphangan": check_port(4180),
        "kora": check_port(4190), "dashboard": True,
    })

def check_port(port):
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(2)
    try:
        s.connect(("127.0.0.1", port)); s.close(); return True
    except: return False

@app.route("/api/processes")
def api_processes():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    procs = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent", "cmdline"]):
        try:
            info = p.info
            if info["cmdline"] and any(k in " ".join(info["cmdline"]).lower() for k in ["hermes", "node", "python", "cloudflare", "ttyd"]):
                cmd = redact_creds(" ".join(info["cmdline"]))
                procs.append({"pid": info["pid"], "name": info["name"], "cpu": round(info["cpu_percent"] or 0, 1), "mem": round(info["memory_percent"] or 0, 1), "cmd": cmd[:180]})
        except: pass
    procs.sort(key=lambda x: x["cpu"], reverse=True)
    return jsonify(procs[:20])

def redact_creds(cmd):
    cmd = re.sub(r'(-c\s+\S+:)\S+(@\S+)?', r'\1***', cmd)
    for k in ["DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"]:
        cmd = re.sub(f'({k}=)\\S+', r'\1***', cmd)
    return cmd

@app.route("/api/config")
def api_config():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    with open(CONFIG_PATH) as f: config = yaml.safe_load(f)
    return jsonify({
        "default_model": config.get("model", {}).get("default", "N/A"),
        "default_provider": config.get("model", {}).get("provider", "N/A"),
        "providers": list(config.get("providers", {}).keys()),
        "fallback": config.get("fallback_providers", []),
    })

@app.route("/api/config/raw")
def api_config_raw():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    with open(CONFIG_PATH) as f: return jsonify({"content": f.read()})

@app.route("/api/models")
def api_models():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    return jsonify({
        "deepseek": ["deepseek-v4-pro"],
        "openrouter": ["google/gemini-2.5-pro", "google/gemini-2.5-flash", "anthropic/claude-sonnet-4-6", "deepseek/deepseek-v4-pro", "zhipu/glm-5.2-32b-0416"],
        "anthropic": ["claude-sonnet-4-6", "claude-opus-4-7"],
    })

@app.route("/api/config/model", methods=["POST"])
def api_set_model():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(force=True)
    with open(CONFIG_PATH) as f: config = yaml.safe_load(f)
    if data.get("provider"): config["model"]["provider"] = data["provider"]
    if data.get("model"): config["model"]["default"] = data["model"]
    subprocess.run(["cp", CONFIG_PATH, f"{CONFIG_PATH}.bak.{int(time.time())}"])
    with open(CONFIG_PATH, "w") as f: yaml.dump(config, f, default_flow_style=False, allow_unicode=True)
    return jsonify({"ok": True, "model": config["model"]["default"]})

@app.route("/api/agents")
def api_agents():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    with open(CONFIG_PATH) as f: config = yaml.safe_load(f)
    dm = config.get("model", {}).get("default", "deepseek-v4-pro")
    dp = config.get("model", {}).get("provider", "deepseek")
    return jsonify([
        {"id": "hermes-subagent", "type": "Built-in", "model": dm, "provider": dp, "status": "active", "description": "Hermes native subagent"},
        {"id": "claude-code", "type": "External CLI", "model": "claude-sonnet-4-6", "provider": "anthropic", "status": "available", "description": "Anthropic Claude Code CLI"},
        {"id": "codex", "type": "External CLI", "model": "gpt-4.1", "provider": "openrouter", "status": "available", "description": "OpenAI Codex CLI"},
    ])

@app.route("/api/skills")
def api_skills():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    skills = []
    for root, dirs, files in os.walk(SKILLS_DIR):
        if any(p.startswith(".") for p in Path(root).parts): continue
        if "SKILL.md" in files:
            name = os.path.basename(root)
            rel = os.path.relpath(root, SKILLS_DIR)
            cat = rel.split("/")[0] if "/" in rel else "root"
            desc = ""
            with open(os.path.join(root, "SKILL.md")) as f:
                content = f.read()
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    try: desc = yaml.safe_load(parts[1]).get("description", "")[:200]
                    except: pass
            skills.append({"name": name, "category": cat, "description": desc, "has_refs": bool(glob.glob(os.path.join(root, "references", "*"))), "has_scripts": bool(glob.glob(os.path.join(root, "scripts", "*"))), "has_templates": bool(glob.glob(os.path.join(root, "templates", "*")))})
    skills.sort(key=lambda s: (s["category"], s["name"]))
    return jsonify(skills)

@app.route("/api/sessions")
def api_sessions():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    sessions = []
    limit = int(request.args.get("limit", 100))
    if os.path.isdir(SESSIONS_DIR):
        for f in sorted(os.listdir(SESSIONS_DIR), key=lambda f: os.path.getmtime(os.path.join(SESSIONS_DIR, f)), reverse=True):
            fp = os.path.join(SESSIONS_DIR, f)
            if not (f.endswith(".json") or f.endswith(".jsonl")) or "request_dump" in f or f == "sessions.json": continue
            try:
                stat = os.stat(fp)
                data = read_meta(fp)
                if not isinstance(data, dict): continue
                msgs = data.get("messages", [])
                mc = data.get("message_count", len(msgs))
                sp = data.get("system_prompt", "")
                plt = data.get("platform") or ""
                model = data.get("model") or ""
                user = "unknown"
                is_cron = "cron" in str(plt).lower() or "cron" in f.lower()
                has_t = "Tobias" in sp
                has_j = "Crimea" in sp or "Sanskrit" in sp or "MG 5/1" in sp or "Russian" in sp
                if has_t and has_j: user = "tobias"
                elif has_j: user = "julia"
                elif has_t: user = "tobias"
                if user == "unknown" and isinstance(msgs, list):
                    for m in msgs[:10]:
                        if isinstance(m, dict) and m.get("role") == "user":
                            c = str(m.get("content", ""))
                            if any(ord(ch) > 1000 for ch in c[:500]): user = "julia"; break
                            if "voice message" in c: user = "tobias"; break
                if user == "unknown" and "telegram" in str(plt).lower(): user = "tobias"
                sid = f.replace(".jsonl","").replace(".json","")
                sessions.append({"id": sid, "size_kb": round(stat.st_size/1024,1), "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(), "messages": mc, "platform": plt, "model": model, "user": user, "is_cron": is_cron, "session_start": data.get("session_start","")})
            except: pass
            if len(sessions) >= limit: break
    return jsonify(sessions)

def read_meta(fp):
    if fp.endswith(".jsonl"):
        with open(fp, encoding='utf-8', errors='replace') as fh:
            first = fh.readline().strip()
            if first:
                try: meta = json.loads(first)
                except: meta = {}
                if meta.get("role") == "session_meta": return meta
                fh.seek(0)
                msgs = []
                for line in fh:
                    line = line.strip()
                    if line:
                        try: msgs.append(json.loads(line))
                        except: pass
                sp = ""
                plt = ""
                for m in msgs:
                    if m.get("role") == "system": sp = str(m.get("content",""))
                    if m.get("role") == "session_meta": plt = m.get("platform","")
                return {"messages": msgs, "message_count": len(msgs), "system_prompt": sp, "platform": plt, "model": ""}
    with open(fp, encoding='utf-8', errors='replace') as fh: return json.load(fh)

@app.route("/api/sessions/<session_id>")
def api_session_detail(session_id):
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    for ext in [".jsonl", ".json"]:
        fp = os.path.join(SESSIONS_DIR, session_id + ext)
        if os.path.isfile(fp):
            try:
                data = read_meta(fp)
                msgs = data.get("messages", [])
                if isinstance(msgs, list):
                    clean = [{"role": m.get("role",""), "content": str(m.get("content",""))[:5000]} for m in msgs if isinstance(m, dict)]
                    return jsonify({"session_id": session_id, "model": data.get("model",""), "platform": data.get("platform",""), "message_count": len(clean), "messages": clean})
            except: pass
    return jsonify({"error": "Not found"}), 404

@app.route("/api/files/list")
def api_files_list():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    base = request.args.get("path", DATA_DIR)
    if not base.startswith("/opt/"): return jsonify({"error": "Access restricted"}), 403
    try:
        items = []
        for name in sorted(os.listdir(base)):
            fp = os.path.join(base, name)
            stat = os.stat(fp)
            items.append({"name": name, "type": "dir" if os.path.isdir(fp) else "file", "size_kb": round(stat.st_size/1024,1) if os.path.isfile(fp) else None, "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()})
        return jsonify({"path": base, "items": items})
    except PermissionError: return jsonify({"error": "Permission denied"}), 403

@app.route("/api/usage")
def api_usage():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    total_sessions = 0; total_messages = 0; by_model = {}; by_platform = {}; by_day = {}
    if os.path.isdir(SESSIONS_DIR):
        for f in list(os.listdir(SESSIONS_DIR))[:2000]:
            fp = os.path.join(SESSIONS_DIR, f)
            if not (f.endswith(".json") or f.endswith(".jsonl")): continue
            try:
                data = read_meta(fp)
                if not isinstance(data, dict): continue
                mc = data.get("message_count", 0)
                if mc == 0: continue
                total_sessions += 1; total_messages += mc
                m = data.get("model") or "unknown"; p = data.get("platform") or "unknown"
                by_model[m] = by_model.get(m, 0) + 1
                by_platform[p] = by_platform.get(p, 0) + 1
                ss = data.get("session_start") or ""
                if ss: by_day[str(ss)[:10]] = by_day.get(str(ss)[:10], 0) + 1
            except: pass
    return jsonify({"total_sessions": total_sessions, "total_messages": total_messages, "by_model": by_model, "by_platform": by_platform, "by_day": dict(sorted(by_day.items(), reverse=True)[:30])})

@app.route("/api/logs")
def api_logs():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    logs = []
    for pattern in ["/tmp/hermes*.log", "/var/log/syslog", "/var/log/service-watchdog.log"]:
        for fp in glob.glob(pattern):
            if os.path.isfile(fp):
                stat = os.stat(fp)
                logs.append({"name": os.path.basename(fp), "path": fp, "size_kb": round(stat.st_size/1024,1), "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()})
    return jsonify(logs)

@app.route("/api/logs/<path:logpath>")
def api_log_tail(logpath):
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    real = os.path.realpath(logpath)
    if not any(real.startswith(os.path.realpath(a)) for a in ["/tmp/", "/var/log/"]): return jsonify({"error": "Access denied"}), 403
    if not os.path.isfile(real): return jsonify({"error": "Not found"}), 404
    try:
        result = subprocess.run(["tail", "-100", logpath], capture_output=True, text=True, timeout=5)
        return jsonify({"content": result.stdout[-20000:]})
    except: return jsonify({"content": "Error reading log"})

@app.route("/api/cron")
def api_cron():
    if not check_auth(): return jsonify({"error": "Unauthorized"}), 401
    cron_config = f"{DATA_DIR}/cron/jobs.json"
    if os.path.exists(cron_config):
        with open(cron_config) as f: return jsonify(json.load(f))
    return jsonify([])

@app.route("/")
def index():
    return app.send_static_file("index.html")

@app.route("/assets/<path:filename>")
def assets(filename):
    return send_from_directory("static/assets", filename)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10275))
    print(f"Hermes Dashboard starting on port {port}")
    app.run(host="127.0.0.1", port=port, debug=False)
