# End-to-End Encryption

Status: Draft v0.1
Date: 2026-10-01

## Overview

Loom reuses the end-to-end encryption specification from [ds-harness-remote](https://github.com/liguobao/ds-harness-remote/blob/main/docs/end-to-end-encryption.md). This document describes how that specification applies in the Loom context.

## Cipher suite

```
Noise_IK_25519_ChaChaPoly_SHA256
```

- Key agreement: X25519
- Symmetric cipher: ChaCha20-Poly1305 (AEAD)
- Hash: SHA-256
- Key derivation: HKDF-SHA256

## Roles in Loom

| Noise role | Loom role | Description |
|---|---|---|
| Initiator | Observer | Knows the Host's static public key. Initiates the handshake. |
| Responder | Host | Owns the DSH session. Accepts or denies the handshake. |

In DSH Remote, the initiator is the Client controlling its own Host. In Loom, the initiator is an Observer from a different user account watching someone else's Host.

## Handshake

The Noise IK pattern:

```
← s
...
→ e, es, s, ss
← e, ee, se
```

1. Observer generates an ephemeral key pair.
2. Observer sends Init message: `e(32B) || enc_s(32B+16B tag) || enc_payload`.
3. Host decrypts, verifies Observer's static key against local allowlist.
4. Host generates ephemeral key pair.
5. Host sends Response message: `e(32B) || enc_payload`.
6. Both sides derive transport keys via `split()`.
7. Initiator (Observer): `sendKey = k1, recvKey = k2`.
8. Responder (Host): `sendKey = k2, recvKey = k1`.

## Transport

After handshake completion:

- Each direction uses an independent monotonic nonce counter (uint64, big-endian, 12 bytes with 4 leading zero bytes).
- Nonce is prepended to each ciphertext message as a 12-byte header.
- Nonce must never repeat for the same key. Counter starts at 0 and increments by 1 after each message.
- Messages with out-of-order or repeated nonces must be rejected.

## Key lifecycle

- Each device generates a static X25519 key pair on first registration. The private key is stored locally and never transmitted.
- The static public key is registered with the Server and pinned to the device identity.
- The Server must not accept a replacement static key for the same device ID.
- Ephemeral key pairs are generated fresh for each handshake and discarded after `split()`.

## Server visibility

The Server can observe:

- Who is connected to whom (device IDs, user IDs).
- Connection timestamps and durations.
- Message sizes and frequency.
- Control channel frames (auth, presence, observer request/accept/deny).

The Server **cannot** read:

- Conversation content (prompts, responses, agent output).
- Tool call arguments and results.
- Terminal input/output.
- File paths and file contents.
- Workspace directory structure.
- Source code.

## Security limits

- Loom does not implement forward secrecy beyond the ephemeral key in each handshake. Compromising a device's static key allows decryption of past recorded ciphertext if an attacker captured it.
- The Server is trusted for routing but not for content. A compromised Server can deny service or misroute connections, but cannot decrypt business traffic.
- Observer identity verification relies on the Host locally pinning the Observer's static public key. If the Host has never verified the Observer's key, a man-in-the-middle attack is possible at the Server level. This mirrors the trust model of SSH `known_hosts`.
- The `@loom/crypto` implementation uses audited `@noble/*` libraries but has not itself undergone a formal security audit.

## Reference

For the full Noise IK specification, DH sequence, and implementation details, see:

- [ds-harness-remote/docs/end-to-end-encryption.md](https://github.com/liguobao/ds-harness-remote/blob/main/docs/end-to-end-encryption.md)
- [Noise Protocol Framework](https://noiseprotocol.org/noise.html)
- [@noble/curves](https://github.com/paulmillr/noble-curves)
- [@noble/ciphers](https://github.com/paulmillr/noble-ciphers)
