// Zod 验证 schema，主要用于 API 请求体验证
import { z } from 'zod'

// 通用字段规则
const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, '只允许小写字母、数字和连字符，且不能以连字符开头或结尾')

// 用户登录
export const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})
export type LoginInput = z.infer<typeof LoginSchema>

// 用户注册
export const RegisterSchema = z.object({
  username: slugSchema,
  displayName: z.string().min(1).max(128),
  email: z.string().email(),
  password: z.string().min(8).max(256),
})
export type RegisterInput = z.infer<typeof RegisterSchema>

// 创建 Organization
export const CreateOrganizationSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(128),
})
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>

// 创建 Workspace
export const CreateWorkspaceSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
})
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>

// 创建 Project
export const CreateProjectSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
})
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>

// 注册 Machine
export const RegisterMachineSchema = z.object({
  name: z.string().min(1).max(128),
  platform: z.enum(['darwin', 'linux', 'win32']),
  organizationId: z.string().min(1),
})
export type RegisterMachineInput = z.infer<typeof RegisterMachineSchema>

// 注册 HostInstance
export const RegisterHostInstanceSchema = z.object({
  machineId: z.string().min(1),
  name: z.string().min(1).max(128),
  harnessVersion: z.string().optional(),
  pluginVersion: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  observePermission: z.enum(['hidden', 'presence', 'observe']).default('presence'),
})
export type RegisterHostInstanceInput = z.infer<typeof RegisterHostInstanceSchema>

// 创建 WorkRecord（入库时的 payload）
export const CreateWorkRecordSchema = z.object({
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1).max(256),
  repository: z.string().optional(),
  branch: z.string().optional(),
  baseCommit: z.string().optional(),
  finalCommit: z.string().optional(),
  tags: z.array(z.string()).default([]),
  changedAreas: z.array(z.string()).default([]),
  relativePath: z.string().min(1),
  completedAt: z.string().datetime().optional(),
  sourceConversationCount: z.number().int().min(0).default(0),
})
export type CreateWorkRecordInput = z.infer<typeof CreateWorkRecordSchema>

// 搜索查询
export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(256),
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
  workspaceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})
export type SearchQueryInput = z.infer<typeof SearchQuerySchema>

// 添加成员
export const AddMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member', 'viewer']).default('member'),
})
export type AddMemberInput = z.infer<typeof AddMemberSchema>

// 添加仓库
export const AddRepositorySchema = z.object({
  repoUrl: z.string().min(1).max(512),
})
export type AddRepositoryInput = z.infer<typeof AddRepositorySchema>

// 更新 ActiveWork
export const UpdateActiveWorkSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(256),
  repository: z.string().optional(),
  branch: z.string().optional(),
  visibility: z.enum(['hidden', 'presence', 'observe']).default('presence'),
})
export type UpdateActiveWorkInput = z.infer<typeof UpdateActiveWorkSchema>
