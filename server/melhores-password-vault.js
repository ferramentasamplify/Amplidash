import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key() {
  const value = process.env.MELHORES_PASSWORD_VAULT_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Cofre de senhas indisponível.');
  return Buffer.from(value, 'hex');
}

// Bind the encrypted value to both the account and its current password hash.
export function sealPassword(password, account) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(account.id + ':' + account.hash));
  const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function openPassword(account) {
  const value = account.passwordVault;
  if (!value) return null;
  if (value.version !== 1) throw new Error('Versão do cofre inválida.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(value.iv, 'base64'));
  decipher.setAAD(Buffer.from(account.id + ':' + account.hash));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
}
