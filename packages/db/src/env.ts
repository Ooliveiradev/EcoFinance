import { config } from 'dotenv';
import { basename, resolve } from 'node:path';

// Explicit process variables take precedence. Local workspace .env overrides root .env.
const cwd = process.cwd();
const root = ['db', 'next'].includes(basename(cwd)) ? resolve(cwd, '../..') : cwd;
config({ path: resolve(cwd, '.env') });
config({ path: resolve(root, '.env') });
