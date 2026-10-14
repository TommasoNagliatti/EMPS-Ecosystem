import { createBridgeState, handleOfficialTestRequest } from '@/server/official-test-bridge';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const state = createBridgeState();
const directory = join(process.cwd(), 'tmp', 'official-cash-test');
const journal = join(directory, 'sessions.jsonl');
let initialized = false;

function prepareJournal() {
  if (initialized) return;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(journal)) {
    const records = readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { id: string; chargerId: string; operatorId: string });
    if (records.length > 1024 || records.some(row => !/^\d+$/.test(row.id) || !['49', '50', '51'].includes(row.chargerId) || !/^\d+$/.test(row.operatorId))) throw new Error('Invalid local test journal');
    for (const { id, chargerId, operatorId } of records) state.sessions.set(id, { chargerId, operatorId });
  }
  // Verify local audit storage before a request can create a record in the official database.
  appendFileSync(journal, '', { mode: 0o600 });
  initialized = true;
}

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (process.env.EMPS_OFFICIAL_TEST_BRIDGE === 'true') {
    try { prepareJournal(); }
    catch { return Response.json({ message: 'Nao foi possivel abrir o registro local dos testes. Nenhuma nova operacao foi enviada.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  }
  return handleOfficialTestRequest(request, path, {
    enabled: process.env.EMPS_OFFICIAL_TEST_BRIDGE === 'true',
    sandboxVerifiedUntil: Date.parse(process.env.EMPS_SANDBOX_VERIFIED_UNTIL ?? ''),
    state,
    onSessionCreated: (id, session) => appendFileSync(journal, JSON.stringify({ id, ...session }) + '\n', { mode: 0o600 }),
  });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
