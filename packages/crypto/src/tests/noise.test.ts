import { describe, it, expect } from 'vitest'
import { generateKeyPair } from '../keys.js'
import {
  createInitiator,
  createResponder,
  encryptMessage,
  decryptMessage,
  type NoiseState,
} from '../noise.js'

function doHandshake(
  initPayload?: Uint8Array,
  respPayload?: Uint8Array,
): { initiatorState: NoiseState; responderState: NoiseState; initRecvPayload?: Uint8Array; respRecvPayload?: Uint8Array } {
  const ikp = generateKeyPair()  // 发起方静态密钥
  const rkp = generateKeyPair()  // 响应方静态密钥

  // 发起方知道响应方公钥，响应方知道发起方公钥（IK 前提）
  const initiator = createInitiator({
    localStaticKeyPair: ikp,
    remoteStaticPublicKey: rkp.publicKey,
  })
  const responder = createResponder({
    localStaticKeyPair: rkp,
    remoteStaticPublicKey: ikp.publicKey,
  })

  // 握手第一步：发起方 -> 响应方
  const initMsg = initiator.createInitMessage(initPayload)
  const { payload: respRecvPayload } = responder.processInitMessage(initMsg)

  // 握手第二步：响应方 -> 发起方
  const { message: respMsg, state: responderState } = responder.createResponseMessage(respPayload)
  const { state: initiatorState, payload: initRecvPayload } = initiator.processResponseMessage(respMsg)

  return { initiatorState, responderState, initRecvPayload, respRecvPayload }
}

describe('Noise IK 握手', () => {
  it('握手完成后状态标记正确', () => {
    const { initiatorState, responderState } = doHandshake()
    expect(initiatorState.handshakeComplete).toBe(true)
    expect(responderState.handshakeComplete).toBe(true)
  })

  it('双方 sendKey/recvKey 对称（发起方 sendKey = 响应方 recvKey）', () => {
    const { initiatorState, responderState } = doHandshake()
    expect(initiatorState.sendKey).toEqual(responderState.recvKey)
    expect(initiatorState.recvKey).toEqual(responderState.sendKey)
  })

  it('双方 handshakeHash 一致', () => {
    const { initiatorState, responderState } = doHandshake()
    expect(initiatorState.handshakeHash).toEqual(responderState.handshakeHash)
  })

  it('握手 payload 正确传递（发起方 -> 响应方）', () => {
    const payload = new TextEncoder().encode('hello from initiator')
    const { respRecvPayload } = doHandshake(payload, undefined)
    expect(respRecvPayload).toBeDefined()
    expect(new TextDecoder().decode(respRecvPayload)).toBe('hello from initiator')
  })

  it('握手 payload 正确传递（响应方 -> 发起方）', () => {
    const payload = new TextEncoder().encode('hello from responder')
    const { initRecvPayload } = doHandshake(undefined, payload)
    expect(initRecvPayload).toBeDefined()
    expect(new TextDecoder().decode(initRecvPayload)).toBe('hello from responder')
  })

  it('无 payload 时返回 undefined', () => {
    const { initRecvPayload, respRecvPayload } = doHandshake()
    expect(initRecvPayload).toBeUndefined()
    expect(respRecvPayload).toBeUndefined()
  })
})

describe('Transport 加解密', () => {
  it('发起方加密，响应方解密', () => {
    const { initiatorState, responderState } = doHandshake()
    const plaintext = new TextEncoder().encode('secret message')
    const ciphertext = encryptMessage(initiatorState, plaintext)
    const decrypted = decryptMessage(responderState, ciphertext)
    expect(new TextDecoder().decode(decrypted)).toBe('secret message')
  })

  it('响应方加密，发起方解密', () => {
    const { initiatorState, responderState } = doHandshake()
    const plaintext = new TextEncoder().encode('reply from responder')
    const ciphertext = encryptMessage(responderState, plaintext)
    const decrypted = decryptMessage(initiatorState, ciphertext)
    expect(new TextDecoder().decode(decrypted)).toBe('reply from responder')
  })

  it('多条消息 nonce 正确递增', () => {
    const { initiatorState, responderState } = doHandshake()
    const msgs = ['msg1', 'msg2', 'msg3']
    for (const m of msgs) {
      const ct = encryptMessage(initiatorState, new TextEncoder().encode(m))
      const pt = decryptMessage(responderState, ct)
      expect(new TextDecoder().decode(pt)).toBe(m)
    }
    expect(initiatorState.sendNonce).toBe(3)
    expect(responderState.recvNonce).toBe(3)
  })

  it('篡改密文后解密失败', () => {
    const { initiatorState, responderState } = doHandshake()
    const ct = encryptMessage(initiatorState, new TextEncoder().encode('tamper test'))
    // 翻转最后一字节
    ct[ct.length - 1] ^= 0xff
    expect(() => decryptMessage(responderState, ct)).toThrow()
  })

  it('错误静态公钥导致握手失败', () => {
    const ikp = generateKeyPair()
    const rkp = generateKeyPair()
    const wrongKp = generateKeyPair()  // 未授权的第三方

    const initiator = createInitiator({
      localStaticKeyPair: wrongKp,          // 发起方使用未授权密钥
      remoteStaticPublicKey: rkp.publicKey,
    })
    const responder = createResponder({
      localStaticKeyPair: rkp,
      remoteStaticPublicKey: ikp.publicKey, // 响应方期望 ikp，不是 wrongKp
    })

    const initMsg = initiator.createInitMessage()
    // 错误密钥会导致 AEAD 解密时抛出 "invalid tag"（认证失败），
    // 或解密成功但公钥内容不一致时抛出 mismatch。
    // 两者都表示握手被正确拒绝。
    expect(() => responder.processInitMessage(initMsg)).toThrow()
  })
})
