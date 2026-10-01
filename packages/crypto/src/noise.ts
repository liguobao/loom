/**
 * 简化版 Noise IK 握手协议实现
 * 规格: Noise_IK_25519_ChaChaPoly_SHA256
 *
 * IK 含义:
 *   I = 发起方静态公钥在握手消息中发送（响应方已知）
 *   K = 响应方静态公钥已知（发起方提前知道）
 *
 * 握手流程:
 *   发起方 -> 响应方: e, es, s, ss  (InitMessage)
 *   响应方 -> 发起方: e, ee, se     (ResponseMessage)
 *   握手完成后双方各持 sendKey / recvKey 进行传输加密
 */

import { x25519 } from '@noble/curves/ed25519'
import { chacha20poly1305 } from '@noble/ciphers/chacha'
import { sha256 } from '@noble/hashes/sha256'
import { hkdf } from '@noble/hashes/hkdf'
import { randomBytes } from '@noble/hashes/utils'
import type { KeyPair } from './keys.js'

// ---- 常量 ----------------------------------------------------------------

const PROTOCOL_NAME = 'Noise_IK_25519_ChaChaPoly_SHA256'
const HASH_LEN = 32   // SHA-256 输出字节数
const KEY_LEN  = 32   // ChaCha20 密钥字节数
const TAG_LEN  = 16   // Poly1305 认证标签字节数
const NONCE_LEN = 12  // ChaCha20-Poly1305 nonce 字节数

// ---- 公开类型 -------------------------------------------------------------

export interface NoiseState {
  handshakeComplete: boolean
  /** 本端发送方向使用的密钥 */
  sendKey: Uint8Array
  /** 本端接收方向使用的密钥 */
  recvKey: Uint8Array
  /** 握手结束时的 handshake hash（可用于 channel binding） */
  handshakeHash: Uint8Array
  /** 发送 nonce 计数器（每次加密递增） */
  sendNonce: number
  /** 接收 nonce 计数器（每次解密递增） */
  recvNonce: number
}

export interface InitiatorHandshake {
  /** 生成发给响应方的握手初始消息（含可选 payload） */
  createInitMessage(payload?: Uint8Array): Uint8Array
  /** 处理响应方回应，完成握手，返回传输状态与可选 payload */
  processResponseMessage(response: Uint8Array): { state: NoiseState; payload?: Uint8Array }
}

export interface ResponderHandshake {
  /** 处理发起方初始消息，返回解出的可选 payload */
  processInitMessage(message: Uint8Array): { payload?: Uint8Array }
  /** 生成响应消息，返回消息字节和完成的传输状态 */
  createResponseMessage(payload?: Uint8Array): { message: Uint8Array; state: NoiseState }
}

// ---- 内部辅助函数 ---------------------------------------------------------

/** 计算 SHA-256 */
function hash(data: Uint8Array): Uint8Array {
  return sha256(data)
}

/** 将两段字节拼接 */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

/** HKDF-SHA256 派生，返回 [k1, k2]（每个 32 字节） */
function hkdf2(chainingKey: Uint8Array, ikm: Uint8Array): [Uint8Array, Uint8Array] {
  const out = hkdf(sha256, ikm, chainingKey, undefined, KEY_LEN * 2)
  return [out.slice(0, KEY_LEN), out.slice(KEY_LEN, KEY_LEN * 2)]
}

/** X25519 DH */
function dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey)
}

/** 将数字 nonce 编码为 12 字节 big-endian（前 4 字节为 0，后 8 字节为 uint64） */
function encodeNonce(n: number): Uint8Array {
  const buf = new Uint8Array(NONCE_LEN)
  // 最大安全整数范围内用 DataView 写 uint64（高 32 位为 0）
  const view = new DataView(buf.buffer)
  view.setUint32(4, Math.floor(n / 0x100000000), false)
  view.setUint32(8, n >>> 0, false)
  return buf
}

// ---- CipherState（对 ChaCha20-Poly1305 的薄封装）------------------------

interface CipherState {
  key: Uint8Array
  nonce: number
}

/** 加密并递增 nonce */
function csEncrypt(cs: CipherState, ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const nonce = encodeNonce(cs.nonce)
  cs.nonce++
  const cipher = chacha20poly1305(cs.key, nonce, ad)
  return cipher.encrypt(plaintext)
}

/** 解密并递增 nonce */
function csDecrypt(cs: CipherState, ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const nonce = encodeNonce(cs.nonce)
  cs.nonce++
  const cipher = chacha20poly1305(cs.key, nonce, ad)
  return cipher.decrypt(ciphertext)
}

// ---- SymmetricState ------------------------------------------------------

/**
 * 维护握手阶段的对称状态:
 *   - chainingKey (ck): 用于 HKDF 的链式密钥
 *   - h: 握手 hash（将所有握手数据混入）
 *   - cs: 当前对称加密状态（key + nonce）
 */
class SymmetricState {
  ck: Uint8Array
  h: Uint8Array
  cs: CipherState = { key: new Uint8Array(KEY_LEN), nonce: 0 }
  hasKey = false

  constructor(protocolName: string) {
    const nameBytes = new TextEncoder().encode(protocolName)
    if (nameBytes.length <= HASH_LEN) {
      // 补零到 HASH_LEN
      this.h = new Uint8Array(HASH_LEN)
      this.h.set(nameBytes)
    } else {
      this.h = hash(nameBytes)
    }
    this.ck = this.h.slice()
  }

  mixHash(data: Uint8Array): void {
    this.h = hash(concat(this.h, data))
  }

  mixKey(ikm: Uint8Array): void {
    const [newCk, tempK] = hkdf2(this.ck, ikm)
    this.ck = newCk
    this.cs.key = tempK
    this.cs.nonce = 0
    this.hasKey = true
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    let ciphertext: Uint8Array
    if (this.hasKey) {
      ciphertext = csEncrypt(this.cs, this.h, plaintext)
    } else {
      // 无密钥时直接明文传输
      ciphertext = plaintext
    }
    this.mixHash(ciphertext)
    return ciphertext
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    let plaintext: Uint8Array
    if (this.hasKey) {
      plaintext = csDecrypt(this.cs, this.h, ciphertext)
    } else {
      plaintext = ciphertext
    }
    this.mixHash(ciphertext)
    return plaintext
  }

  /**
   * 握手结束时调用，派生双向传输密钥。
   * 按 Noise 规范: split() = HKDF(ck, empty) -> (k1, k2)
   */
  split(): { k1: Uint8Array; k2: Uint8Array; h: Uint8Array } {
    const [k1, k2] = hkdf2(this.ck, new Uint8Array(0))
    return { k1, k2, h: this.h.slice() }
  }
}

// ---- createInitiator -----------------------------------------------------

export function createInitiator(options: {
  localStaticKeyPair: KeyPair
  remoteStaticPublicKey: Uint8Array
  localEphemeralKeyPair?: KeyPair
}): InitiatorHandshake {
  const { localStaticKeyPair: s, remoteStaticPublicKey: rs } = options

  // 发起方临时密钥（测试时可注入确定性密钥）
  let e: KeyPair = options.localEphemeralKeyPair ?? (() => {
    const priv = randomBytes(32)
    return { privateKey: priv, publicKey: x25519.getPublicKey(priv) }
  })()

  const ss = new SymmetricState(PROTOCOL_NAME)

  // 预消息：响应方静态公钥混入 h
  ss.mixHash(rs)
  // 预消息：发起方静态公钥混入 h（IK 的 "I" 部分）
  ss.mixHash(s.publicKey)

  let initMessageBytes: Uint8Array | null = null

  return {
    createInitMessage(payload?: Uint8Array): Uint8Array {
      const parts: Uint8Array[] = []

      // 1. e: 发送临时公钥（明文）
      ss.mixHash(e.publicKey)
      parts.push(e.publicKey)

      // 2. es: DH(e_priv, rs) -> mixKey
      ss.mixKey(dh(e.privateKey, rs))

      // 3. s: 加密发送本端静态公钥
      const encS = ss.encryptAndHash(s.publicKey)
      parts.push(encS)

      // 4. ss: DH(s_priv, rs) -> mixKey
      ss.mixKey(dh(s.privateKey, rs))

      // 5. 加密可选 payload
      const encPayload = ss.encryptAndHash(payload ?? new Uint8Array(0))
      parts.push(encPayload)

      initMessageBytes = concat(...parts)
      return initMessageBytes
    },

    processResponseMessage(response: Uint8Array): { state: NoiseState; payload?: Uint8Array } {
      let offset = 0

      // 1. re: 读取响应方临时公钥（32 字节，明文）
      const re = response.slice(offset, offset + 32)
      offset += 32
      ss.mixHash(re)

      // 2. ee: DH(e_priv, re) -> mixKey
      ss.mixKey(dh(e.privateKey, re))

      // 3. se: DH(s_priv, re) -> mixKey
      ss.mixKey(dh(s.privateKey, re))

      // 4. 解密可选 payload（其余字节全为加密 payload）
      const encPayload = response.slice(offset)
      const rawPayload = ss.decryptAndHash(encPayload)

      // 5. split -> 传输密钥
      const { k1, k2, h } = ss.split()
      // 发起方：sendKey = k1，recvKey = k2（与响应方对称）
      const state: NoiseState = {
        handshakeComplete: true,
        sendKey: k1,
        recvKey: k2,
        handshakeHash: h,
        sendNonce: 0,
        recvNonce: 0,
      }

      return {
        state,
        payload: rawPayload.length > 0 ? rawPayload : undefined,
      }
    },
  }
}

// ---- createResponder -----------------------------------------------------

export function createResponder(options: {
  localStaticKeyPair: KeyPair
  remoteStaticPublicKey: Uint8Array
}): ResponderHandshake {
  const { localStaticKeyPair: s, remoteStaticPublicKey: rs } = options

  const ss = new SymmetricState(PROTOCOL_NAME)

  // 预消息：响应方静态公钥（= 自己的公钥）
  ss.mixHash(s.publicKey)
  // 预消息：发起方静态公钥（= 已知的远端公钥）
  ss.mixHash(rs)

  // 响应方临时密钥（在 createResponseMessage 中生成）
  let re: Uint8Array | null = null  // 发起方临时公钥（从 init 消息解出）

  let eLocal: KeyPair | null = null  // 响应方自身的临时密钥

  return {
    processInitMessage(message: Uint8Array): { payload?: Uint8Array } {
      let offset = 0

      // 1. e: 读取发起方临时公钥（32 字节，明文）
      re = message.slice(offset, offset + 32)
      offset += 32
      ss.mixHash(re)

      // 2. es: DH(s_priv, re) -> mixKey（响应方视角：s=静态，re=对方临时）
      ss.mixKey(dh(s.privateKey, re))

      // 3. s: 解密发起方静态公钥（32 + 16 字节 = 48 字节）
      const encS = message.slice(offset, offset + 32 + TAG_LEN)
      offset += 32 + TAG_LEN
      const initiatorStaticPk = ss.decryptAndHash(encS)

      // 验证解出的发起方静态公钥与已知公钥一致
      if (!bytesEqual(initiatorStaticPk, rs)) {
        throw new Error('Noise IK: initiator static key mismatch — possible impersonation')
      }

      // 4. ss: DH(s_priv, initiatorStaticPk) -> mixKey
      ss.mixKey(dh(s.privateKey, initiatorStaticPk))

      // 5. 解密 payload
      const encPayload = message.slice(offset)
      const rawPayload = ss.decryptAndHash(encPayload)

      return {
        payload: rawPayload.length > 0 ? rawPayload : undefined,
      }
    },

    createResponseMessage(payload?: Uint8Array): { message: Uint8Array; state: NoiseState } {
      // 生成响应方临时密钥
      const ePriv = randomBytes(32)
      eLocal = { privateKey: ePriv, publicKey: x25519.getPublicKey(ePriv) }

      const parts: Uint8Array[] = []

      // 1. e: 发送响应方临时公钥（明文）
      ss.mixHash(eLocal.publicKey)
      parts.push(eLocal.publicKey)

      // 2. ee: DH(e_priv, re) -> mixKey
      if (!re) throw new Error('Noise IK: must call processInitMessage before createResponseMessage')
      ss.mixKey(dh(eLocal.privateKey, re))

      // 3. se: DH(e_priv, rs) -> mixKey（响应方临时 × 发起方静态）
      ss.mixKey(dh(eLocal.privateKey, rs))

      // 4. 加密可选 payload
      const encPayload = ss.encryptAndHash(payload ?? new Uint8Array(0))
      parts.push(encPayload)

      // 5. split -> 传输密钥
      const { k1, k2, h } = ss.split()
      // 响应方：sendKey = k2，recvKey = k1（与发起方对称）
      const state: NoiseState = {
        handshakeComplete: true,
        sendKey: k2,
        recvKey: k1,
        handshakeHash: h,
        sendNonce: 0,
        recvNonce: 0,
      }

      return {
        message: concat(...parts),
        state,
      }
    },
  }
}

// ---- Transport 加解密 ----------------------------------------------------

/**
 * 使用握手后状态加密消息。
 * 格式: nonce(12B) || ciphertext+tag
 * nonce 使用当前 sendNonce，加密后 sendNonce++。
 */
export function encryptMessage(state: NoiseState, plaintext: Uint8Array): Uint8Array {
  if (!state.handshakeComplete) throw new Error('Noise: handshake not complete')
  const nonce = encodeNonce(state.sendNonce)
  state.sendNonce++
  const cipher = chacha20poly1305(state.sendKey, nonce)
  const ciphertext = cipher.encrypt(plaintext)
  return concat(nonce, ciphertext)
}

/**
 * 使用握手后状态解密消息。
 * 格式与 encryptMessage 对应: nonce(12B) || ciphertext+tag
 * nonce 从报文头读取（同时验证与 recvNonce 是否一致）。
 */
export function decryptMessage(state: NoiseState, data: Uint8Array): Uint8Array {
  if (!state.handshakeComplete) throw new Error('Noise: handshake not complete')
  if (data.length < NONCE_LEN + TAG_LEN) {
    throw new Error('Noise: ciphertext too short')
  }
  const nonce = data.slice(0, NONCE_LEN)

  // 验证 nonce 与预期一致（防重放）
  const expectedNonce = encodeNonce(state.recvNonce)
  if (!bytesEqual(nonce, expectedNonce)) {
    throw new Error('Noise: nonce mismatch — possible replay or out-of-order message')
  }
  state.recvNonce++

  const ciphertext = data.slice(NONCE_LEN)
  const cipher = chacha20poly1305(state.recvKey, nonce)
  return cipher.decrypt(ciphertext)
}

// ---- 工具函数 -------------------------------------------------------------

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}
