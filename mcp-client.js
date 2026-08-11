const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const app = express();
const CLIENT_PORT = 3000;
const SERVER_PORT = 8000;

const KEYCLOAK_URL = 'http://localhost:18080';
const REALM = 'mcp-realm';
const AUTH_ENDPOINT = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth`;
const TOKEN_ENDPOINT = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`;

const CLIENT_ID_URL = `http://localhost:${CLIENT_PORT}/client-metadata.json`;
const REDIRECT_URI = `http://localhost:${CLIENT_PORT}/callback`;
const MCP_SERVER_RESOURCE = `http://localhost:${SERVER_PORT}`;

let codeVerifier = '';

// 1. CIMD (Client ID Metadata Document) の配布
app.get('/client-metadata.json', (req, res) => {
  res.json({
    client_id: CLIENT_ID_URL,
    client_name: "MCP Client App",
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"]
  });
});

// 2. 認可フロー開始 (PKCE + CIMD)
app.get('/login', (req, res) => {
  codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('client_id', CLIENT_ID_URL);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.append('code_challenge', codeChallenge);
  authUrl.searchParams.append('code_challenge_method', 'S256');
  authUrl.searchParams.append('scope', 'openid mcp:tools');
  authUrl.searchParams.append('resource', MCP_SERVER_RESOURCE);

  res.redirect(authUrl.toString());
});

// 3. コールバック処理と MCP SDK による接続
app.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Authorization code is missing');
  }

  try {
    // トークン交換
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID_URL,
      code: code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier
    });

    const tokenResponse = await axios.post(TOKEN_ENDPOINT, tokenParams, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const accessToken = tokenResponse.data.access_token;

    // --- MCP SDK による通信確立 ---
    const sseUrl = new URL(`${MCP_SERVER_RESOURCE}/sse`);
    
    // トランスポート層の初期化（Authorizationヘッダーへトークンを設定）
    const transport = new SSEClientTransport(sseUrl, {
      eventSourceInit: {
        headers: { Authorization: `Bearer ${accessToken}` }
      },
      requestInit: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    });

    const mcpClient = new Client(
      { name: "sample-mcp-client", version: "1.0.0" },
      { capabilities: {} }
    );

    // MCPサーバーへ接続
    await mcpClient.connect(transport);

    // ツール一覧の取得 (MCP SDK API)
    const toolsList = await mcpClient.listTools();

    // ツールの実行 (MCP SDK API)
    const toolResult = await mcpClient.callTool({
      name: "get_greeting",
      arguments: { name: "Keycloak User" }
    });

    // 通信の終了処理
    await mcpClient.close();

    res.send(`
      <h1>MCP SDK 通信成功</h1>
      <h2>取得したツール一覧:</h2>
      <pre>${JSON.stringify(toolsList, null, 2)}</pre>
      <h2>ツール実行結果:</h2>
      <pre>${JSON.stringify(toolResult, null, 2)}</pre>
    `);
  } catch (error) {
    console.error('エラー発生:', error);
    res.status(500).send(`エラーが発生しました: ${error.message}`);
  }
});

app.listen(CLIENT_PORT, () => {
  console.log(`[MCP Client] http://localhost:${CLIENT_PORT} で起動しました。`);
  console.log(`[MCP Client] ログインは http://localhost:${CLIENT_PORT}/login にアクセスしてください。`);
});
