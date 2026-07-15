#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const envFile = String(process.env.ENV_FILE || '.env').trim();
require('dotenv').config({
  path: path.isAbsolute(envFile) ? envFile : path.join(__dirname, '..', envFile),
  quiet: true
});

const {
  decryptCredential,
  encryptCredential,
  isCredentialEncryptionEnabled
} = require('../credential_cipher.js');

/**
 * 功能描述：输出命令用法并退出。
 * @param {number} code 退出码
 * @return {void} 无返回值
 */
function printUsageAndExit(code) {
  const output = code === 0 ? console.log : console.error;
  output([
    'Usage:',
    '  node tools/credential_cipher_cli.js encrypt "cookie text"',
    '  node tools/credential_cipher_cli.js decrypt "enc:v1:..."',
    '  node tools/credential_cipher_cli.js encrypt --file ./cookie.txt',
    '  pbpaste | node tools/credential_cipher_cli.js encrypt',
    '',
    'Environment:',
    '  ENV_FILE=.env                  默认读取当前目录 .env',
    '  CREDENTIAL_ENCRYPTION_KEY=...   也可以直接通过环境变量传入'
  ].join('\n'));
  process.exit(code);
}

/**
 * 功能描述：从标准输入异步读取完整文本。
 * @return {Promise<string>} 返回标准输入文本
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

/**
 * 功能描述：读取待处理文本，兼容命令行参数、文件和标准输入。
 * @param {Array<string>} args 命令行参数
 * @return {Promise<string>} 返回原始文本
 */
async function readInput(args) {
  const fileIndex = args.indexOf('--file');
  if (fileIndex >= 0) {
    const filePath = args[fileIndex + 1];
    if (!filePath) throw new Error('缺少 --file 后面的文件路径');
    return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8').trim();
  }

  const textArgs = args.filter((item, index) => {
    return item !== '--file' && args[index - 1] !== '--file';
  });
  if (textArgs.length > 0) return textArgs.join(' ');

  if (!process.stdin.isTTY) {
    return readStdin();
  }
  throw new Error('缺少待处理文本');
}

const [mode, ...inputArgs] = process.argv.slice(2);
if (!mode || mode === '--help' || mode === '-h') {
  printUsageAndExit(mode ? 0 : 1);
}
if (!['encrypt', 'decrypt'].includes(mode)) {
  console.error(`不支持的模式：${mode}`);
  printUsageAndExit(1);
}
if (!isCredentialEncryptionEnabled()) {
  console.error('缺少 CREDENTIAL_ENCRYPTION_KEY，请先在 .env 中配置或通过环境变量传入。');
  process.exit(1);
}

readInput(inputArgs)
  .then((input) => {
    const output = mode === 'encrypt'
      ? encryptCredential(input)
      : decryptCredential(input);
    process.stdout.write(`${output}\n`);
  })
  .catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
