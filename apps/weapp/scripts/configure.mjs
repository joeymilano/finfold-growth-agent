/** Set non-secret WeChat resource IDs after registration; never accept AppSecret. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (key) => { const i = process.argv.indexOf(`--${key}`); return i < 0 ? '' : process.argv[i + 1] || ''; };
const appid = arg('appid');
const cloudEnv = arg('cloud-env');
if (!/^wx[a-f0-9]{16}$/i.test(appid) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,100}$/.test(cloudEnv) || cloudEnv.startsWith('REPLACE_')) {
  console.error('用法：node scripts/configure.mjs --appid <小程序AppID> --cloud-env <云开发环境ID>'); process.exit(1);
}
const configPath = path.join(root,'project.config.json');
const config = JSON.parse(fs.readFileSync(configPath,'utf8'));
config.appid = appid;
fs.writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
fs.writeFileSync(path.join(root,'miniprogram/utils/config.ts'),`// Non-secret deployment identifier. Updated by scripts/configure.mjs.\nexport const CLOUD_ENV = ${JSON.stringify(cloudEnv)};\n`);
fs.writeFileSync(path.join(root,'miniprogram/skills/agent/config.json'),JSON.stringify({ cloudEnv },null,2)+'\n');
console.log('已同步小程序身份及主包、AI 分包的云环境配置。');
