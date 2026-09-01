import { Pool, types } from 'pg'
import { env } from './env.js'

// OID 1082 = tipo DATE do Postgres. Por padrão o driver `pg` converte DATE em um objeto
// JS Date à meia-noite no fuso horário do processo, o que introduz bug de fuso horário
// (princípio #4 do documento técnico: DATE nunca deveria carregar componente de hora).
// Mantemos a string 'YYYY-MM-DD' crua, sem parsing.
types.setTypeParser(1082, (value: string) => value)

export const pool = new Pool({ connectionString: env.databaseUrl })
