import { readFile } from 'node:fs/promises'

export interface RedactionResult {
  content: string
  redactedCount: number
  patterns: string[] // 触发了哪些规则
}

/**
 * 每条规则：name 用于记录触发了哪个规则，pattern 是正则
 * 替换为 [REDACTED:<name>]
 */
interface RedactRule {
  name: string
  pattern: RegExp
}

const REDACT_RULES: RedactRule[] = [
  // API Key (通用, OpenAI sk- 系列等)
  {
    name: 'API_KEY',
    pattern: /(sk-|sk_live_|sk_test_|api_key[s]?\s*[:=]\s*)[a-zA-Z0-9_\-]{20,}/gi,
  },
  // AWS Access Key
  {
    name: 'AWS_ACCESS_KEY',
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
  // GitHub Personal Access Token
  {
    name: 'GITHUB_TOKEN',
    pattern: /ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}/g,
  },
  // PEM 私钥块（单行匹配开头即脱敏整段）
  {
    name: 'PRIVATE_KEY_BLOCK',
    pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  // SSH OPENSSH 私钥单独匹配（防止上面遗漏）
  {
    name: 'SSH_PRIVATE_KEY',
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
  },
  // 配置文件中的 password 字段
  {
    name: 'CONFIG_PASSWORD',
    pattern: /password[s]?\s*[:=]\s*['"]?[^\s'"]{8,}/gi,
  },
  // 数据库连接 URL（含用户名密码）
  {
    name: 'DATABASE_URL',
    pattern: /(postgres|mysql|mongodb)(\+[a-z]+)?:\/\/[^\s]+:[^\s]+@[^\s]+/gi,
  },
  // .env 文件风格的 KEY=VALUE
  {
    name: 'ENV_SECRET',
    pattern: /[A-Z_]{3,}_(KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)\s*=\s*\S+/g,
  },
  // HTTP Authorization: Bearer token
  {
    name: 'BEARER_TOKEN',
    pattern: /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/g,
  },
  // HTTP Cookie 头
  {
    name: 'COOKIE_HEADER',
    pattern: /Cookie:\s*.+/gi,
  },
]

/**
 * 对文本内容进行敏感信息脱敏
 *
 * 逐条规则扫描，将匹配到的敏感内容替换为 [REDACTED:<RULE_NAME>]。
 * 返回脱敏后的内容、替换次数以及触发的规则名称列表。
 */
export function redactSecrets(content: string): RedactionResult {
  let result = content
  let redactedCount = 0
  const triggeredPatterns = new Set<string>()

  for (const rule of REDACT_RULES) {
    // 重置 lastIndex 以确保每次从头搜索
    rule.pattern.lastIndex = 0
    const replaced = result.replace(rule.pattern, (match) => {
      redactedCount++
      triggeredPatterns.add(rule.name)
      return `[REDACTED:${rule.name}]`
    })
    // 只在真正发生替换时更新内容（避免无谓赋值）
    if (replaced !== result) {
      result = replaced
    }
  }

  return {
    content: result,
    redactedCount,
    patterns: Array.from(triggeredPatterns),
  }
}

/**
 * 读取 Markdown 文件并对其内容执行脱敏
 *
 * 注意：此函数只返回脱敏后的内容，不会修改原文件。
 */
export async function redactFile(filePath: string): Promise<RedactionResult> {
  const raw = await readFile(filePath, 'utf-8')
  return redactSecrets(raw)
}
