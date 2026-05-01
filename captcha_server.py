import base64
import threading
from io import BytesIO

from flask import Flask, jsonify, render_template_string, request

from config import FLASK_HOST, FLASK_PORT

app = Flask(__name__)

# Shared state between main thread and Flask server
state = {
    "waiting": False,
    "message": "就绪 - 等待脚本启动",
    "screenshot_base64": None,
    "captcha_text": None,
}
captcha_event = threading.Event()
captcha_done = threading.Event()

HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>智慧树验证码处理</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Microsoft YaHei', Arial, sans-serif; max-width: 650px; margin: 30px auto; padding: 20px; background: #f5f6fa; }
  h1 { text-align: center; color: #2c3e50; margin-bottom: 20px; font-size: 22px; }
  .card { background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 15px; }
  .status { padding: 12px 15px; border-radius: 6px; margin-bottom: 15px; text-align: center; font-size: 15px; }
  .status.waiting { background: #fff3cd; color: #856404; border: 1px solid #ffc107; }
  .status.ready { background: #d4edda; color: #155724; border: 1px solid #28a745; }
  .status.info { background: #cce5ff; color: #004085; border: 1px solid #007bff; }
  .screenshot-container { text-align: center; margin-bottom: 15px; }
  .screenshot-container img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.15); }
  .form-group { display: flex; gap: 10px; margin-bottom: 12px; }
  .form-group input { flex: 1; padding: 10px 12px; font-size: 15px; border: 1px solid #ccc; border-radius: 4px; }
  .btn { padding: 10px 18px; font-size: 15px; border: none; border-radius: 4px; cursor: pointer; transition: background 0.2s; }
  .btn-primary { background: #007bff; color: #fff; }
  .btn-primary:hover { background: #0056b3; }
  .btn-success { background: #28a745; color: #fff; }
  .btn-success:hover { background: #1e7e34; }
  .btn-group { display: flex; gap: 10px; flex-wrap: wrap; }
  .tip { color: #6c757d; font-size: 13px; margin-top: 10px; text-align: center; }
</style>
</head>
<body>
<h1>智慧树自动刷课 - 验证码处理</h1>
<div id="status" class="status info">{{ state.message }}</div>

{% if state.screenshot_base64 %}
<div class="card screenshot-container">
  <img src="data:image/png;base64,{{ state.screenshot_base64 }}" alt="验证码截图">
</div>
{% endif %}

<div class="card">
  <div class="form-group">
    <input type="text" id="captchaInput" placeholder="输入验证码（如适用）" autocomplete="off">
    <button class="btn btn-primary" onclick="submitCaptcha()">提交验证码</button>
  </div>
  <div class="btn-group">
    <button class="btn btn-success" onclick="markSolved()">已在浏览器中完成滑块/点击验证</button>
  </div>
  <p class="tip">提示：如果是滑块或点选验证码，请在浏览器窗口中手动完成，然后点击上方绿色按钮继续脚本。</p>
</div>

<script>
async function checkStatus() {
  try {
    const resp = await fetch('/status');
    const data = await resp.json();
    const el = document.getElementById('status');
    el.textContent = data.message;
    el.className = 'status ' + (data.waiting ? 'waiting' : (data.message.includes('就绪') ? 'info' : 'ready'));
    if (data.screenshot) {
      let img = document.querySelector('.screenshot-container img');
      if (!img) {
        const container = document.querySelector('.screenshot-container') || document.createElement('div');
        if (!container.classList.contains('screenshot-container')) {
          container.className = 'card screenshot-container';
          document.body.insertBefore(container, document.querySelector('.card:last-of-type'));
        }
        img = document.createElement('img');
        container.appendChild(img);
      }
      img.src = 'data:image/png;base64,' + data.screenshot;
      img.parentElement.style.display = 'block';
    }
  } catch(e) { console.error(e); }
}
async function submitCaptcha() {
  const text = document.getElementById('captchaInput').value;
  if (!text) return;
  await fetch('/submit', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({captcha: text})
  });
  document.getElementById('captchaInput').value = '';
}
async function markSolved() {
  await fetch('/submit', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({action: 'solved'})
  });
}
setInterval(checkStatus, 2000);
checkStatus();
</script>
</body>
</html>"""


@app.route("/")
def index():
    return render_template_string(HTML_TEMPLATE, state=state)


@app.route("/status")
def get_status():
    return jsonify(
        {
            "waiting": state["waiting"],
            "message": state["message"],
            "screenshot": state["screenshot_base64"],
        }
    )


@app.route("/submit", methods=["POST"])
def submit():
    data = request.get_json()
    if data:
        if data.get("action") == "solved":
            state["captcha_text"] = "__SOLVED__"
        elif data.get("captcha"):
            state["captcha_text"] = data["captcha"]
        captcha_done.set()
        state["waiting"] = False
        state["message"] = "验证码已提交，脚本继续运行中..."
    return jsonify({"ok": True})


def start_server():
    app.run(host=FLASK_HOST, port=FLASK_PORT, debug=False, use_reloader=False)


def notify_captcha(screenshot_base64=None, message="请完成验证码"):
    """Called from main thread when CAPTCHA is detected."""
    state["waiting"] = True
    state["message"] = message
    state["screenshot_base64"] = screenshot_base64
    state["captcha_text"] = None
    captcha_event.set()
    captcha_done.clear()


def wait_for_captcha_solution(timeout=None):
    """Wait for user to solve CAPTCHA. Returns the captcha text or '__SOLVED__'."""
    captcha_done.wait(timeout=timeout)
    return state.get("captcha_text")
