#!/usr/bin/env node
/**
 * Loom CLI - 本地集成入口
 *
 * loom login          — 登录 Loom Server
 * loom logout         — 退出登录
 * loom init           — 绑定当前目录到 Loom Project
 * loom status         — 查看当前状态
 * loom whoami         — 查看当前用户
 * loom work start     — 开始一个 Active Work
 * loom work end       — 结束 Active Work 并生成 Work Record
 * loom record upload  — 手动上传 Work Record
 * loom search         — 搜索 Work Records
 * loom host register  — 注册本地 Host Instance
 * loom reindex        — 请求服务端重建索引
 */
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import inquirer from 'inquirer'
import { platform } from 'node:os'
import {
  getConfig,
  setToken,
  setServerUrl,
  clearToken,
  bindProject,
  getProjectBinding,
  isLoggedIn,
  addMachine,
} from './config.js'
import {
  login,
  register,
  getMe,
  listOrganizations,
  listWorkspaces,
  listProjects,
  createOrganization,
  createWorkspace,
  createProject,
  registerMachine,
  registerHostInstance,
  searchRecords,
  listProjectRecords,
  getWorkRecord,
} from './api.js'

const program = new Command()

program
  .name('loom')
  .description('Loom for DeepSeek Harness — Keep the work, not the chat.')
  .version('0.1.0')

// ── auth ──────────────────────────────────────────────────────────────────────

program
  .command('login')
  .description('登录 Loom Server')
  .option('--server <url>', 'Server URL', 'http://localhost:3000')
  .action(async (opts) => {
    setServerUrl(opts.server)

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '选择操作',
        choices: ['登录已有账号', '注册新账号'],
      },
    ])

    const answers = await inquirer.prompt([
      { type: 'input', name: 'username', message: '用户名:' },
      { type: 'password', name: 'password', message: '密码:', mask: '*' },
      ...(action === '注册新账号'
        ? [
            { type: 'input', name: 'displayName', message: '显示名称:' },
            { type: 'input', name: 'email', message: '邮箱:' },
          ]
        : []),
    ])

    const spinner = ora('连接到 Loom Server...').start()
    try {
      let result
      if (action === '注册新账号') {
        result = await register({
          username: answers.username,
          displayName: answers.displayName,
          email: answers.email,
          password: answers.password,
        })
      } else {
        result = await login(answers.username, answers.password)
      }
      setToken(result.token, result.user.id, result.user.username)
      spinner.succeed(chalk.green(`✓ 已登录为 ${result.user.displayName} (${result.user.username})`))
    } catch (err) {
      spinner.fail(chalk.red(`登录失败: ${err instanceof Error ? err.message : err}`))
      process.exit(1)
    }
  })

program
  .command('logout')
  .description('退出登录')
  .action(() => {
    clearToken()
    console.log(chalk.green('✓ 已退出登录'))
  })

program
  .command('whoami')
  .description('查看当前登录用户')
  .action(async () => {
    if (!isLoggedIn()) {
      console.log(chalk.yellow('未登录，请先运行 loom login'))
      return
    }
    const spinner = ora('获取用户信息...').start()
    try {
      const user = await getMe()
      spinner.stop()
      console.log(`用户: ${chalk.bold(user.displayName)} (${user.username})`)
      console.log(`邮箱: ${user.email}`)
      console.log(`ID:   ${user.id}`)
      console.log(`Server: ${getConfig().serverUrl}`)
    } catch (err) {
      spinner.fail(chalk.red(`获取用户信息失败: ${err instanceof Error ? err.message : err}`))
    }
  })

// ── init ──────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('将当前目录绑定到 Loom Project')
  .action(async () => {
    if (!isLoggedIn()) {
      console.log(chalk.yellow('请先运行 loom login'))
      process.exit(1)
    }

    const cwd = process.cwd()
    const existing = getProjectBinding(cwd)
    if (existing) {
      console.log(chalk.yellow(`当前目录已绑定到项目: ${existing.projectName}`))
      const { confirm } = await inquirer.prompt([
        { type: 'confirm', name: 'confirm', message: '是否重新绑定？', default: false },
      ])
      if (!confirm) return
    }

    const spinner = ora('获取组织列表...').start()
    let orgs
    try {
      orgs = await listOrganizations()
      spinner.stop()
    } catch (err) {
      spinner.fail(`获取失败: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }

    if (orgs.length === 0) {
      console.log(chalk.yellow('没有找到组织，请先创建组织'))
      const { name, slug } = await inquirer.prompt([
        { type: 'input', name: 'name', message: '组织名称:' },
        { type: 'input', name: 'slug', message: '组织标识符 (slug):' },
      ])
      const org = await createOrganization({ name, slug })
      orgs = [org]
    }

    const { orgId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'orgId',
        message: '选择组织:',
        choices: orgs.map(o => ({ name: o.name, value: o.id })),
      },
    ])
    const org = orgs.find(o => o.id === orgId)!

    // 选择或创建 Workspace
    const workspaces = await listWorkspaces(orgId)
    let workspaceId: string
    let workspaceName: string

    if (workspaces.length === 0) {
      const { name, slug } = await inquirer.prompt([
        { type: 'input', name: 'name', message: 'Workspace 名称:' },
        { type: 'input', name: 'slug', message: 'Workspace slug:' },
      ])
      const ws = await createWorkspace(orgId, { name, slug })
      workspaceId = ws.id
      workspaceName = ws.name
    } else {
      const { wsId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'wsId',
          message: '选择 Workspace:',
          choices: [
            ...workspaces.map(w => ({ name: w.name, value: w.id })),
            { name: '+ 创建新 Workspace', value: '__new__' },
          ],
        },
      ])
      if (wsId === '__new__') {
        const { name, slug } = await inquirer.prompt([
          { type: 'input', name: 'name', message: 'Workspace 名称:' },
          { type: 'input', name: 'slug', message: 'Workspace slug:' },
        ])
        const ws = await createWorkspace(orgId, { name, slug })
        workspaceId = ws.id
        workspaceName = ws.name
      } else {
        workspaceId = wsId
        workspaceName = workspaces.find(w => w.id === wsId)!.name
      }
    }

    // 选择或创建 Project
    const projects = await listProjects(workspaceId)
    let projectId: string
    let projectName: string

    if (projects.length === 0) {
      const { name, slug } = await inquirer.prompt([
        { type: 'input', name: 'name', message: 'Project 名称:' },
        { type: 'input', name: 'slug', message: 'Project slug:' },
      ])
      const proj = await createProject(workspaceId, { name, slug })
      projectId = proj.id
      projectName = proj.name
    } else {
      const { projId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'projId',
          message: '选择 Project:',
          choices: [
            ...projects.map(p => ({ name: p.name, value: p.id })),
            { name: '+ 创建新 Project', value: '__new__' },
          ],
        },
      ])
      if (projId === '__new__') {
        const { name, slug } = await inquirer.prompt([
          { type: 'input', name: 'name', message: 'Project 名称:' },
          { type: 'input', name: 'slug', message: 'Project slug:' },
        ])
        const proj = await createProject(workspaceId, { name, slug })
        projectId = proj.id
        projectName = proj.name
      } else {
        projectId = projId
        projectName = projects.find(p => p.id === projId)!.name
      }
    }

    bindProject(cwd, {
      projectId,
      projectName,
      organizationId: orgId,
      workspaceId,
      boundAt: new Date().toISOString(),
    })

    console.log(chalk.green(`\n✓ 已绑定: ${org.name} / ${workspaceName} / ${projectName}`))
    console.log(`  目录: ${cwd}`)
  })

// ── status ────────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('查看当前状态')
  .action(() => {
    const config = getConfig()
    const cwd = process.cwd()
    const binding = getProjectBinding(cwd)

    console.log(chalk.bold('\n  Loom Status\n'))
    console.log(`  Server:  ${config.serverUrl}`)
    console.log(`  User:    ${config.username ?? chalk.gray('(未登录)')}`)
    console.log(`  Project: ${binding ? chalk.green(binding.projectName) : chalk.gray('(未绑定，运行 loom init)')}`)
    if (binding) {
      console.log(`  Org:     ${binding.organizationId}`)
      console.log(`  Workspace: ${binding.workspaceId}`)
    }
    console.log()
  })

// ── search ────────────────────────────────────────────────────────────────────

program
  .command('search <query>')
  .description('搜索 Work Records')
  .option('--project <id>', '限定项目 ID')
  .action(async (query, opts) => {
    if (!isLoggedIn()) {
      console.log(chalk.yellow('请先运行 loom login'))
      process.exit(1)
    }
    const binding = getProjectBinding(process.cwd())
    const spinner = ora(`搜索 "${query}"...`).start()
    try {
      const results = await searchRecords({
        query,
        projectId: opts.project ?? binding?.projectId,
      })
      spinner.stop()
      if (results.length === 0) {
        console.log(chalk.gray('没有找到相关记录'))
        return
      }
      console.log(chalk.bold(`\n  找到 ${results.length} 条记录:\n`))
      for (const r of results) {
        console.log(`  ${chalk.cyan(r.id.slice(-8))} ${chalk.bold(r.title)}`)
        console.log(`     ${chalk.gray(r.createdAt.slice(0, 10))} · ${r.repository ?? ''}`)
        if (r.tags) {
          console.log(`     ${r.tags.split(',').map(t => chalk.blue('#' + t.trim())).join(' ')}`)
        }
        console.log()
      }
    } catch (err) {
      spinner.fail(`搜索失败: ${err instanceof Error ? err.message : err}`)
    }
  })

// ── host ──────────────────────────────────────────────────────────────────────

const hostCmd = program.command('host').description('Host Instance 管理')

hostCmd
  .command('register')
  .description('注册本地 Host Instance')
  .option('--name <name>', 'Host 名称', 'DSH Host')
  .action(async (opts) => {
    if (!isLoggedIn()) {
      console.log(chalk.yellow('请先运行 loom login'))
      process.exit(1)
    }
    const config = getConfig()
    const orgId = config.machines?.[0]?.organizationId

    if (!orgId) {
      console.log(chalk.yellow('请先在组织中注册 Machine'))
      return
    }

    // 注册 Machine (如果没有)
    const spinner = ora('注册 Host Instance...').start()
    try {
      const machineName = `${require('node:os').hostname()} (${platform()})`
      const machine = await registerMachine({
        organizationId: orgId,
        name: machineName,
        platform: platform(),
      })
      addMachine({ machineId: machine.id, machineName: machine.name, organizationId: orgId })

      const host = await registerHostInstance(machine.id, {
        name: opts.name,
        capabilities: ['observe', 'presence'],
      })
      spinner.succeed(chalk.green(`✓ 已注册 Host: ${host.name} (${host.id})`))
    } catch (err) {
      spinner.fail(`注册失败: ${err instanceof Error ? err.message : err}`)
    }
  })

// ── records ───────────────────────────────────────────────────────────────────

const recordCmd = program.command('record').description('Work Record 管理')

recordCmd
  .command('list')
  .description('列出项目的 Work Records')
  .option('--limit <n>', '最大条数', '20')
  .action(async (opts) => {
    if (!isLoggedIn()) {
      console.log(chalk.yellow('请先运行 loom login'))
      process.exit(1)
    }
    const binding = getProjectBinding(process.cwd())
    if (!binding) {
      console.log(chalk.yellow('请先运行 loom init 绑定项目'))
      process.exit(1)
    }
    const spinner = ora('获取记录列表...').start()
    try {
      const records = await listProjectRecords(binding.projectId, { limit: parseInt(opts.limit) })
      spinner.stop()
      if (records.length === 0) {
        console.log(chalk.gray('暂无 Work Records'))
        return
      }
      console.log(chalk.bold(`\n  ${binding.projectName} — Work Records\n`))
      for (const r of records) {
        console.log(`  ${chalk.cyan(r.id.slice(-8))} ${chalk.bold(r.title)}`)
        console.log(`     ${chalk.gray(r.createdAt.slice(0, 10))} · ${r.ownerId} · ${r.repository ?? ''}`)
        console.log()
      }
    } catch (err) {
      spinner.fail(`获取失败: ${err instanceof Error ? err.message : err}`)
    }
  })

recordCmd
  .command('show <id>')
  .description('查看 Work Record 详情')
  .action(async (id) => {
    if (!isLoggedIn()) {
      console.log(chalk.yellow('请先运行 loom login'))
      process.exit(1)
    }
    const spinner = ora('获取记录...').start()
    try {
      const { meta, content } = await getWorkRecord(id)
      spinner.stop()
      console.log(chalk.bold(`\n  ${meta.title}\n`))
      console.log(content)
    } catch (err) {
      spinner.fail(`获取失败: ${err instanceof Error ? err.message : err}`)
    }
  })

program.parse(process.argv)
