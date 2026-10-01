import { describe, it, expect } from 'vitest'
import {
  generateKeyPair,
  getPublicKey,
  publicKeyToBase64,
  base64ToPublicKey,
  serializeKeyPair,
  deserializeKeyPair,
} from '../keys.js'

describe('generateKeyPair', () => {
  it('生成 32 字节的私钥和公钥', () => {
    const kp = generateKeyPair()
    expect(kp.privateKey).toBeInstanceOf(Uint8Array)
    expect(kp.publicKey).toBeInstanceOf(Uint8Array)
    expect(kp.privateKey.length).toBe(32)
    expect(kp.publicKey.length).toBe(32)
  })

  it('每次生成的密钥对不同', () => {
    const kp1 = generateKeyPair()
    const kp2 = generateKeyPair()
    expect(Buffer.from(kp1.privateKey).toString('hex')).not.toBe(
      Buffer.from(kp2.privateKey).toString('hex'),
    )
  })
})

describe('getPublicKey', () => {
  it('从私钥派生公钥与 generateKeyPair 结果一致', () => {
    const kp = generateKeyPair()
    const derived = getPublicKey(kp.privateKey)
    expect(derived).toEqual(kp.publicKey)
  })
})

describe('publicKeyToBase64 / base64ToPublicKey', () => {
  it('往返序列化正确', () => {
    const kp = generateKeyPair()
    const b64 = publicKeyToBase64(kp.publicKey)
    expect(typeof b64).toBe('string')
    const recovered = base64ToPublicKey(b64)
    expect(recovered).toEqual(kp.publicKey)
  })
})

describe('serializeKeyPair / deserializeKeyPair', () => {
  it('往返序列化密钥对正确', () => {
    const kp = generateKeyPair()
    const stored = serializeKeyPair(kp)
    expect(typeof stored.privateKey).toBe('string')
    expect(typeof stored.publicKey).toBe('string')
    const recovered = deserializeKeyPair(stored)
    expect(recovered.privateKey).toEqual(kp.privateKey)
    expect(recovered.publicKey).toEqual(kp.publicKey)
  })
})
