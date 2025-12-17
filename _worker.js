const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

// ==================== PROXYIP 配置 ====================
// 用于解决 CF-to-CF 连接限制（访问 Cloudflare CDN 站点时需要）
// 格式: 'hostname' 或 'hostname:port'（默认端口 443）
// 留空则禁用 PROXYIP 功能
// 可配置多个，用逗号分隔，会按顺序尝试
const PROXYIP = '';  // 例如: 'proxyip.cmliussss.net' 或 'proxyip.fxxk.dedyn.io'

// 默认公共 PROXYIP 列表（当 PROXYIP 为空时使用）
const DEFAULT_PROXYIP_LIST = [
  'proxyip.cmliussss.net',      // cmliu 维护的公共 proxyIP
  'proxyip.fxxk.dedyn.io',      // fxxk 维护的公共 proxyIP
];

// CF Fallback IPs（通常是 CF 自己的 IPv6，效果有限）
const CF_FALLBACK_IPS = ['[2a00:1098:2b::1:6815:5881]'];

// 复用 TextEncoder，避免重复创建
const encoder = new TextEncoder();

import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request, env, ctx) {
    try {
      const token = '';
      const upgradeHeader = request.headers.get('Upgrade');

      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new URL(request.url).pathname === '/'
          ? new Response('WebSocket Proxy Server', { status: 200 })
          : new Response('Expected WebSocket', { status: 426 });
      }

      if (token && request.headers.get('Sec-WebSocket-Protocol') !== token) {
        return new Response('Unauthorized', { status: 401 });
      }

      const [client, server] = Object.values(new WebSocketPair());
      server.accept();

      handleSession(server).catch(() => safeCloseWebSocket(server));

      // 修复 spread 类型错误
      const responseInit = {
        status: 101,
        webSocket: client
      };

      if (token) {
        responseInit.headers = { 'Sec-WebSocket-Protocol': token };
      }

      return new Response(null, responseInit);

    } catch (err) {
      return new Response(err.toString(), { status: 500 });
    }
  },
};

async function handleSession(webSocket) {
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
      return {
        host: addr.substring(1, end),
        port: parseInt(addr.substring(end + 2), 10)
      };
    }
    const sep = addr.lastIndexOf(':');
    return {
      host: addr.substring(0, sep),
      port: parseInt(addr.substring(sep + 1), 10)
    };
  };

  const isCFError = (err) => {
    const msg = err?.message?.toLowerCase() || '';
    return msg.includes('proxy request') ||
      msg.includes('cannot connect') ||
      msg.includes('cloudflare');
  };

  const connectToRemote = async (targetAddr, firstFrameData) => {
    const { host, port } = parseAddress(targetAddr);

    // 构建尝试列表：直连 -> 用户 PROXYIP -> 默认 PROXYIP -> CF_FALLBACK
    const attempts = [null]; // null 表示直连目标

    // 添加用户配置的 PROXYIP
    if (PROXYIP) {
      PROXYIP.split(',').forEach(ip => {
        const trimmed = ip.trim();
        if (trimmed) attempts.push(trimmed);
      });
    }

    // 添加默认公共 PROXYIP 列表
    attempts.push(...DEFAULT_PROXYIP_LIST);

    // 最后添加 CF Fallback IPs
    attempts.push(...CF_FALLBACK_IPS);

    for (let i = 0; i < attempts.length; i++) {
      try {
        // 解析连接目标
        let connectHost = host;
        let connectPort = port;

        if (attempts[i]) {
          // 使用 PROXYIP 作为跳板，但保持原始目标端口
          const proxyAddr = attempts[i];
          if (proxyAddr.includes(':')) {
            // 带端口的 PROXYIP
            const proxyParsed = parseAddress(proxyAddr);
            connectHost = proxyParsed.host;
            // 对于 PROXYIP，使用原始目标端口（443）而非 PROXYIP 自己的端口
          } else {
            connectHost = proxyAddr;
          }
        }

        remoteSocket = connect({
          hostname: connectHost,
          port: connectPort
        });

        if (remoteSocket.opened) await remoteSocket.opened;

        remoteWriter = remoteSocket.writable.getWriter();
        remoteReader = remoteSocket.readable.getReader();

        // 发送首帧数据
        if (firstFrameData) {
          await remoteWriter.write(encoder.encode(firstFrameData));
        }

        webSocket.send('CONNECTED');
        pumpRemoteToWebSocket();
        return;

      } catch (err) {
        // 清理失败的连接
        try { remoteWriter?.releaseLock(); } catch { }
        try { remoteReader?.releaseLock(); } catch { }
        try { remoteSocket?.close(); } catch { }
        remoteWriter = remoteReader = remoteSocket = null;

        // 如果不是 CF 错误或已是最后尝试，抛出错误
        if (!isCFError(err) || i === attempts.length - 1) {
          throw err;
        }
        // 否则继续尝试下一个 PROXYIP
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
          await connectToRemote(
            data.substring(8, sep),
            data.substring(sep + 1)
          );
        }
        else if (data.startsWith('DATA:')) {
          if (remoteWriter) {
            await remoteWriter.write(encoder.encode(data.substring(5)));
          }
        }
        else if (data === 'CLOSE') {
          cleanup();
        }
      }
      else if (data instanceof ArrayBuffer && remoteWriter) {
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
    if (ws.readyState === WS_READY_STATE_OPEN ||
      ws.readyState === WS_READY_STATE_CLOSING) {
      ws.close(1000, 'Server closed');
    }
  } catch { }
}
