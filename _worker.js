const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

const DEFAULT_PROXYIP_LIST = [
  'proxyip.cmliussss.net',
];

const PROXYIP_OPTIONS = [];

const CF_FALLBACK_IPS = ['[2a00:1098:2b::1:6815:5881]'];
const encoder = new TextEncoder();

import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request, env, ctx) {
    try {
      var token = '';
      var proxyIP = '';
      var kvReady = false;

      if (env.KV) {
        kvReady = true;
        var kvToken = await env.KV.get('TOKEN');
        var kvProxyIP = await env.KV.get('PROXYIP');
        if (kvToken) token = kvToken;
        if (kvProxyIP) proxyIP = kvProxyIP;
      }

      const url = new URL(request.url);
      const path = url.pathname;
      const host = url.host;
      const inputKey = url.searchParams.get('key') || '';
      const upgradeHeader = request.headers.get('Upgrade');

      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {

        if (path === '/') {
          if (!kvReady) {
            return new Response(pageNoKV(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
          }
          if (!token) {
            return new Response(pageSetup(host), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
          }
          if (inputKey !== token) {
            return new Response(pageLogin(host, inputKey ? true : false), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
          }
          return new Response(pageAdmin(host, token, proxyIP), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (path === '/api/health') {
          return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (path === '/api/setup' && request.method === 'POST') {
          if (!kvReady) {
            return new Response(JSON.stringify({ error: 'KV 未配置' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
          if (token) {
            return new Response(JSON.stringify({ error: '已初始化' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
          }
          var body = await request.json();
          if (!body.token) {
            return new Response(JSON.stringify({ error: '请输入 Token' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          }
          await env.KV.put('TOKEN', body.token);
          return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (path === '/api/config' && request.method === 'POST') {
          try {
            var body = await request.json();
            if (!token || body.key !== token) {
              return new Response(JSON.stringify({ error: '验证失败' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
            }
            if (!kvReady) {
              return new Response(JSON.stringify({ error: 'KV 未配置' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
            }
            if (body.token !== undefined) await env.KV.put('TOKEN', body.token);
            if (body.proxyIP !== undefined) await env.KV.put('PROXYIP', body.proxyIP);
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
          } catch (e) {
            return new Response(JSON.stringify({ error: e.message || '操作失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
        }

        if (path === '/api/logs' && request.method === 'GET') {
          if (!token || url.searchParams.get('key') !== token) {
            return new Response(JSON.stringify({ error: '验证失败' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
          }
          try {
            const logs = await env.KV.get('logs') || '[]';
            return new Response(logs, { headers: { 'Content-Type': 'application/json' } });
          } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
        }

        if (path === '/api/stats' && request.method === 'GET') {
          if (!token || url.searchParams.get('key') !== token) {
            return new Response(JSON.stringify({ error: '验证失败' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
          }
          try {
            const stats = await env.KV.get('stats') || '{"totalVisits":0,"todayVisits":0}';
            return new Response(stats, { headers: { 'Content-Type': 'application/json' } });
          } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
        }

        if (path === '/api/cf' && request.method === 'GET') {
          if (!token || url.searchParams.get('key') !== token) {
            return new Response(JSON.stringify({ error: '验证失败' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
          }
          try {
            const cfConfig = await env.KV.get('CF_CONFIG');
            if (cfConfig) {
              return new Response(cfConfig, { headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify({ accountId: null, apiToken: null }), { headers: { 'Content-Type': 'application/json' } });
          } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
        }

        if (path === '/api/cf' && request.method === 'POST') {
          try {
            var body = await request.json();
            if (!token || body.key !== token) {
              return new Response(JSON.stringify({ error: '验证失败' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
            }
            if (body.accountId && body.apiToken) {
              await env.KV.put('CF_CONFIG', JSON.stringify({ accountId: body.accountId, apiToken: body.apiToken }));
              return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
        }

        if (path === '/api/cf/verify' && request.method === 'POST') {
          try {
            var body = await request.json();
            if (!token || body.key !== token) {
              return new Response(JSON.stringify({ error: '验证失败' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
            }
            const cfData = await verifyCFAPI(body.accountId, body.apiToken);
            return new Response(JSON.stringify(cfData), { headers: { 'Content-Type': 'application/json' } });
          } catch (e) {
            return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
        }



        return new Response('Not Found', { status: 404 });
      }

      if (token && request.headers.get('Sec-WebSocket-Protocol') !== token) {
        return new Response('Unauthorized', { status: 401 });
      }

      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      handleSession(server, proxyIP).catch(() => safeCloseWebSocket(server));
      const responseInit = { status: 101, webSocket: client };
      if (token) responseInit.headers = { 'Sec-WebSocket-Protocol': token };
      return new Response(null, responseInit);

    } catch (err) {
      return new Response(err.toString(), { status: 500 });
    }
  },
};

function pageNoKV() {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ECH</title><style>body{font-family:system-ui;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff}.c{background:rgba(255,255,255,.08);border-radius:16px;padding:30px;text-align:center;max-width:400px;backdrop-filter:blur(10px)}h1{background:linear-gradient(90deg,#00d9ff,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:15px}p{color:#888;line-height:1.6}</style></head><body><div class="c"><h1>ECH 代理服务</h1><p>请先在 Cloudflare Dashboard 中：<br>1. 创建 KV namespace<br>2. 绑定到 Worker（变量名：KV）</p></div></body></html>';
}

function pageSetup(host) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>ECH</title><style>body{font-family:system-ui;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);min-height:100vh;display:flex;align-items:center;justify-content:center;color:#fff}.c{background:rgba(255,255,255,.08);border-radius:16px;padding:30px;max-width:400px;width:90%;backdrop-filter:blur(10px)}h1{background:linear-gradient(90deg,#00d9ff,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:10px;text-align:center}p{color:#888;text-align:center;margin-bottom:20px;font-size:.9em}.inp{width:100%;padding:12px;border:none;border-radius:10px;background:rgba(0,0,0,.3);color:#fff;margin-bottom:15px;box-sizing:border-box;font-size:1em}.inp:focus{outline:2px solid #a855f7}.btn{width:100%;background:linear-gradient(90deg,#a855f7,#00d9ff);color:#fff;border:none;padding:12px;border-radius:10px;cursor:pointer;font-weight:600;height:48px;display:flex;align-items:center;justify-content:center}.btn:disabled{opacity:.5}.msg{padding:10px;border-radius:8px;margin-bottom:10px;display:none;font-size:.9em}.msg.ok{background:rgba(0,255,100,.15);color:#00ff88;display:block}.msg.err{background:rgba(255,68,68,.15);color:#ff4757;display:block}@media(max-width:480px){.btn{height:48px;padding:0}}</style></head><body><div class="c"><h1>ECH 初始化</h1><p>首次使用，请设置管理 Token</p><div id="msg" class="msg"></div><input type="text" class="inp" id="t" placeholder="设置 Token（建议使用 UUID）"><button class="btn" id="b" onclick="setup()">确认设置</button></div><script>function setup(){var b=document.getElementById("b"),m=document.getElementById("msg"),t=document.getElementById("t").value;if(!t){m.className="msg err";m.textContent="请输入 Token";return}b.disabled=true;b.textContent="设置中...";fetch("/api/setup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:t})}).then(function(r){return r.json()}).then(function(d){if(d.success){m.className="msg ok";m.textContent="设置成功！";setTimeout(function(){location.href="/?key="+encodeURIComponent(t)},1000)}else{m.className="msg err";m.textContent=d.error;b.disabled=false;b.textContent="确认设置"}}).catch(function(e){m.className="msg err";m.textContent=e.message;b.disabled=false;b.textContent="确认设置"})}</script></body></html>';
}

function pageLogin(host, showError) {
  var errHtml = showError ? '<div class="err">Token 错误</div>' : '';
  return '<!DOCTYPE html><html data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>ECH Workers管理面板</title><style>:root{--bg:#1a1a2e;--card-bg:rgba(255,255,255,.06);--text:#e8e8e8;--sub:#9ca3af;--border:rgba(255,255,255,.08);--inp-bg:rgba(255,255,255,.05)}[data-theme="light"]{--bg:#f8fafc;--card-bg:#fff;--text:#1e293b;--sub:#64748b;--border:rgba(0,0,0,.08);--inp-bg:rgba(0,0,0,.04)}body{font-family:-apple-system,system-ui,sans-serif;background:var(--bg);min-height:100vh;display:flex;align-items:center;justify-content:center;color:var(--text);margin:0;transition:background .3s,color .3s}.wrap{position:relative;width:90%;max-width:400px}.top-btns{position:absolute;top:-50px;right:0;display:flex;gap:10px}.t-btn{background:var(--card-bg);border:1px solid var(--border);width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text);text-decoration:none;transition:all .2s}.t-btn:hover{transform:scale(1.05);border-color:#a855f7}.c{background:var(--card-bg);border:1px solid var(--border);border-radius:24px;padding:40px;backdrop-filter:blur(10px);box-shadow:0 10px 30px rgba(0,0,0,.3)}h1{background:linear-gradient(90deg,#a855f7,#00d9ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:30px;text-align:center;font-size:1.8em;letter-spacing:1px}.inp{width:100%;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--inp-bg);color:var(--text);margin-bottom:20px;box-sizing:border-box;font-size:1.1em;transition:all .3s}.inp:focus{outline:none;border-color:#a855f7;background:rgba(0,0,0,.4)}.btn{width:100%;background:linear-gradient(90deg,#a855f7,#00d9ff);color:#fff;border:none;padding:16px;border-radius:12px;cursor:pointer;font-weight:600;font-size:1.2em;transition:transform .2s,opacity .2s;height:48px;display:flex;align-items:center;justify-content:center}.btn:active{transform:scale(.98);opacity:.9}.err{background:rgba(239,68,68,.15);color:#ef4444;padding:12px;border-radius:10px;margin-bottom:20px;text-align:center;font-size:.95em;border:1px solid rgba(239,68,68,.2)}@media(max-width:480px){.btn{height:48px;padding:0;font-size:1.1em}.t-btn{width:44px;height:44px}}</style></head><body><div class="wrap"><div class="top-btns"><div class="t-btn" id="themeBtn" onclick="toggleTheme()" title="切换主题"><svg height="18" viewBox="0 0 24 24" width="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg></div><a href="https://github.com/lzban8/ech-cli-tool" target="_blank" class="t-btn" title="GitHub"><svg height="18" viewBox="0 0 16 16" width="18" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg></a></div><div class="c"><h1>ECH Workers管理面板</h1>' + errHtml + '<input type="password" class="inp" id="k" placeholder="输入 Token"><button class="btn" onclick="login()">登录</button></div></div><script>var sun="☼",moon="☾";function toggleTheme(){var h=document.documentElement,t=h.getAttribute("data-theme")==="dark"?"light":"dark";h.setAttribute("data-theme",t);document.getElementById("themeBtn").innerHTML=t==="dark"?moon:sun;localStorage.setItem("theme",t)}var st=localStorage.getItem("theme");if(st){document.documentElement.setAttribute("data-theme",st);document.getElementById("themeBtn").innerHTML=st==="dark"?moon:sun}else{document.getElementById("themeBtn").innerHTML=moon}function login(){var k=document.getElementById("k").value;if(k)location.href="/?key="+encodeURIComponent(k)}document.getElementById("k").addEventListener("keypress",function(e){if(e.key==="Enter")login()})</script></body></html>';
}

function pageAdmin(host, token, proxyIP) {
  var optionsHtml = '';
  for (var i = 0; i < PROXYIP_OPTIONS.length; i++) {
    var opt = PROXYIP_OPTIONS[i];
    optionsHtml += '<div class="opt" onclick="setIP(\'' + opt.ip + '\')"><span class="rg">' + opt.region + '</span><span class="ip">' + opt.ip + '</span></div>';
  }

  var html = '';

  html += '<!DOCTYPE html><html data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>ECH Workers管理面板</title>';
  html += '<style>:root{--bg:#1a1a2e;--card-bg:rgba(255,255,255,.06);--text:#e8e8e8;--sub:#9ca3af;--title:#a855f7;--primary:linear-gradient(90deg,#a855f7,#00d9ff);--btn-bg:rgba(255,255,255,.08);--border:rgba(255,255,255,.08);--info-bg:rgba(243,156,18,.12);--info-text:#ffc107;--inp-bg:rgba(0,0,0,.3);--u-cyan:#00d9ff;--u-green:#22c55e;--u-orange:#f59e0b}[data-theme="light"]{--bg:#f8fafc;--card-bg:#fff;--text:#1e293b;--sub:#64748b;--title:#7c3aed;--primary:linear-gradient(90deg,#7c3aed,#06b6d4);--btn-bg:rgba(0,0,0,.04);--border:rgba(0,0,0,.08);--info-bg:rgba(245,158,11,.08);--info-text:#d97706;--inp-bg:rgba(0,0,0,.03);--u-cyan:#0891b2;--u-green:#16a34a;--u-orange:#ca8a04}*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,system-ui,sans-serif;background:var(--bg);min-height:100vh;padding:16px;color:var(--text);transition:background .3s,color .3s;overflow-x:hidden}.c{max-width:520px;margin:0 auto;position:relative}.hd{text-align:center;padding:20px 0 25px}.hd h1{font-size:1.5em;background:var(--primary);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px;display:flex;align-items:center;justify-content:center;gap:12px}.hs-inline{font-size:.5em;padding:4px 10px;border-radius:8px;background:var(--card-bg);border:1px solid var(--border);font-weight:600;color:#22c55e;-webkit-text-fill-color:initial}.hd p{color:var(--sub);font-size:.85em}.top-btns{position:absolute;top:0;right:0;display:flex;gap:10px;align-items:center}.t-btn{background:var(--card-bg);border:1px solid var(--border);width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text);text-decoration:none;transition:all .2s;font-size:1.2em}.t-btn:hover{transform:scale(1.05);border-color:#a855f7}.stats{display:flex;justify-content:center;margin-bottom:16px}.st{background:var(--card-bg);border-radius:16px;padding:18px 30px;text-align:center;backdrop-filter:blur(10px);border:1px solid var(--border)}.st .n{font-size:1.4em;font-weight:700;color:#22c55e;margin-bottom:4px}.st .l{color:var(--sub);font-size:.8em}.u-card{background:var(--card-bg);border-radius:16px;margin-bottom:16px;overflow:hidden;border:1px solid var(--border)}.u-head{padding:14px 18px;display:flex;align-items:center;justify-content:space-between;cursor:pointer}.u-head:hover{background:rgba(168,85,247,.05)}.u-title{font-size:.95em;font-weight:600;color:var(--text);display:flex;align-items:center;gap:8px}.u-arrow{font-size:.7em;color:var(--sub);transition:transform .3s;display:inline-block}.u-arrow.open{transform:rotate(180deg)}.u-body{padding:18px;display:none;border-top:1px solid var(--border)}.u-body.open{display:block}.u-prog-box{position:relative;width:100%;height:36px;background:var(--inp-bg);border-radius:18px;overflow:hidden;margin-bottom:20px;border:1px solid var(--border)}.u-prog-bar{height:100%;background:linear-gradient(90deg,#22c55e,#06b6d4);box-shadow:0 0 20px rgba(6,182,212,.3);transition:width .5s ease-out}.u-prog-txt{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:.8em;font-weight:600;color:var(--text);z-index:2}.u-prog-txt.warn{color:var(--sub);text-shadow:none}.u-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-radius:12px;overflow:hidden;border:1px solid var(--border);margin-bottom:16px}.u-item{background:var(--card-bg);padding:16px 10px;text-align:center}.u-label{font-size:.65em;color:var(--sub);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}.u-val{font-size:1.15em;font-weight:700;font-family:ui-monospace,monospace}.u-val.cyan{color:var(--u-cyan)}.u-val.green{color:var(--u-green)}.u-val.orange{color:var(--u-orange)}.cfg-btn{background:var(--btn-bg);border:1px dashed var(--border);padding:14px;border-radius:12px;text-align:center;cursor:pointer;color:var(--sub);font-size:.85em;transition:all .2s}.cfg-btn:hover{border-color:#a855f7;color:var(--title)}.u-info{background:var(--info-bg);border-left:3px solid #f59e0b;padding:12px;display:flex;align-items:flex-start;gap:10px;border-radius:0 10px 10px 0}.u-info-icon{font-size:1em}.u-info-txt{font-size:.75em;color:var(--info-text);line-height:1.6}.net-card{background:var(--card-bg);border-radius:16px;margin-bottom:16px;overflow:hidden;border:1px solid var(--border)}.net-head{padding:14px 18px;display:flex;align-items:center;justify-content:space-between;cursor:pointer}.net-head:hover{background:rgba(168,85,247,.05)}.net-title{font-size:.95em;font-weight:600;color:var(--text);display:flex;align-items:center;gap:8px}.net-body{padding:18px;display:none;border-top:1px solid var(--border)}.net-body.open{display:block}.net-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.net-item{background:var(--btn-bg);border-radius:12px;padding:12px 14px;border:1px solid var(--border);transition:all .2s}.net-item:hover{border-color:rgba(168,85,247,.3);background:rgba(168,85,247,.05)}.net-label{font-size:.85em;font-weight:700;color:var(--text);margin-bottom:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.net-desc{font-size:.85em;font-weight:400;opacity:.8}.net-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;animation:pulse 2s infinite}.net-dot.loading{background:#f59e0b}.net-dot.error{background:#ef4444;animation:none}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}.net-ip{font-size:12px;font-weight:400;color:var(--sub);word-break:break-all;line-height:1.4}.net-info{font-size:12px;color:var(--sub);margin-top:4px}.ping-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:14px;padding:12px;background:var(--btn-bg);border-radius:12px;border:1px solid var(--border)}.ping-item{background:var(--card-bg);border-radius:8px;padding:8px 6px;text-align:center;border:1px solid transparent;transition:all .2s}.ping-item:hover{border-color:rgba(168,85,247,.3)}.ping-name{font-size:.7em;display:flex;align-items:center;justify-content:center;gap:3px;margin-bottom:3px;white-space:nowrap}.ping-tag{font-size:.6em;padding:2px 6px;border-radius:4px}.ping-tag.cn{background:rgba(34,197,94,.2);color:#22c55e}.ping-tag.intl{background:rgba(168,85,247,.2);color:#a855f7}.ping-dots{display:flex;justify-content:center;gap:2px;margin:4px 0}.ping-dot{width:5px;height:5px;border-radius:50%;background:var(--sub)}.ping-dot.ok{background:#22c55e}.ping-dot.warn{background:#f59e0b}.ping-dot.err{background:#ef4444}.ping-time{font-weight:700;font-size:.85em}.net-tip{background:var(--info-bg);border-left:3px solid #06b6d4;padding:12px;margin:16px 0;border-radius:0 10px 10px 0;font-size:.75em;color:var(--info-text);line-height:1.6}.net-tip b{color:#06b6d4}.net-link{text-align:center;margin-top:16px;font-size:.75em;color:var(--sub)}.net-link a{color:#06b6d4;text-decoration:none}.net-link a:hover{text-decoration:underline}@media(max-width:768px){.c{padding:0 10px}.hd h1{font-size:1.3em}.net-grid{grid-template-columns:repeat(2,1fr)!important}.u-grid{grid-template-columns:repeat(3,1fr)}.u-val{font-size:1.1em}.ping-grid{grid-template-columns:repeat(2,1fr)}.ping-item{padding:10px 8px}.ping-name{font-size:.65em}.opts{grid-template-columns:1fr}}@media(max-width:480px){.c{padding:0 8px}.hd{padding:65px 0 25px}.hd h1{font-size:1.15em;flex-direction:column;gap:10px}.hs-inline{font-size:.7em}.stats{margin-bottom:12px}.st{padding:14px 24px}.st .n{font-size:1.2em}.net-grid{grid-template-columns:repeat(2,1fr)!important;gap:6px}.net-item{padding:8px 10px}.net-desc{font-size:.75em;opacity:.7;display:block;width:100%}.ping-grid{grid-template-columns:repeat(2,1fr);gap:4px;padding:8px}.ping-item{padding:8px 4px}.ping-name{font-size:.65em;gap:2px}.ping-tag{font-size:.55em;padding:1px 4px}.ping-time{font-size:.85em}.ping-dots{gap:1px}.ping-dot{width:4px;height:4px}.d{padding:14px}.d h2{font-size:.85em}.r{flex-direction:column;align-items:flex-start}.v{width:100%}.opts{grid-template-columns:1fr}.opt{padding:8px}.t-btn{width:36px;height:36px}.top-btns{gap:8px;top:10px;right:10px}.u-grid{gap:0}.u-item{padding:12px 8px}.u-label{font-size:.6em}.u-val{font-size:1em}.u-prog-box{height:32px}.u-prog-txt{font-size:.75em}.cfg-btn{height:48px!important;display:flex;align-items:center;justify-content:center;font-size:.85em}.u-info{padding:10px}.u-info-txt{font-size:.75em}.net-tip{padding:10px;font-size:.7em}.refresh-btn{font-size:.95em}.modal-box{padding:18px;max-height:85vh}.modal h2{font-size:1.1em}.btn,.refresh-btn,.cfg-btn{height:48px!important;display:flex;align-items:center;justify-content:center;padding:0 20px!important}.btn-icon{width:44px;height:44px}}@media(min-width:769px){.c{max-width:780px}body{font-size:16px}.net-grid{grid-template-columns:repeat(3,1fr)!important}.ping-grid{grid-template-columns:repeat(4,1fr)}.ping-item{padding:12px 10px}.ping-name{font-size:.8em}.ping-time{font-size:.95em}.hd h1{font-size:1.8em}.hd p{font-size:.95em}.st{padding:24px 50px}.st .n{font-size:1.6em}.st .l{font-size:.9em}.u-title{font-size:1.05em}.u-val{font-size:1.3em}.u-label{font-size:.75em}.d h2{font-size:1em}.k{font-size:.9em}.v{font-size:.9em}.inp{font-size:1.05em}.btn{font-size:1em;padding:14px}.opt{padding:12px}.rg{font-size:.95em}.ip{font-size:.8em}.net-tip{font-size:.85em}}.d{background:var(--card-bg);border-radius:20px;padding:24px;margin-bottom:20px;border:1px solid var(--border);backdrop-filter:blur(12px);transition:transform .3s}.d:hover{transform:translateY(-2px);border-color:rgba(168,85,247,.3)}.d h2{font-size:1em;color:var(--text);margin-bottom:18px;display:flex;align-items:center;gap:10px;font-weight:700}.d h2:before{content:"";width:4px;height:16px;background:var(--primary);border-radius:4px}.r{display:none}.v-group{background:var(--inp-bg);border-radius:14px;padding:6px;display:flex;align-items:center;gap:10px;margin-bottom:16px;border:1px solid var(--border);transition:all .3s}.v-group:focus-within{border-color:#a855f7;box-shadow:0 0 0 3px rgba(168,85,247,.1)}.v-tag{padding:6px 10px;background:rgba(168,85,247,.1);color:#a855f7;border-radius:8px;font-size:.75em;font-weight:700;white-space:nowrap}.v-val-box{flex:1;font-family:ui-monospace,monospace;font-size:.9em;color:var(--text);padding:4px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.i-group{display:flex;gap:10px;margin-top:12px}.i-group .inp{margin-bottom:0;flex:1}.i-group .btn{width:auto;padding:0 24px;white-space:nowrap}.btn-icon{background:var(--btn-bg);border:1px solid var(--border);color:var(--sub);border-radius:10px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s}.btn-icon:hover{background:rgba(168,85,247,.1);color:#a855f7;border-color:#a855f7}.btn-icon svg{width:18px;height:18px}.clr-icon{color:#ef4444;border-color:rgba(239,68,68,.2)}.clr-icon:hover{background:rgba(239,68,68,.1);color:#ef4444;border-color:#ef4444}.inp{width:100%;padding:14px 16px;border:1px solid var(--border);border-radius:12px;background:var(--inp-bg);color:var(--text);font-size:.95em;transition:all .2s}.inp:focus{outline:none;border-color:#a855f7;background:rgba(168,85,247,.05)}.btn{background:var(--primary);color:#fff;border:none;padding:14px;border-radius:12px;cursor:pointer;width:100%;font-weight:700;font-size:1em;transition:all .3s;box-shadow:0 4px 12px rgba(168,85,247,.2)}.btn:hover{opacity:.9;transform:translateY(-1px);box-shadow:0 6px 16px rgba(168,85,247,.3)}.btn:active{transform:translateY(0)}.btn:disabled{opacity:.4;transform:none;box-shadow:none}.btn.secondary{background:rgba(255,255,255,.08);color:var(--text);border:1px solid var(--border);margin-top:0}.opts{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:18px}.opt{padding:14px;background:var(--btn-bg);border-radius:14px;text-align:center;cursor:pointer;border:1px solid var(--border);transition:all .2s}.opt:hover{border-color:#a855f7;background:rgba(168,85,247,.05);transform:scale(1.02)}.rg{display:block;font-weight:700;color:#06b6d4;font-size:.85em;margin-bottom:4px}.ip{color:var(--sub);font-size:.75em;font-family:ui-monospace,monospace}.msg{padding:12px 16px;border-radius:12px;margin-bottom:16px;font-size:.9em;display:none;backdrop-filter:blur(8px);font-weight:600}.msg.ok{background:rgba(34,197,94,.15);color:#22c55e;display:block;border:1px solid rgba(34,197,94,.2)}.msg.err{background:rgba(239,68,68,.15);color:#ef4444;display:block;border:1px solid rgba(239,68,68,.2)}@media(max-width:600px){.i-group{flex-direction:column}.i-group .btn{width:100%}.opts{grid-template-columns:1fr}}.lo-btn{display:flex;align-items:center;justify-content:center;gap:8px;text-align:center;color:#ef4444;margin-top:30px;padding:12px;border:1px solid rgba(239,68,68,.2);border-radius:12px;text-decoration:none;font-size:.9em;font-weight:600;transition:all .2s;background:rgba(239,68,68,.05)}.lo-btn:hover{background:rgba(239,68,68,.1);border-color:#ef4444;transform:translateY(-1px)}.lo-btn svg{width:18px;height:18px}.log{font-size:.75em;padding:8px;background:var(--btn-bg);border-radius:6px;margin-bottom:6px;line-height:1.4;color:var(--text)}.log .time{color:#06b6d4;font-weight:600}.log .ip{color:var(--sub)}.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);z-index:1000;padding:20px;overflow-y:auto}.modal.show{display:flex;align-items:center;justify-content:center}.modal-box{background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:24px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto}.modal-close{float:right;background:var(--btn-bg);border:1px solid var(--border);color:var(--sub);font-size:1.2em;cursor:pointer;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center}.modal-close:hover{background:rgba(239,68,68,.2);color:#ef4444}.modal h2{clear:both;margin:8px 0 20px;color:var(--title);font-size:1.1em}.ping-avg{font-size:.6em;color:var(--sub)}.refresh-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:12px;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:600;font-size:.85em;margin-top:16px}.refresh-btn:disabled{opacity:.5}</style></head><body>';
  html += '<div class="c"><div class="top-btns"><div class="t-btn" id="themeBtn" onclick="toggleTheme()" title="切换主题"><svg height="18" viewBox="0 0 24 24" width="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-moon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg></div><a href="https://github.com/lzban8/ech-cli-tool" target="_blank" class="t-btn" title="GitHub"><svg height="18" viewBox="0 0 16 16" width="18" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg></a></div><div class="hd"><h1>ECH Workers管理面板 <span id="hs" class="hs-inline">...</span></h1><p>' + host + '</p></div>';
  html += '<div class="u-card"><div class="u-head" onclick="toggleUsageCard()"><div class="u-title">⚡ Workers/Pages 请求次数监控</div><div class="u-arrow open" id="uArrow">▼</div></div><div class="u-body open" id="uBody"><div class="u-prog-box"><div class="u-prog-txt warn" id="uProgTxt">获取配置中...</div><div class="u-prog-bar" id="uProgBar" style="width:0%"></div></div><div class="u-grid"><div class="u-item"><div class="u-label">WORKERS</div><div class="u-val cyan" id="uWorkers">-</div></div><div class="u-item"><div class="u-label">PAGES</div><div class="u-val green" id="uPages">-</div></div><div class="u-item"><div class="u-label">日配额</div><div class="u-val orange">100,000</div></div></div><div class="cfg-btn" onclick="showCfgModal()">⚙️ Cloudflare API 配置</div><div class="u-info" style="margin-top:16px"><div class="u-info-icon">ℹ️</div><div class="u-info-txt" id="uInfo">北京时间 08:00 重置</div></div></div></div>';
  html += '<div class="net-card"><div class="net-head" onclick="toggleNetCard()"><div class="net-title">🌐 网络检测</div><div class="u-arrow open" id="netArrow">▼</div></div><div class="net-body open" id="netBody"><div class="net-grid" style="grid-template-columns:repeat(3,1fr)"><div class="net-item" data-type="cn"><div class="net-label"><span class="net-dot loading" id="dot1"></span>国内出口</div><div class="net-ip ip-addr" id="ip1">IP: 检测中...</div><div class="net-info"><span id="loc1">-</span></div><div class="net-info"><span id="isp1">-</span></div></div><div class="net-item" data-type="intl"><div class="net-label"><span class="net-dot loading" id="dot2"></span>国外出口 <span class="net-desc">(访问非CF CDN站点的优选IP)</span></div><div class="net-ip ip-addr" id="ip2">IP: 检测中...</div><div class="net-info"><span id="loc2">-</span></div><div class="net-info"><span id="isp2">-</span></div></div><div class="net-item" data-type="intl"><div class="net-label"><span class="net-dot loading" id="dot6"></span>CF ProxyIP <span class="net-desc">(访问CF CDN站点的反代IP)</span></div><div class="net-ip ip-addr" id="ip6">IP: 检测中...</div><div class="net-info"><span id="loc6">-</span></div><div class="net-info"><span id="isp6">-</span></div></div><div class="net-item" data-type="intl"><div class="net-label"><span class="net-dot loading" id="dot4"></span>X.com</div><div class="net-ip ip-addr" id="ip4">IP: 检测中...</div><div class="net-info"><span id="loc4">-</span></div><div class="net-info"><span id="isp4">-</span></div></div><div class="net-item" data-type="intl"><div class="net-label"><span class="net-dot loading" id="dot5"></span>ChatGPT</div><div class="net-ip ip-addr" id="ip5">IP: 检测中...</div><div class="net-info"><span id="loc5">-</span></div><div class="net-info"><span id="isp5">-</span></div></div><div class="net-item" data-type="intl"><div class="net-label"><span class="net-dot loading" id="dot3"></span>IP.SB</div><div class="net-ip ip-addr" id="ip3">IP: 检测中...</div><div class="net-info"><span id="loc3">-</span></div><div class="net-info"><span id="isp3">-</span></div></div></div>';
  html += '<div class="ping-grid">';
  html += '<div class="ping-item" data-type="cn"><div class="ping-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="#00d2ff"><rect x="2" y="10" width="4" height="10" rx="1" /><rect x="8" y="6" width="4" height="14" rx="1" /><rect x="14" y="2" width="4" height="18" rx="1" /><rect x="20" y="8" width="4" height="12" rx="1" /></svg> 字节跳动<span class="ping-tag cn">国内</span></div><div class="ping-time" id="pt1">-</div><div class="ping-dots" id="pd1"></div></div>';
  html += '<div class="ping-item" data-type="cn"><div class="ping-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="#00a1d6"><rect x="2" y="4" width="20" height="14" rx="2" /><circle cx="9" cy="11" r="2" fill="#fff" /><circle cx="15" cy="11" r="2" fill="#fff" /></svg> Bilibili<span class="ping-tag cn">国内</span></div><div class="ping-time" id="pt2">-</div><div class="ping-dots" id="pd2"></div></div>';
  html += '<div class="ping-item" data-type="cn"><div class="ping-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="#07c160"><path d="M8.5 6C4.9 6 2 8.7 2 12c0 1.8.9 3.4 2.3 4.5L4 19l2.7-1.4c.6.2 1.2.3 1.8.3 3.6 0 6.5-2.7 6.5-6S12.1 6 8.5 6zm7 10c-.3 0-.5 0-.8-.1.5-.8.8-1.7.8-2.6 0-3.3-3.1-6-7-6.3.4-2.8 3.2-5 6.5-5 3.6 0 6.5 2.5 6.5 5.5 0 1.6-.8 3-2 4l.2 2-2-1c-.5.2-1.1.3-1.7.3l-.5.1z" /></svg> 微信<span class="ping-tag cn">国内</span></div><div class="ping-time" id="pt3">-</div><div class="ping-dots" id="pd3"></div></div>';
  html += '<div class="ping-item" data-type="cn"><div class="ping-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="#ff5000"><path d="M5.5 21h13c.8 0 1.5-.7 1.5-1.5v-11c0-.8-.7-1.5-1.5-1.5h-4l-1-2h-3l-1 2h-4c-.8 0-1.5.7-1.5 1.5v11c0 .8.7 1.5 1.5 1.5zm6.5-11c2.2 0 4 1.8 4 4s-1.8 4-4 4-4-1.8-4-4 1.8-4 4-4z" /></svg> 淘宝<span class="ping-tag cn">国内</span></div><div class="ping-time" id="pt4">-</div><div class="ping-dots" id="pd4"></div></div>';
  html += '<div class="ping-item" data-type="intl"><div class="ping-name"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg> GitHub<span class="ping-tag intl">国际</span></div><div class="ping-time" id="pt5">-</div><div class="ping-dots" id="pd5"></div></div>';
  html += '<div class="ping-item" data-type="intl"><div class="ping-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="#4285f4"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34a853" /><path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" fill="#fbbc05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#ea4335" /></svg> Google<span class="ping-tag intl">国际</span></div><div class="ping-time" id="pt6">-</div><div class="ping-dots" id="pd6"></div></div>';
  html += '<div class="ping-item" data-type="intl"><div class="ping-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="#f38020"><path d="M16.5 12.5c0-1.6-1.3-2.8-2.8-2.8-.9 0-1.8.5-2.3 1.2l-.5-.3c.1-.2.1-.4.1-.6 0-1.1-.9-2-2-2s-2 .9-2 2c0 .2 0 .4.1.6l-.5.3c-.5-.8-1.4-1.2-2.3-1.2-1.6 0-2.8 1.3-2.8 2.8 0 .9.5 1.8 1.2 2.3l-.3.5c-.2-.1-.4-.1-.6-.1-1.1 0-2 .9-2 2s.9 2 2 2c.2 0 .4 0 .6-.1l.3.5c-.8.5-1.2 1.4-1.2 2.3 0 1.6 1.3 2.8 2.8 2.8.9 0 1.8-.5 2.3-1.2l.5.3c-.1.2-.1.4-.1.6 0 1.1.9 2 2 2s2-.9 2-2c0-.2 0-.4-.1-.6l.5-.3c.5.8 1.4 1.2 2.3 1.2 1.6 0 2.8-1.3 2.8-2.8 0-.9-.5-1.8-1.2-2.3l.3-.5c.2.1.4.1.6.1 1.1 0 2-.9 2-2s-.9-2-2-2c-.2 0-.4 0-.6.1l-.3-.5c.7-.5 1.2-1.4 1.2-2.3z" /></svg> Cloudflare<span class="ping-tag intl">国际</span></div><div class="ping-time" id="pt7">-</div><div class="ping-dots" id="pd7"></div></div>';
  html += '<div class="ping-item" data-type="intl"><div class="ping-name"><svg width="14" height="14" viewBox="0 0 24 24" fill="#ff0000"><path d="M23 9.7c0-.2-.1-.4-.2-.6-.3-.5-1-1.1-2.4-1.1H3.6c-1.4 0-2.1.6-2.4 1.1-.1.2-.2.4-.2.6v4.6c0 .2.1.4.2.6.3.5 1 1.1 2.4 1.1h16.8c1.4 0 2.1-.6 2.4-1.1.1-.2.2-.4.2-.6V9.7z" /><path d="M9.5 14.2V9.8l5 2.2-5 2.2z" fill="#fff" /></svg> YouTube<span class="ping-tag intl">国际</span></div><div class="ping-time" id="pt8">-</div><div class="ping-dots" id="pd8"></div></div>';
  html += '</div>';
  html += '<div class="net-tip">💡 <b>国内出口</b> 由分流规则决定，<b>国外出口</b> 由优选 IP 决定，<b>CF、X推特、ChatGPT等CF CDN站点</b> 由您的ProxyIP决定。</div>';
  html += '<button class="refresh-btn" onclick="runAllTests()" id="refreshBtn">🔄 重新检测</button></div></div>';
  html += '<div class="d"><h2>服务地址</h2><div id="sm" class="msg"></div><div class="v-group"><div class="v-tag">WORKER</div><div class="v-val-box" id="vh" onclick="copy(\'' + host + ':443\')">' + host + ':443</div><div class="btn-icon" onclick="copy(\'' + host + ':443\')" title="复制"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></div></div></div><div class="d"><h2>Token</h2><div id="tm" class="msg"></div><div class="v-group"><div class="v-tag">当前</div><div class="v-val-box v" onclick="copy(\'' + token + '\')">' + token + '</div><div class="btn-icon" onclick="copy(\'' + token + '\')" title="复制"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></div></div><div class="i-group"><input type="text" class="inp" id="ti" placeholder="输入新 Token"><button class="btn" onclick="saveT()">保存配置</button></div></div><div class="d"><h2>反代地址</h2><div id="pm" class="msg"></div><div class="v-group"><div class="v-tag">当前</div><div class="v-val-box v" onclick="copy(\'' + (proxyIP || 'proxyip.cmliussss.net') + '\')">' + (proxyIP || 'proxyip.cmliussss.net') + '</div><div class="btn-icon clr-icon" onclick="clearP()" title="恢复默认"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg></div></div><div class="i-group"><input type="text" class="inp" id="pi" placeholder="输入反代地址" value=""><button class="btn" onclick="saveP()">保存配置</button></div><div class="opts">' + optionsHtml + '</div></div><a href="/" class="lo-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg> 退出登录</a></div><div id="cfgModal" class="modal"><div class="modal-box"><button class="modal-close" onclick="closeCfgModal()">&times;</button><h2>Cloudflare API 配置</h2><p style="font-size:0.8em;color:var(--sub);margin-bottom:12px;">用于获取 Workers/Pages 的当日请求数配额监控。</p><p style="font-size:0.7em;color:var(--sub);margin-bottom:4px;">Account ID (路径: Workers & Pages > 概述 > 右侧)</p><input type="text" class="inp" id="aid" placeholder="Account ID" style="margin-bottom:12px"><p style="font-size:0.7em;color:var(--sub);margin-bottom:4px;">API Token (路径: 右上角头像 > 配置文件 > API 令牌 > 创建令牌 > 使用「阅读分析数据和日志」)</p><input type="password" class="inp" id="atk" placeholder="Global API Key / API Token"><div class="i-group" style="margin-top:20px"><button class="btn secondary" onclick="closeCfgModal()">取消</button><button class="btn" onclick="saveCF()">保存配置</button></div></div></div>';
  html += '<script>';
  html += 'var K="' + token + '";var currTotal=0;var sun="☼",moon="☾";';
  html += 'function toggleTheme(){var h=document.documentElement,t=h.getAttribute("data-theme")==="dark"?"light":"dark";h.setAttribute("data-theme",t);document.getElementById("themeBtn").innerHTML=t==="dark"?moon:sun;localStorage.setItem("theme",t)}';
  html += 'var st=localStorage.getItem("theme");if(st){document.documentElement.setAttribute("data-theme", st);document.getElementById("themeBtn").innerHTML=st==="dark"?moon:sun}else{document.getElementById("themeBtn").innerHTML = moon}';
  html += 'function copy(t){navigator.clipboard.writeText(t).then(function () { alert("已复制") })}';
  html += 'function setIP(ip){document.getElementById("pi").value = ip}';
  html += 'function showCfgModal(){document.getElementById("cfgModal").classList.add("show")}';
  html += 'function closeCfgModal(){document.getElementById("cfgModal").classList.remove("show")}';
  html += 'function saveT(){var b=document.querySelectorAll(".d")[1].querySelector(".btn"),m=document.getElementById("tm"),t=document.getElementById("ti").value;if(!t){alert("请输入 Token");return}b.disabled=true;fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:K,token:t})}).then(function(r){return r.json()}).then(function(d){m.className = d.success ? "msg ok" : "msg err";m.textContent=d.success?"保存成功！":"错误: "+d.error;if(d.success){K = t;document.getElementById("ti").value="";var v=document.querySelectorAll(".d")[1].querySelector(".v");if(v)v.textContent=t}}).catch(function(e){alert(e.message)}).finally(function(){b.disabled = false;setTimeout(function(){m.className = "msg"},1000)})}';
  html += 'function saveP(sMsg){var b=document.querySelectorAll(".d")[2].querySelector(".btn"),m=document.getElementById("pm"),p=document.getElementById("pi").value;if(!p&&!sMsg){alert("请输入反代地址");return}b.disabled=true;fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:K,proxyIP:p})}).then(function(r){return r.json()}).then(function(d){m.className = d.success ? "msg ok" : "msg err";m.textContent=d.success?(sMsg||"保存成功！"):"错误: "+d.error;if(d.success){document.getElementById("pi").value = "";var v=document.querySelectorAll(".d")[2].querySelector(".v");if(v)v.textContent=p||"proxyip.cmliussss.net"}}).catch(function(e){alert(e.message)}).finally(function(){b.disabled = false;setTimeout(function(){m.className = "msg"},1000)})}';
  html += 'function clearP(){document.getElementById("pi").value = "";saveP("恢复默认设置成功")}';
  html += 'function toggleUsageCard(){var body=document.getElementById("uBody"),arr=document.getElementById("uArrow");body.classList.toggle("open");arr.classList.toggle("open")}';
  html += 'function toggleNetCard(){var body=document.getElementById("netBody"),arr=document.getElementById("netArrow");body.classList.toggle("open");arr.classList.toggle("open")}';
  html += 'function updateResetTime(total){if(total!==undefined)currTotal=total;var now=new Date(),target=new Date(now);target.setUTCHours(0,0,0,0);if(now.getUTCHours()>=0)target.setUTCDate(target.getUTCDate()+1);var diff=target-now,h=Math.floor(diff/36e5),m=Math.floor(diff%36e5/6e4),s=Math.floor(diff%6e4/1e3);h=(h<10?"0":"")+h;m=(m<10?"0":"")+m;s=(s<10?"0":"")+s;document.getElementById("uInfo").innerHTML="重置倒计时: <b>"+h+"</b>时 <b>"+m+"</b>分 <b>"+s+"</b>秒 (北京时间 8:00) | 今日使用请求总计: <b>"+currTotal.toLocaleString()+"</b>"}';
  html += 'function updateUsageUI(data){var pct=data.percentage,txtEl=document.getElementById("uProgTxt");txtEl.textContent=data.total.toLocaleString()+" / 100,000 ("+pct+"%)";txtEl.classList.remove("warn");var bar=document.getElementById("uProgBar");if(bar)bar.style.width=pct+"%";document.getElementById("uWorkers").textContent=data.workers.toLocaleString();document.getElementById("uPages").textContent=data.pages.toLocaleString();currTotal=data.total;updateResetTime()}';
  html += 'function verifyCF(oAid,oAtk){var aid=oAid||document.getElementById("aid").value,atk=oAtk||document.getElementById("atk").value,txtEl=document.getElementById("uProgTxt");if(!aid||!atk){txtEl.textContent = "未配置 CloudFlare API";txtEl.classList.add("warn");return}fetch("/api/cf/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:K,accountId:aid,apiToken:atk})}).then(function(r){return r.json()}).then(function(d){if(d.success){updateUsageUI(d.data);if(!oAid)alert("✅ 验证成功")}else{if(!oAid)alert("验证失败: "+(d.error||"未知错误"));txtEl.textContent="API 配置验证失败";txtEl.classList.add("warn")}}) .catch(function(e){console.error(e);txtEl.textContent = "网络请求失败 ("+e.message+")";txtEl.classList.add("warn")})}';
  html += 'function saveCF(){var aid=document.getElementById("aid").value,atk=document.getElementById("atk").value;if(!aid||!atk){alert("请填写完整");return}fetch("/api/cf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:K,accountId:aid,apiToken:atk})}).then(function(r){return r.json()}).then(function(d){if(d.success){alert("✅ 配置已保存");verifyCF(aid,atk);closeCfgModal()}else alert("保存失败")})}';
  html += 'function updateIP(id,ip,loc,isp,asn,success){document.getElementById("ip" + id).innerHTML = "IP: <b style=\'color:var(--text);font-weight:600;font-family:ui-monospace,monospace\'>" + ip + "</b>";document.getElementById("loc"+id).textContent="国家: "+(loc||"-");document.getElementById("isp"+id).textContent="运营商: "+(isp||"-");document.getElementById("dot"+id).className="net-dot"+(success?"":" error")}';
  html += 'function measureLatency(url,id,count){count = count || 8;var results=[],completed=0,dotsEl=document.getElementById("pd"+id),timeEl=document.getElementById("pt"+id);var dotsHtml="";for(var i=0;i<count;i++){dotsHtml += "<span class=\'ping-dot\'></span>"}dotsEl.innerHTML=dotsHtml;function runOne(index){var start=Date.now();var img=new Image();img.onload=function(){var ms=Date.now()-start;results[index]=ms;updateDot(index,ms);checkComplete()};img.onerror=function(){results[index] = -1;updateDot(index,-1);checkComplete()};img.src=url+(url.indexOf("?")>-1?"&":"?")+"_t="+Date.now()+"_"+index}function updateDot(index,ms){var dots=dotsEl.querySelectorAll(".ping-dot");if(dots[index]){if(ms<0){dots[index].className = "ping-dot err"}else if(ms<100){dots[index].className = "ping-dot ok"}else if(ms<300){dots[index].className = "ping-dot warn"}else{dots[index].className = "ping-dot err"}}}function checkComplete(){completed++;if(completed>=count){var validResults=results.filter(function(r){return r>0});if(validResults.length>0){var avg=Math.round(validResults.reduce(function(a,b){return a+b},0)/validResults.length);timeEl.innerHTML=avg+"<span class=\'ping-avg\'>ms</span>"}else{timeEl.textContent = "超时"}}}for(var i=0;i<count;i++){(function (idx) { setTimeout(function () { runOne(idx) }, idx * 200) })(i)}}';
  html += 'function lookupIPv2(ip,id){if(!ip||ip==="-"||ip==="超时")return;fetch("https://api.ipapi.is?q="+ip).then(function(r){return r.json()}).then(function(d){var loc=(d.location&&d.location.country?d.location.country:"")+" "+(d.location&&d.location.city?d.location.city:"");var isp=d.company&&d.company.name?d.company.name:(d.asn&&d.asn.org?d.asn.org:"-");document.getElementById("loc"+id).textContent="国家: "+loc.trim();document.getElementById("isp"+id).textContent="运营商: "+isp}).catch(function(){ })}';
  html += 'function lookupIP(ip,id){if(!ip||ip==="-"||ip==="超时")return;fetch("https://api.ip.sb/geoip/"+ip).then(function(r){return r.json()}).then(function(d){var loc=(d.country||"")+" "+(d.city||"");var isp=d.isp||d.organization||"-";document.getElementById("loc"+id).textContent="国家: "+loc.trim();document.getElementById("isp"+id).textContent="运营商: "+isp}).catch(function(){ })}';
  html += 'function checkIPs(){fetch("https://api-v3.speedtest.cn/ip?_t=" + Date.now()).then(function (r) { return r.json() }).then(function (d) { var ip = d.data && d.data.ip ? d.data.ip : (d.ip || "-"); var loc = (d.data && d.data.province ? d.data.province : "") + " " + (d.data && d.data.isp ? d.data.isp : ""); updateIP(1, ip, (d.data && d.data.province ? d.data.province : "") + " " + (d.data && d.data.city ? d.data.city : ""), d.data && d.data.isp ? d.data.isp : "-", "-", true); window.cnIP = ip }).catch(function () { updateIP(1, "超时", "-", "-", "-", false) });fetch("https://api.ipapi.is").then(function(r){return r.json()}).then(function(d){var theIP=d.ip||"-";var loc=(d.location&&d.location.country?d.location.country:"")+" "+(d.location&&d.location.city?d.location.city:"");var isp=d.company&&d.company.name?d.company.name:(d.asn&&d.asn.org?d.asn.org:"-");updateIP(2,theIP,loc.trim(),isp,"-",true);window.cfIP=theIP}).catch(function(){updateIP(2, "超时", "-", "-", "-", false)});fetch("https://api-ipv4.ip.sb/geoip").then(function(r){return r.json()}).then(function(d){updateIP(3, d.ip || "-", (d.country || "") + " " + (d.region || "") + " " + (d.city || ""), d.isp || d.organization || "-", d.asn ? "AS" + d.asn : "-", true)}).catch(function(){updateIP(3, "超时", "-", "-", "-", false)});fetch("https://x.com/cdn-cgi/trace").then(function(r){return r.text()}).then(function(t){var ip=t.match(/ip=(.+)/);var loc=t.match(/loc=(.+)/);var colo=t.match(/colo=(.+)/);var theIP=ip?ip[1]:"-";updateIP(4,theIP,loc?loc[1]:"-","-","-",true);lookupIP(theIP,4)}).catch(function(){updateIP(4, "超时", "-", "-", "-", false)});fetch("https://chat.openai.com/cdn-cgi/trace").then(function(r){return r.text()}).then(function(t){var ip=t.match(/ip=(.+)/);var loc=t.match(/loc=(.+)/);var colo=t.match(/colo=(.+)/);var theIP=ip?ip[1]:"-";updateIP(5,theIP,loc?loc[1]:"-","-","-",true);lookupIP(theIP,5)}).catch(function(){updateIP(5, "超时", "-", "-", "-", false)});fetch("https://cloudflare.com/cdn-cgi/trace").then(function(r){return r.text()}).then(function(t){var ip=t.match(/ip=(.+)/);var loc=t.match(/loc=(.+)/);var colo=t.match(/colo=(.+)/);var theIP=ip?ip[1]:"-";updateIP(6,theIP,loc?loc[1]:"-","-","-",true);lookupIP(theIP,6)}).catch(function(){updateIP(6, "超时", "-", "-", "-", false)})}';
  html += 'function checkLatency(){var tests=[{url:"https://www.douyin.com/favicon.ico",id:1},{url:"https://www.bilibili.com/favicon.ico",id:2},{url:"https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico",id:3},{url:"https://img.alicdn.com/favicon.ico",id:4},{url:"https://github.githubassets.com/favicons/favicon.svg",id:5},{url:"https://www.google.com/favicon.ico",id:6},{url:"https://www.cloudflare.com/favicon.ico",id:7},{url:"https://www.youtube.com/favicon.ico",id:8}];tests.forEach(function(t){measureLatency(t.url, t.id, 8)})}';
  html += 'function runAllTests(){var btn=document.getElementById("refreshBtn");btn.disabled=true;btn.textContent="⏳ 检测中...";window.cnIP=null;window.cfIP=null;checkIPs();checkLatency();loadCFData();setTimeout(function(){btn.disabled = false;btn.textContent="🔄 重新检测"},5000)}';
  html += 'function initHealth(){document.getElementById("hs").textContent = "● 服务运行中"}';
  html += 'function loadCFData(){var txtEl=document.getElementById("uProgTxt");fetch("/api/cf?key="+encodeURIComponent(K)).then(function(r){return r.json()}).then(function(d){if(d.accountId&&d.apiToken){verifyCF(d.accountId, d.apiToken)}else{txtEl.textContent = "未配置 CloudFlare API";txtEl.classList.add("warn")}}).catch(function(){txtEl.textContent = "获取配置失败";txtEl.classList.add("warn")})}';
  html += 'initHealth();loadCFData();runAllTests();setInterval(updateResetTime,1000)</script></body ></html > ';
  return html;
}
async function handleSession(webSocket, proxyIP) {
  let remoteSocket, remoteWriter, remoteReader;
  let isClosed = false;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    try { remoteWriter?.releaseLock(); } catch { }
    try { remoteReader?.releaseLock(); } catch { }
    try { remoteSocket?.close(); } catch { }
    remoteWriter = remoteReader = remoteSocket = null;
    safeCloseWebSocket(webSocket);
  };

  const pumpRemoteToWebSocket = async () => {
    try {
      while (!isClosed && remoteReader) {
        const { done, value } = await remoteReader.read();
        if (done) break;
        if (webSocket.readyState !== WS_READY_STATE_OPEN) break;
        if (value?.byteLength > 0) webSocket.send(value);
      }
    } catch { }
    if (!isClosed) {
      try { webSocket.send('CLOSE'); } catch { }
      cleanup();
    }
  };

  const parseAddress = (addr) => {
    if (addr[0] === '[') {
      const end = addr.indexOf(']');
      return { host: addr.substring(1, end), port: parseInt(addr.substring(end + 2), 10) };
    }
    const sep = addr.lastIndexOf(':');
    return { host: addr.substring(0, sep), port: parseInt(addr.substring(sep + 1), 10) };
  };

  const isCFError = (err) => {
    const msg = err?.message?.toLowerCase() || '';
    return msg.includes('proxy request') || msg.includes('cannot connect') || msg.includes('cloudflare');
  };

  const connectToRemote = async (targetAddr, firstFrameData) => {
    const { host, port } = parseAddress(targetAddr);
    const attempts = [null];
    if (proxyIP) {
      proxyIP.split(',').forEach(ip => {
        const trimmed = ip.trim();
        if (trimmed) attempts.push(trimmed);
      });
    }
    attempts.push(...DEFAULT_PROXYIP_LIST);
    attempts.push(...CF_FALLBACK_IPS);

    for (let i = 0; i < attempts.length; i++) {
      try {
        let connectHost = host;
        let connectPort = port;
        if (attempts[i]) {
          const proxyAddr = attempts[i];
          if (proxyAddr.includes(':')) {
            const proxyParsed = parseAddress(proxyAddr);
            connectHost = proxyParsed.host;
          } else {
            connectHost = proxyAddr;
          }
        }
        remoteSocket = connect({ hostname: connectHost, port: connectPort });
        if (remoteSocket.opened) await remoteSocket.opened;
        remoteWriter = remoteSocket.writable.getWriter();
        remoteReader = remoteSocket.readable.getReader();
        if (firstFrameData) await remoteWriter.write(encoder.encode(firstFrameData));
        webSocket.send('CONNECTED');
        pumpRemoteToWebSocket();
        return;
      } catch (err) {
        try { remoteWriter?.releaseLock(); } catch { }
        try { remoteReader?.releaseLock(); } catch { }
        try { remoteSocket?.close(); } catch { }
        remoteWriter = remoteReader = remoteSocket = null;
        if (!isCFError(err) || i === attempts.length - 1) throw err;
      }
    }
  };

  webSocket.addEventListener('message', async (event) => {
    if (isClosed) return;
    try {
      const data = event.data;
      if (typeof data === 'string') {
        if (data.startsWith('CONNECT:')) {
          const sep = data.indexOf('|', 8);
          await connectToRemote(data.substring(8, sep), data.substring(sep + 1));
        } else if (data.startsWith('DATA:')) {
          if (remoteWriter) await remoteWriter.write(encoder.encode(data.substring(5)));
        } else if (data === 'CLOSE') {
          cleanup();
        }
      } else if (data instanceof ArrayBuffer && remoteWriter) {
        await remoteWriter.write(new Uint8Array(data));
      }
    } catch (err) {
      try { webSocket.send('ERROR:' + err.message); } catch { }
      cleanup();
    }
  });

  webSocket.addEventListener('close', cleanup);
  webSocket.addEventListener('error', cleanup);
}

function safeCloseWebSocket(ws) {
  try {
    if (ws.readyState === WS_READY_STATE_OPEN || ws.readyState === WS_READY_STATE_CLOSING) {
      ws.close(1000, 'Server closed');
    }
  } catch { }
}

async function verifyCFAPI(accountId, apiToken) {
  try {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `query getBillingMetrics($accountId: String!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) {
      viewer {accounts(filter: {accountTag: $accountId}) {
      pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: $filter) {sum {requests} }
    workersInvocationsAdaptive(limit: 10000, filter: $filter) {sum {requests} }
          } }
        }`,
        variables: {
          accountId: accountId,
          filter: {
            datetime_geq: now.toISOString(),
            datetime_leq: new Date().toISOString()
          }
        }
      })
    });

    if (!response.ok) {
      return { success: false, error: 'API请求失败: ' + response.status };
    }

    const result = await response.json();
    if (result.errors?.length) {
      return { success: false, error: result.errors[0].message };
    }

    const acc = result?.data?.viewer?.accounts?.[0];
    if (!acc) {
      return { success: false, error: '未找到账户数据' };
    }

    const pages = acc.pagesFunctionsInvocationsAdaptiveGroups?.reduce((t, i) => t + (i?.sum?.requests || 0), 0) || 0;
    const workers = acc.workersInvocationsAdaptive?.reduce((t, i) => t + (i?.sum?.requests || 0), 0) || 0;
    const total = pages + workers;

    return {
      success: true,
      data: {
        pages: pages,
        workers: workers,
        total: total,
        limit: 100000,
        percentage: ((total / 100000) * 100).toFixed(2)
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}