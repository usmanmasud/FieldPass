import config from './config.js';
import { createApp } from './server.js';
import { startJobs } from './jobs.js';
import { seedDemo } from './seed/demo.js';

if (config.seedDemo) seedDemo();

createApp().listen(config.port, () => {
  const mode = config.dryRun ? 'DRY-RUN (no AT_API_KEY: messages are only logged)' : config.at.sandbox ? 'sandbox' : 'live';
  console.log(`FieldPass listening on :${config.port} [${mode}]`);
});
startJobs();
