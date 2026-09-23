const express = require('express');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

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

function createMcpServer()  {
  // MCP サーバーの初期化
  const server = new McpServer({
    name: 'sample-oauth-mcp-server',
    version: '1.0.0',
  });

  // ツールの定義
  server.tool(
    'get_greeting',
    '指定した名前への挨拶文を生成します',
    {
      name: z.string().default('ゲスト').describe('対象の名前'),
    },
    async ({ name }) => {
      return {
        content: [
          {
            type: 'text',
            text: `[MCP SDK] こんにちは、${name}さん！Keycloak認証による認可が完了しました。`,
          },
        ],
      }
    }
  );

  return server;
}

// ステートレスな単一のPOSTエンドポイント
app.post('/messages', verifyToken, async (req, res) => {
    try {
    // リクエストごとにトランスポートとサーバーを作成
    const transport = new StreamableHTTPServerTransport();
    const server = createMcpServer();

    // 接続のセットアップ
    await server.connect(transport);

    // リクエストの処理とレスポンス送信
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

app.listen(SERVER_PORT, () => {
  console.log(`[MCP Server] http://localhost:${SERVER_PORT}/messages で起動しました。`);
});
