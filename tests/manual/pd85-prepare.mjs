// E1.07-D3-R1-C1 — preparação de uma base FICTÍCIA e descartável para o ensaio físico da PD-85
// (CLI de recuperação numa consola real do Windows). Protocolo: docs/tasks/E1.07-D3-R1-C3.md §8
// (W-01 a W-28 com as saídas 0/5/10 da C3; substitui E1.07-D3-R1-C2 §6 e E1.07-D3-R1-C1 §6).
//
// Cria uma pasta nova em %TEMP% (E107-D3-R1-C1-PD85-<data>), inicializa a instalação com um
// administrador fictício e uma palavra-passe aleatória, e mostra os comandos do PowerShell para o
// ensaio. Nunca usar com dados reais nem fora de uma pasta temporária. Exige `pnpm.cmd build`.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(root, 'services', 'local-api', 'dist');
if (!existsSync(path.join(dist, 'main.js'))) {
  console.error('Falta services/local-api/dist: execute primeiro "pnpm.cmd build".');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const directory = path.join(tmpdir(), `E107-D3-R1-C1-PD85-${stamp}`);
mkdirSync(directory);
const env = {
  LOCAL_DATABASE_PATH: path.join(directory, 'kil-pd85.sqlite'),
  LOCAL_SERVICE_ENVIRONMENT: 'test',
  LOCAL_SERVICE_INSTANCE_ID: 'pd85',
  LOCAL_SERVICE_LOG_LEVEL: 'info',
  LOCAL_SERVICE_ON_MISSING_DATABASE: 'create',
  LOCAL_SERVICE_ON_PENDING_MIGRATIONS: 'apply',
};

const load = (file) => import(pathToFileURL(path.join(dist, file)).href);
const { loadLocalServiceConfigFromEnv } = await load('config.js');
const { createLocalService } = await load('local-service.js');
const { createJsonLogger } = await load('logger.js');
const { resolveProtectedDirectories } = await load('protected-directories.js');

const protectedDirectories = resolveProtectedDirectories(dist + path.sep);
const config = loadLocalServiceConfigFromEnv(env, { protectedDirectories });
const service = createLocalService(config, {
  logger: createJsonLogger({ instanceId: 'pd85-prepare', level: 'error', sink: () => undefined }),
  protectedDirectories,
});
const username = 'admin.pd85';
// Palavra-passe fictícia e aleatória, só para esta base descartável.
const password = `ensaio pd85 ${randomBytes(9).toString('base64url')} ficticio`;
await service.start();
await service.identityProvisioning.installation.initialise({ displayName: 'Administrador Fictício PD-85', id: randomUUID(), username }, password);
await service.stop();

const quote = (value) => `'${value.replace(/'/g, "''")}'`;
console.log(
  [
    'Base FICTÍCIA criada para o ensaio da PD-85 (nunca usar dados reais).',
    `Pasta: ${directory}`,
    `Utilizador: ${username}`,
    `Palavra-passe fictícia: ${password}`,
    '',
    'Na consola a ensaiar (PowerShell 5.1 e Windows Terminal), no directório do repositório:',
    `  $env:LOCAL_DATABASE_PATH = ${quote(env.LOCAL_DATABASE_PATH)}`,
    "  $env:LOCAL_SERVICE_ENVIRONMENT = 'test'",
    "  $env:LOCAL_SERVICE_INSTANCE_ID = 'pd85'",
    "  $env:LOCAL_SERVICE_LOG_LEVEL = 'info'",
    "  $env:LOCAL_SERVICE_ON_MISSING_DATABASE = 'fail'",
    "  $env:LOCAL_SERVICE_ON_PENDING_MIGRATIONS = 'fail'",
    '  node services\\local-api\\dist\\main.js recovery rotate; "SAIDA=$LASTEXITCODE"',
    '',
    'W-14 (serviço normal noutra consola): definir as MESMAS variáveis também nessa segunda consola.',
    'Protocolo completo (W-01 a W-28; saídas 0, 5 e 10 depois do commit): docs/tasks/E1.07-D3-R1-C3.md §8.',
    '',
    'No fim, remover a pasta (caminho literal, confirmado):',
    `  node -e "require('node:fs').rmSync(${JSON.stringify(directory).replace(/"/g, "'")}, { recursive: true })"`,
  ].join('\n'),
);
