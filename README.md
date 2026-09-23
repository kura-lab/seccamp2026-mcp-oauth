# Seccamp 2026 MCP OAuth

MCP OAuth apps

## How to run locally

### Prerequisite

* npm 12.0.2
* node v26.7.0
* Keycloak 26.7.1
* OpenJDK 25+

### Install

```shell
npm i
```

### Start Keycloak

```shell
# mac/Linux
./bin/kc.sh start-dev --http-port 18080 --features=cimd
```

```shell
# Windows
.\bin\kc.bat start-dev --http-port 18080 --features=cimd
```

* http://localhost:18080

### Start MCP Server and Client

```shell
# Terminal 1
node mcp-server.js
```

```shell
# Terminal 2
node mcp-client.js
```
