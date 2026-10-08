import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWrite, workspaceId, loomHome, type Config } from './config.js'

const exec = promisify(execFile)
const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
// systemd specifiers and environment interpolation must stay literal in paths.
const systemdArg = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"'
export function serviceDefinition(platform: string, config: Config, configPath: string, node: string, cli: string): { name: string; content: string } {
  const id = workspaceId(config.workspace)
  const args = [node, cli, 'watch', '--config', resolve(configPath)]
  if (platform === 'darwin') {
    const name = `com.loom.archive.${id}`
    const logDir = join(loomHome(), 'logs')
    return { name, content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${name}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(config.workspace)}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(join(logDir, id + '.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(logDir, id + '.error.log'))}</string>
</dict></plist>
` }
  }
  if (platform === 'linux') {
    const name = `loom-archive-${id}.service`
    return { name, content: `[Unit]
Description=Loom workspace conversation archiver

[Service]
Type=simple
ExecStart=${args.map(arg => systemdArg(arg).replace(/\$/g, () => '$$')).join(' ')}
Restart=on-failure
RestartSec=30
UMask=0077

[Install]
WantedBy=default.target
` }
  }
  throw new Error('Background service installation supports macOS and Linux. Use loom watch or your OS scheduler on other platforms.')
}
export async function schedule(action: string, config: Config, configPath: string): Promise<string> {
  if (!['install', 'uninstall', 'status'].includes(action)) throw new Error('Usage: loom schedule install|uninstall|status [--config path]')
  const { name, content } = serviceDefinition(process.platform, config, configPath, process.execPath, fileURLToPath(import.meta.url).replace(/schedule\.js$/, 'cli.js'))
  if (process.platform === 'darwin') {
    const path = join(homedir(), 'Library', 'LaunchAgents', `${name}.plist`)
    const domain = `gui/${process.getuid!()}`
    if (action === 'status') return (await exec('launchctl', ['print', `${domain}/${name}`])).stdout
    if (action === 'uninstall') {
      await exec('launchctl', ['bootout', `${domain}/${name}`])
      await rm(path, { force: true })
      return `Removed ${name}`
    }
    await mkdir(join(loomHome(), 'logs'), { recursive: true, mode: 0o700 })
    await atomicWrite(path, content)
    // Reinstallation replaces the already loaded service.
    const loaded = await exec('launchctl', ['print', `${domain}/${name}`]).then(() => true, () => false)
    if (loaded) await exec('launchctl', ['bootout', `${domain}/${name}`])
    await exec('launchctl', ['bootstrap', domain, path])
    return `Installed ${name}; logs: ${join(loomHome(), 'logs')}`
  }
  const unitRoot = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  const path = join(unitRoot, 'systemd', 'user', name)
  if (action === 'status') return (await exec('systemctl', ['--user', 'status', name])).stdout
  if (action === 'uninstall') {
    await exec('systemctl', ['--user', 'disable', '--now', name])
    await rm(path, { force: true })
    await exec('systemctl', ['--user', 'daemon-reload'])
    return `Removed ${name}`
  }
  await mkdir(dirname(path), { recursive: true })
  await atomicWrite(path, content)
  await exec('systemctl', ['--user', 'daemon-reload'])
  await exec('systemctl', ['--user', 'enable', '--now', name])
  await exec('systemctl', ['--user', 'restart', name])
  return `Installed ${name}; logs: journalctl --user -u ${name}`
}
