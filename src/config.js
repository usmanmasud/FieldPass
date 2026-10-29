// All runtime configuration comes from environment variables so every
// marketplace instance can be configured at deploy time.
const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

const atUsername = env.AT_USERNAME || 'sandbox';

const config = {
  port: num(env.PORT, 3000),
  dbPath: env.DB_PATH || './data/fieldpass.db',
  // Render sets RENDER_EXTERNAL_URL automatically (https://<service>.onrender.com).
  publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/$/, ''),
  orgName: env.ORG_NAME || 'FieldPass',
  ussdCode: env.USSD_CODE || '*384*47704#',
  defaultLang: env.DEFAULT_LANG === 'en' ? 'en' : 'ha',
  countryCode: env.COUNTRY_CODE || '234',
  currency: env.CURRENCY || 'NGN',
  adminPassword: env.ADMIN_PASSWORD || '',
  seedDemo: env.SEED_DEMO === 'true',
  voiceAlerts: env.VOICE_ALERTS === 'true',
  wards: env.WARDS || '',
  at: {
    username: atUsername,
    apiKey: env.AT_API_KEY || '',
    senderId: env.AT_SENDER_ID || '',
    voiceNumber: env.AT_VOICE_NUMBER || '',
    sandbox: atUsername === 'sandbox',
  },
  rewards: {
    statusUpdate: num(env.REWARD_STATUS_UPDATE, 50),
    completion: num(env.REWARD_BOOKING_COMPLETE, 100),
    dailyCap: num(env.REWARD_DAILY_CAP, 300),
    // A field must have been registered this many days before a harvest
    // update earns airtime, so fake "register then harvest" spam pays nothing.
    minFieldAgeDays: num(env.REWARD_MIN_FIELD_AGE_DAYS, 3),
  },
};

// Without an API key nothing is sent to Africa's Talking; every outbound
// SMS / call / airtime is written to the message log instead.
config.dryRun = !config.at.apiKey;

export default config;
