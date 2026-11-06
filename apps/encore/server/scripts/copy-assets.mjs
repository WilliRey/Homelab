// tsc doesn't copy non-TS files; migrations ship next to the compiled db module.
import { cpSync } from 'node:fs';
cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
