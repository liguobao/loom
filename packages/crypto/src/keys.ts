import { x25519 } from '@noble/curves/ed25519'
import { randomBytes } from '@noble/hashes/utils'

export interface KeyPair {
  privateKey: Uint8Array
  publicKey: Uint8Array
}

/** 生成新的 X25519 密钥对 */
export function generateKeyPair(): KeyPair {
  const privateKey = randomBytes(32)
  const publicKey = x25519.getPublicKey(privateKey)
  return { privateKey, publicKey }
}

/** 从私钥派生公钥 */
export function getPublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey)
}

/** 序列化公钥为 base64 */
export function publicKeyToBase64(publicKey: Uint8Array): string {
  return Buffer.from(publicKey).toString('base64')
}

/** 从 base64 反序列化公钥 */
export function base64ToPublicKey(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

/** 序列化密钥对为可存储格式（两个字段均为 base64） */
export function serializeKeyPair(kp: KeyPair): { privateKey: string; publicKey: string } {
  return {
    privateKey: Buffer.from(kp.privateKey).toString('base64'),
    publicKey: Buffer.from(kp.publicKey).toString('base64'),
  }
}

/** 从存储格式反序列化密钥对 */
export function deserializeKeyPair(stored: { privateKey: string; publicKey: string }): KeyPair {
  return {
    privateKey: new Uint8Array(Buffer.from(stored.privateKey, 'base64')),
    publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64')),
  }
}
