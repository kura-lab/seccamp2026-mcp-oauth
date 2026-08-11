const express = require('express');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const app = express();
app.use(express.json());

const SERVER_PORT = 8000;
const KEYCLOAK_URL = 'http://localhost:18080';
const REALM = 'mcp-realm';
const JWKS_URL = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/certs`;
const MCP_SERVER_RESOURCE = `http://localhost:${SERVER_PORT}`;

// KeycloakのJWKS設定
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

// Keycloakトークン検証ミドルウェア
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Bearerトークンが存在しません' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${KEYCLOAK_URL}/realms/${REALM}`,
      audience: MCP_SERVER_RESOURCE
    });

    if (!payload.scope || !payload.scope.includes('mcp:tools')) {
      return res.status(403).json({ error: '必要なスコープ (mcp:tools) が不足しています' });
    }

    req.user = payload;
    next();
  } catch (err) {
    console.error('トークン検証エラー:', err.message);
    return res.status(401).json({ error: 'トークンが無効です' });
  }
}

// 1. MCP SDK サーバーインスタンスの生成
const mcpServer = new Server(
  { name: 'sample-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// 利用可能なツールの定義ハンドラー
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_greeting',
        description: '指定した名前への挨拶文を生成します',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '対象の名前' }
          },
          required: ['name']
        }
      }
    ]
  };
});

// ツール実行ハンドラー
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'get_greeting') {
    const name = request.params.arguments?.name || 'ゲスト';
    return {
      content: [
        {
          type: 'text',
          text: `[MCP SDK] こんにちは、${name}さん！Keycloak認証による認可が完了しました。`
        }
      ]
    };
  }
  throw new Error('指定されたツールが存在しません');
});

// ActiveなSSEトランスポートのセッション管理
const transports = {};

// 2. SSE エンドポイント（保護対象）
app.get('/sse', verifyToken, async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;

  req.on('close', () => {
    delete transports[transport.sessionId];
  });

  await mcpServer.connect(transport);
});

// 3. Message エンドポイント（保護対象）
app.post('/messages', verifyToken, async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];

  if (transport) {
    await transport.handlePostMessage(req, res, req.body);
  } else {
    res.status(400).send('有効なセッションが見つかりません');
  }
});

app.listen(SERVER_PORT, () => {
  console.log(`[MCP Server] http://localhost:${SERVER_PORT} で起動しました。`);
});
