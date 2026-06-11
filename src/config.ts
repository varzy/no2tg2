function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少必需的环境变量：${name}`);
  }
  return value;
}

export const config = {
  notion: {
    token: requireEnv('NOTION_TOKEN'),
    dataSourceId: requireEnv('NOTION_DATABASE_ID'),
  },
  telegram: {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    chatId: requireEnv('TELEGRAM_CHAT_ID'),
  },
  smms: {
    apiToken: requireEnv('SMMS_API_TOKEN'),
  },
} as const;
