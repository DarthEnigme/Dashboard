# Task: let Claude manage Dashboard tasks through MCP (no Anthropic API)

**Status (2026-11-18):** Phases 1 and 2 are built, tested and committed on branch `tasks-mcp`, with a PR open against `main`. Claude Code works now (Tasks → **Connect Claude** → token). What's left is the exposure step, which needs your own infrastructure:
1. Put NanoDash behind a Cloudflare Tunnel or Tailscale Funnel (the README has both, and a path-limited `cloudflared` config).
2. Set `auth.baseUrl` to the public HTTPS address.
3. In claude.ai, **Settings → Connectors → Add custom connector** with `https://<public>/api/mcp`, then **Allow** on NanoDash's consent page.
4. Run the Phase 2 checks under "Verification" below against the real claude.ai (not done yet: it needs the public address).

**Decisions already made:**
- Claude reaches the tasks **over HTTP with a token**, through the running Dashboard. It does not write to SQLite directly.
- It must work from **Claude Code and from claude.ai** (web and phone), so Phase 2 (OAuth and public HTTPS) is in scope.

## Context
Claude should be able to create, edit and move tasks in the Task app on the Claude subscription, without a paid Anthropic API key.

The way to do that is for the Dashboard to **host an MCP server**. Claude Code and claude.ai custom connectors both run the subscription's Claude and call the tools the server exposes. The Dashboard never calls Claude, so no API key is involved.

What exists today:
- Tasks are stored in SQLite (`data/page.db`) and each one belongs to a user. The logic is in `src/lib/tasks/`:
  - `items.ts`: addTask / updateTask / deleteTask
  - `boards.ts`, `parts.ts`
  - `store.ts`: loadBoard
- The `/api/tasks/*` routes go through `guardFor("tasks")`, which leads to `guardPermission` (`src/lib/auth/index.ts:163`). It only accepts the session cookie or proxy headers.
- API tokens already exist (`src/lib/auth/tokens.ts`):
  - They look like `page_…` and only their SHA-256 hash is stored.
  - `verifyToken` only accepts tokens owned by an admin.
  - Only `/api/export/metrics` uses them.
- There is no MCP server, CLI or OAuth provider yet.

## Phase 1: `/api/mcp` with bearer tokens (Claude Code works)
- [x] **Token scopes.** Add a migration that gives `api_tokens` a `scope TEXT NOT NULL DEFAULT 'metrics'` column.
  - Change `verifyToken(header, scope)`: a `metrics` token stays admin-only; a `tasks` token works for any enabled user who has the `tasks` permission.
  - Make `/api/export/metrics/route.ts:12` pass `"metrics"`.
  - Let `TokensPanel.tsx` and `/api/tokens` create tasks-scoped tokens. Each user can make their own; admins can still list and revoke all of them.
- [x] **MCP route** in `src/app/api/mcp/route.ts`:
  - Use `@modelcontextprotocol/sdk` with the Streamable HTTP transport in stateless mode. It is a web-standard Request/Response handler, which fits a Next.js route.
  - Handle POST, plus GET and DELETE as the spec requires.
  - Find the user from the `Authorization: Bearer` header with `verifyToken(h, "tasks")`. Without a valid token, return 401 with a `WWW-Authenticate` header (Phase 2 needs it).
- [x] **Tools** in `src/lib/mcp/tasks-tools.ts`. Each tool calls the existing store functions with the token's user id and checks its input with zod (already a dependency), so the rules match the UI.
  - `list_boards` and `get_board(board?)` wrap `loadBoard` and return a compact board: columns, lanes, and tasks with their ids.
  - `add_task(column, title, body?, priority?, due?, labels?, lane?, checklist?, repeat?)` wraps `addTask`.
  - `update_task(id, …fields)` wraps `updateTask`.
  - `move_task(id, column, lane?, index?)` reuses the move logic that PATCH uses in `api/tasks/items/route.ts`.
  - `delete_task(id)` wraps `deleteTask`.
  - `task_summary` uses the same logic as `summary/route.ts`.
  - Optional, later: create, edit and delete columns, lanes and boards through `parts.ts` and `boards.ts`.
- [x] **Connect Claude Code:**
  ```
  claude mcp add --transport http dashboard http://<host>:3000/api/mcp --header "Authorization: Bearer page_…"
  ```
  A board already open in the browser won't update live; Claude's changes show on the next refresh or poll.

## Phase 2: OAuth plus a public HTTPS address (claude.ai works)
claude.ai custom connectors connect from Anthropic's servers. So the Dashboard has to be reachable over public HTTPS, and it has to support MCP's OAuth flow, because claude.ai doesn't accept a pasted bearer header.
- [x] **Discovery endpoints:**
  - `/.well-known/oauth-protected-resource` names the Dashboard as the authorization server.
  - `/.well-known/oauth-authorization-server` serves the server metadata.
  - Build their URLs from `publicOrigin()` (`auth/index.ts:184`) and `settings.auth.baseUrl`.
- [x] **`/api/oauth/register`:** dynamic client registration, with clients kept in a new `oauth_clients` table.
- [x] **`/api/oauth/authorize`:**
  - Reuse the existing login. A signed-out user goes to sign-in and comes back afterwards.
  - Show a small consent page: "Allow Claude to manage your tasks?"
  - Issue a short-lived code tied to the PKCE challenge (S256 only).
- [x] **`/api/oauth/token`:**
  - Trade the code for a tasks-scoped `page_` token.
  - Create it through the same `createToken` code, so it appears in Settings → Tokens and can be revoked there.
  - Refresh tokens are optional. Long-lived tokens that can be revoked are enough to start.
- [ ] **Exposure** (your step; see Status):
  - Put the Dashboard behind a Cloudflare Tunnel or Tailscale Funnel to `:3000`.
  - Set `settings.auth.baseUrl` to the public URL.
  - Add a custom connector in claude.ai at `https://<public>/api/mcp`.
  - Only `/api/mcp`, `/.well-known/*`, `/api/oauth/*` and the sign-in pages need to be public. Limit the tunnel to those paths if it supports path rules.

## Files
- **New:**
  - `src/app/api/mcp/route.ts`
  - `src/lib/mcp/tasks-tools.ts`
  - `src/app/.well-known/*/route.ts`
  - `src/app/api/oauth/{register,authorize,token}/route.ts`
  - the OAuth consent page
  - a migration for the token scope column and the OAuth tables
- **Changed:**
  - `src/lib/auth/tokens.ts`
  - `src/app/api/export/metrics/route.ts`
  - `src/app/api/tokens/route.ts`
  - `src/components/settings/TokensPanel.tsx`
  - `package.json` (add `@modelcontextprotocol/sdk`)
  - README (setup steps)

## Verification
- **Unit tests** (vitest, in the style of `tests/v14-tasks.test.ts`):
  - Token scopes: a metrics token is refused for tasks, a tasks token is refused for metrics, and a non-admin user can hold a tasks token.
  - Each tool round-trips against a temporary `HOMEPAGE_DATA_DIR`.
  - User A's token can't see or edit user B's boards.
- **Protocol:** point `npx @modelcontextprotocol/inspector` at `http://localhost:3000/api/mcp` with the bearer header. List the tools, then add, move and delete a task, and check each change in the UI.
- **Claude Code:** after `claude mcp add`, ask Claude to "add a task 'test' to To do, due Friday" and check the board.
- **Phase 2:**
  - Run the inspector's OAuth flow against the tunnel URL.
  - Add the connector in claude.ai and approve the consent page.
  - Create a task from the claude.ai phone app.
  - Check that the token appears in Settings → Tokens and that revoking it cuts off access.
- **Regression:** `npm run lint`, `npm test`, `npm run e2e` (tasks.spec).

## What was built
- **Phase 1:**
  - Token scopes (migration 7).
  - `/api/mcp` with 10 tools: `list_boards`, `get_board`, `get_task`, `search_tasks`, `add_task`, `update_task`, `move_task`, `complete_task`, `delete_task`, `task_summary`.
  - The **Connect Claude** dialog in Tasks.
  - Tests: `tests/tasks-mcp.test.ts`, plus e2e in `tasks.spec.ts`.
- **Phase 2:**
  - OAuth clients and codes (migration 8). The logic lives in `src/lib/oauth/server.ts`.
  - Discovery under `/.well-known/`.
  - Consent page at `/oauth/authorize`, which posts to `/api/oauth/authorize`.
  - Sign-in can return to `?next=` (password, 2FA and SSO).
  - Tests: `tests/oauth.test.ts`, plus two e2e flows in `tasks.spec.ts`.
- **Verified:**
  - lint, 547 unit tests, build, and the full e2e suite (123 tests);
  - a manual run of the OAuth flow with curl against a dev server.
