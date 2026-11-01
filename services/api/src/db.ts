import postgres from 'postgres';
import type { Env } from './types';

export function getDatabase(env: Env) {
  const connectionString = env.HYPERDRIVE?.connectionString;
  if (!connectionString) throw new Error('database_not_configured');
  return postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10
  });
}
