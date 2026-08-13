# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Report it privately to
**security@mudraid.ai**, and we will acknowledge within **2 business days**.

Please include, as far as you can establish it:

- what an attacker can do — the effect, not only the flaw;
- the version you tested, and how you installed it;
- a reproduction, or the smallest thing that shows the behaviour.

You will get a substantive reply, not only an acknowledgement: what we
reproduced, what we could not, and what we intend to do. If we disagree that
something is a vulnerability we will say so and explain why, rather than letting
the report go quiet.

We will not pursue legal action over good-faith research that stays within your
own accounts and data, does not degrade the service for others, and does not
access or retain anyone else's information.

## What is in scope

This repository — the adapter's decision core and the wiring it documents.

The MudraID service it talks to is a separate system with the same contact
address, and a report about one is welcome under the other; we would rather
route it ourselves than have you guess which it belongs to.

**`@mudraid/sidecar` is a different package with its own policy.** It hosts
this decision core inside a reverse proxy; a report about the proxying — what
gets forwarded, header handling on the wire, upstream reachability — belongs
there. Both addresses are the same, so a misrouted report is not a lost one.

## What this package does and does not do

Worth stating plainly, because a report is often about the difference. This is
the framework-neutral **enforcement decision core**: the typed V2 decision
vocabulary, the control loop (`evaluateV2`), and the injectable `/decide` seam.

- Its decisions are **deny-closed**. No active bundle, an unavailable or
  malformed `/decide` answer, an unmapped action, an oversized or malformed
  tool name, a framing violation — every one of these must produce a decision
  that `shouldForward` refuses. **Any input under which the control loop yields
  a forwardable decision without a bound V2 allow is a vulnerability**, and is
  the class of report we most want.
- `shouldForward` is the single yes/no the host consults. **A decision object
  that answers differently to `shouldForward` than its outcome states is a
  vulnerability.**
- Reserved trusted-context headers (`RESERVED_HEADER_PREFIX`) exist so an
  upstream can trust what the enforcement layer asserted. The loop instructs
  hosts to strip caller-supplied values via `normalizeStrippedHeaders` /
  `isReservedHeader`; **a route by which a caller-controlled reserved header
  survives normalization is a vulnerability.**
- It performs **no network I/O and holds no credentials** in this slice. The
  `/decide` client is an injected seam; the packaged clients are the static and
  throwing test doubles. It never logs the facts it evaluates.
- It does **not** implement the topology guarantee. Where the host embeds this
  loop, the host decides what traffic reaches it; a way *around* the host is a
  report for the host's policy (for the sidecar, see that package).

## Supported versions

Maturity and support for every published version are declared in the MudraID
adapter support matrix (the `support-matrix.json` excerpt shipped beside this
package names this package's row). Report against the latest published version
where you can, and say which version you tested where you cannot.
