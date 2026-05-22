# PeerDrop

Peer-to-peer file transfer between two desktop browsers, with a 6-digit verification
code that catches an active man-in-the-middle on the signaling broker.

Live demo: https://michaelansel.github.io/scan2share/ (repo will be renamed to `PeerDrop`
later; the URL will follow).

## How it works

1. Each desktop loads the static site and is given a 6-character peer-id like `XK7-Q4M`.
2. One user types the other's peer-id into the **Connect to** box.
3. The two browsers exchange WebRTC signaling messages via the public PeerJS broker.
4. A **commit-then-reveal** exchange (similar to ZRTP) binds each side's DTLS fingerprint
   to a value committed *before* anyone has seen the other side's key material — so an
   active broker cannot grind a fingerprint substitution that produces a matching code.
5. Both screens display the same 6-digit Short Authenticated String (SAS) computed from
   the exchanged commitments, fingerprints, and nonces.
6. Users compare the two screens, click **I have compared this SAS with the other device
   and they match** on each side, and the drag-and-drop file zone opens.
7. Files transfer directly between the two browsers over an end-to-end DTLS-encrypted
   WebRTC DataChannel. The broker is no longer in the path.

## Threat model

**In scope** (defenses):

- Passive eavesdroppers on the broker hop and beyond.
- An actively malicious PeerJS broker: SDP-fingerprint substitution, forged commits or
  reveals, message reordering, forged `confirm` messages.
- Peer-id squatting / dial races on the public broker (the squatted side hard-stops and
  the SAS comparison still catches MITM).
- Replay of stale signaling messages across sessions or roles.

**Out of scope** (residual risks):

- A compromised browser endpoint on either host.
- Supply-chain compromise of the deployed JS bundle. Mitigation: bundle everything via
  Vite so the only runtime origin is GitHub Pages; require branch-protection on `main`.
- A user who clicks **Confirm** without actually comparing the SAS codes on both screens.
- A user who follows a hostile link with a `?broker=` override pointing at an attacker
  broker. Mitigation: the production bundle does not contain the override-parsing code
  at all (Vite's `define` injects `false` and dead-code elimination removes the branch).
- Long-term identity continuity (TOFU pinning across sessions) — not implemented in v1.
- Networks where symmetric NAT prevents direct WebRTC. No TURN is configured.

For the protocol details and proof of why a 6-digit code is unforgeable under this
threat model, see `/root/.claude/plans/create-this-proposed-application-velvety-muffin.md`
(the design plan stored alongside the work).

## Run locally

```
pnpm install
pnpm dev               # starts Vite on http://localhost:5173
```

Open two windows side by side; PeerJS connects to the public broker by default.

To run against a local in-process broker:

```
node --import tsx tests/e2e/fixtures/broker.ts &  # or use the Playwright fixture
pnpm dev -- --port 4173
# then visit http://localhost:4173/?broker=ws://127.0.0.1:9743/myapp
```

The `?broker=` URL override only works in **dev** builds. In `pnpm build` (production)
the parser is stripped at build time.

## Run tests

Unit suite (no browser):

```
pnpm test:unit
```

End-to-end suite (boots an in-process PeerJS broker + Vite dev server + Chromium):

```
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

The unit suite covers:

- `peerid.test.ts` — Crockford alphabet, length, normalization.
- `commit.test.ts` / `sas.test.ts` — commit binding, SAS determinism, role-based ordering,
  known-answer vectors.
- `fingerprint.test.ts` / `canonical.test.ts` — SDP ↔ canonical-hex round-trip, NIST SHA-256
  test vectors.
- `chunker.test.ts` / `protocol.test.ts` / `sender-receiver.test.ts` — file-transfer
  framing, sliding-window send, loopback round-trip with sha256 match.
- `messages.test.ts` — wire schema validation.
- `state.test.ts` — pairing state machine: commit-mismatch abort, remote-SDP-fp mismatch
  abort, duplicate-message abort, per-state timeout, forged-confirm cannot enable
  transfer, idempotent confirm-twice, peer-initiated abort.
- `components.test.ts` — verbatim Confirm-button copy, leading-zero SAS rendering,
  peer-id pair rendering.

The E2E suite covers:

- `pair-and-confirm.spec.ts` — two browsers pair, both display the same 6-digit SAS,
  both display the peer-id pair, click Confirm, drop-zone unlocks.
- `transfer.spec.ts` — send a 1 KiB file; receiver sha256 matches sender sha256.
- `mitm-abort.spec.ts` — squat / hard-stop UI.
- `cancel-paths.spec.ts` — closing one tab cleanly aborts the other.

## Deployment

`./.github/workflows/deploy.yml` runs on push to `main`:

1. Install, typecheck, unit + E2E tests.
2. `vite build` with the production base path (`/scan2share/` until the repo is renamed).
3. Verify the `?broker=` override parser was tree-shaken out.
4. Upload + deploy to GitHub Pages via `actions/deploy-pages@v4`.

Branch protection on `main` is recommended (require PR review, require CI green,
require linear history) and is left to the repo owner to configure.

## Repo rename checklist (when `scan2share` → `PeerDrop`)

1. `vite.config.ts`: change `REPO_BASE` from `/scan2share/` to `/PeerDrop/`.
2. `README.md`: update the deployed URL.
3. `package.json`: update `repository.url` (the package `name` is already `peerdrop`).
4. Update the GitHub Pages settings in the repo to keep `main` as the source.
5. **No crypto changes needed.** Domain strings `peerdrop/commit/v1` / `peerdrop/sas/v1`
   are independent of the repo name.

## License

MIT
