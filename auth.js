import { runAuthFlow } from './src/core/googleAuth.js';

runAuthFlow()
  .then(() => process.exit(0))
  .catch(err => { console.error(err.message); process.exit(1); });
