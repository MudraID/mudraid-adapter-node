# `@mudraid/adapter-node` — framework-neutral enforcement decision core

The portable TypeScript/Node implementation of the MudraID **adapter-decision
V2** control loop (EP-120-US-05, first slice). It is the decision core other
adapters host: given the facts of a request, it yields a typed decision, and
`shouldForward(decision)` is the single yes/no a host consults before letting
the request proceed.

> **What this loop decides, and what it does not. Read this before hosting it.**
>
> MudraID V2 provides live action authorization for MCP Streamable HTTP tool
> calls. MCP transport and session requests remain subject to the MCP server's
> normal HTTP/OAuth authentication. For ordinary REST APIs, use MudraID's
> route/scope middleware, which enforces the configured HTTP method and
> route—including GET and DELETE.
>
> Concretely: `evaluateV2` treats `GET`/`HEAD`/`OPTIONS` as Streamable-HTTP
> transport and `DELETE` as MCP session control, and calls `/decide` for
> neither; MCP control and discovery messages (`initialize`, `ping`,
> `tools/list`) pass a protected surface without a `/decide` verdict. A host
> that points this loop at an ordinary REST surface is not authorizing that
> surface's reads and deletes.

## The non-negotiable property: deny-closed

Every path that is not a bound V2 **allow** yields a decision that
`shouldForward` refuses: no active bundle, a `/decide` seam that is
unavailable or answers malformedly, an unmapped action, an invalid or
oversized tool name, a framing violation, an explicit deny. An unconfigured
loop **denies**; it does not fail open.

## Public surface

- **Typed vocabulary** (`types.ts`): `Decision`, `Outcome`, `AdapterCode`,
  `ReasonTier`, `RequestFacts`, `DecideClient`/`DecideResult`/`DecideStatus`,
  `TrustedContextHeader`, plus the pinned
  `ADAPTER_DECISION_CONTRACT_VERSION`, `MAX_TOOL_NAME_LEN` and
  `RESERVED_HEADER_PREFIX` constants.
- **Control loop** (`controlLoop.ts`): `evaluateV2`, `shouldForward`,
  `newDecisionId`, `validToolName`, and the reserved-header discipline —
  `isReservedHeader` / `normalizeStrippedHeaders`, so caller-supplied values
  for trusted-context headers never survive into evaluation or forwarding.
- **`/decide` seam** (`decideClient.ts`): the decision service is an injected
  `DecideClient`. This slice ships `staticDecideClient` and
  `throwingDecideClient` as test doubles; the real HTTP client is a deferred
  remainder, named below.

## What is deliberately not here (yet)

The framework hooks (Express/Fastify/MCP middleware), the real HTTP `/decide`
client, and live fact extraction are **deferred remainders** of this first
slice. The package performs no network I/O and holds no credentials.

## Who consumes it

`@mudraid/sidecar` — the customer-hosted enforcing reverse proxy — hosts this
loop as its decision core. Application-embedded framework adapters are the
intended later consumers.

## Development

```bash
npm ci
npm test            # vitest, includes packaging guards
npm run build       # tsc -p tsconfig.build.json → dist/
```

The packaging tests hold `package.json` to the version the MudraID adapter
support matrix declares for `@mudraid/adapter-node`, and the tarball
inspector (`.github/inspect_tarball.mjs`) proves the published artifact
carries exactly the promised contents.

## Security

See [SECURITY.md](./SECURITY.md). Report privately to **security@mudraid.ai**;
never through a public issue.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
