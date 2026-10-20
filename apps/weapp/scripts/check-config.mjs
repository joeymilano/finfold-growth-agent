import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root,'project.config.json'),'utf8'));
const skill = JSON.parse(fs.readFileSync(path.join(root,'miniprogram/skills/agent/config.json'),'utf8'));
const main = fs.readFileSync(path.join(root,'miniprogram/utils/config.ts'),'utf8').match(/CLOUD_ENV\s*=\s*"([^"]+)"/)?.[1];
const errors=[];
if (!/^wx[a-f0-9]{16}$/i.test(config.appid || '')) errors.push('尚未配置正式小程序 AppID（公众号第三方平台 AppID 不能替代）。');
if (!main || main.startsWith('REPLACE_')) errors.push('尚未配置云开发环境。');
if (main !== skill.cloudEnv) errors.push('主包与 AI 分包的云环境不一致。');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('本地资源 ID 配置检查通过；仍需验证云函数、后端密钥、数据库迁移和真机登录。');
