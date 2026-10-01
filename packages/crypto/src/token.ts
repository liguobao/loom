import { randomBytes } from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha256'

/**
 * 生成随机 API Token（32 字节，返回 hex 字符串）。
 * 用于 Loom Server session token，明文只在生成时返回一次。
 */
export function generateToken(): string {
  const bytes = randomBytes(32)
  return Buffer.from(bytes).toString('hex')
}

/**
 * 对 token 做 SHA-256 哈希，用于数据库存储。
 * 验证时对用户提供的 token 做相同哈希后比较，
 * 避免数据库泄露导致 token 直接被利用。
 */
export function hashToken(token: string): string {
  const bytes = new TextEncoder().encode(token)
  const digest = sha256(bytes)
  return Buffer.from(digest).toString('hex')
}
