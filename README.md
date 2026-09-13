# MudraID Node enforcement adapter

A framework-neutral decision core and authenticated authority client for MCP Streamable HTTP tool calls. It is also the decision core used by the MudraID sidecar.

## Scope

Protected tool calls require verified configuration and a signed live decision. MCP transport/session requests (`GET`, `HEAD`, `OPTIONS`, `DELETE`) and control/discovery messages (`initialize`, `ping`, `tools/list`) do not receive a tool authorization decision; the host must enforce its normal HTTP/OAuth authentication. For ordinary REST APIs, use route/scope middleware.

## Authority client

`HttpAuthority` accepts the MudraID HTTPS origin, a registered adapter credential and the exact platform/environment/resource binding. It verifies signed configuration, active version/digest, time windows and signed decisions. Adapter credentials remain separate from caller OAuth tokens. Requests and response sizes and timeouts are bounded; decisions are not retried.

Each `decide` call receives the exact body bytes, content type, HTTP method/path and caller authorization. Its signed execution digest binds those inputs and the action/mapping/scopes/configuration. Missing, expired, tampered or mismatched decisions fail closed. The host must own the request snapshot and forward only those authorized bytes; the decision client cannot control application code that ignores its result. The sidecar implements that snapshot and forwarding boundary.

The binding establishes the requested operation. It does not establish independent business facts, such as account ownership or an approved beneficiary, or prove a committed business execution. Trusted business-fact profiles/projection and live deployment qualification remain pending.

## Control loop and testing seams

The package exports `evaluateV2`, `shouldForward`, the request/decision types, reserved-header stripping helpers and the authenticated authority client. The existing function name is an API identifier, not a separate product choice. `staticDecideClient` and `throwingDecideClient` are test seams; they must not replace authenticated authority in a deployed enforcement path.

Missing or stale configuration, an unmapped tool, framing errors, denied authority and authority outages refuse protected calls. The host must prevent direct upstream access that would bypass enforcement.

## Development and distribution

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The package builds compiled JavaScript and TypeScript declarations. Release checks inspect the actual tarball and its installed entry points. Publication remains gated by the protected environment and the package's support record; a local test pass is not a publication receipt.

Framework-specific Express/Fastify hooks, durable execution receipts and broader deployment/chaos qualification remain separate work. See [SECURITY.md](./SECURITY.md) for private reporting and [LICENSE](./LICENSE) for Apache-2.0 terms.
