import { resolve } from 'node:path';

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const number = (key: string, fallback: number, min = 0, max = 1e9) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const integer = (key: string, fallback: number, min = 0, max = 10000) => {
    const value = number(key, fallback, min, max);
    if (!Number.isSafeInteger(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  const boolean = (key: string) => {
    if (env[key] && !['true', 'false'].includes(env[key]!)) throw new Error(`Invalid ${key}`);
    return env[key] === 'true';
  };
  const provider = env.GENERATION_PROVIDER ?? 'disabled';
  const mode = env.CONTENT_MODE ?? 'source-grounded';
  if (!['disabled', 'gemini', 'openai'].includes(provider)) throw new Error('Invalid GENERATION_PROVIDER');
  if (!['source-grounded', 'ai-only'].includes(mode)) throw new Error('Invalid CONTENT_MODE');
  const token = env.BACKEND_DEVICE_TOKEN ?? '';
  const thinkingLevel = env.GEMINI_THINKING_LEVEL || undefined;
  if (thinkingLevel && !['low', 'medium', 'high'].includes(thinkingLevel)) throw new Error('Invalid GEMINI_THINKING_LEVEL');
  if (token.length < 32) throw new Error('BACKEND_DEVICE_TOKEN must contain at least 32 characters');
  const config = {
    host: env.BACKEND_HOST ?? '127.0.0.1', port: integer('BACKEND_PORT', 4319, 0, 65535),
    token, database: resolve(env.BACKEND_DATABASE ?? './data/backend.sqlite'), provider, thinkingLevel,
    mode: mode as 'source-grounded' | 'ai-only',
    key: provider === 'gemini' ? env.GEMINI_API_KEY : env.OPENAI_API_KEY,
    model: provider === 'gemini' ? env.GEMINI_MODEL : env.OPENAI_MODEL,
    geminiFallbackModel: env.GEMINI_FALLBACK_MODEL || undefined,
    openaiFallbackEnabled: boolean('OPENAI_FALLBACK_ENABLED'),
    openaiKey: env.OPENAI_API_KEY, openaiModel: env.OPENAI_MODEL,
    freeConfirmed: boolean('GEMINI_FREE_TIER_CONFIRMED'), paid: boolean('ALLOW_PAID_CALLS'),
    requestLimit: integer('DAILY_REQUEST_LIMIT', 10), tokenLimit: integer('DAILY_TOKEN_LIMIT', 50000, 0, 1e9),
    costLimit: number('DAILY_COST_LIMIT', 0), requestCost: number('MAX_REQUEST_COST', 0),
    maxInput: integer('MAX_INPUT_TOKENS', 8000, 1, 100000), maxOutput: integer('MAX_OUTPUT_TOKENS', 4096, 128, 32000),
    unreadMin: integer('UNREAD_MIN', 50), refillAt: integer('UNREAD_REFILL_AT', 55), target: integer('UNREAD_TARGET', 60),
    readLimit: integer('READ_NONFAVORITE_LIMIT', 30), batch: integer('GENERATION_BATCH_SIZE', 10, 1, 10),
    concurrency: integer('MAX_CONCURRENT_JOBS', 1, 1, 4), cacheLimit: integer('MAX_CACHE_CARDS', 500, 1),
    timeout: integer('REQUEST_TIMEOUT_MS', 30000, 100, 60000),
    userAgent: env.WIKIMEDIA_USER_AGENT ?? 'JigyaByte/0.1 (personal local learning backend)',
  };
  if (!(config.unreadMin <= config.refillAt && config.refillAt < config.target)) throw new Error('Invalid unread threshold ordering');
  if (provider !== 'disabled' && (!config.key || !config.model || !/^[a-zA-Z0-9_.-]+$/.test(config.model))) {
    throw new Error('Selected provider requires a server key and explicit model ID');
  }
  if (provider !== 'disabled' && !(config.paid ? config.costLimit > 0 && config.requestCost > 0 : provider === 'gemini' && config.freeConfirmed)) {
    throw new Error('Provider activation requires confirmed Gemini free tier or approved paid budget and maximum request cost');
  }
  if (config.geminiFallbackModel && (provider !== 'gemini' || !/^[a-zA-Z0-9_.-]+$/.test(config.geminiFallbackModel) || config.geminiFallbackModel === config.model)) {
    throw new Error('Invalid GEMINI_FALLBACK_MODEL');
  }
  if (config.openaiFallbackEnabled && (provider !== 'gemini' || !config.paid || !config.openaiKey || !config.openaiModel || !/^[a-zA-Z0-9_.-]+$/.test(config.openaiModel))) {
    throw new Error('OpenAI fallback requires a server key, explicit model and approved paid budget');
  }
  return config;
}
export type Config = ReturnType<typeof readConfig>;

// Only explicitly configured routes participate; adding a secret never enables spending.
export function providerRoutes(config: Config): Config[] {
  const primary = config.provider === 'gemini' && config.freeConfirmed && config.openaiFallbackEnabled ? { ...config, paid: false } : config;
  return [primary,
    ...(config.provider === 'gemini' && config.geminiFallbackModel ? [{ ...primary, model: config.geminiFallbackModel }] : []),
    ...(config.openaiFallbackEnabled ? [{ ...config, provider: 'openai', key: config.openaiKey, model: config.openaiModel, paid: true, thinkingLevel: undefined }] : []),
  ];
}
