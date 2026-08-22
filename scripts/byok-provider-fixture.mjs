import http from 'node:http';

const expected = process.env.BYOK_FIXTURE_AUTH || 'Bearer synthetic-fixture-token';
const counters = { authorized: 0, unauthorized: 0, methods: {}, models: {} };
const server = http.createServer(async (request, response) => {
  const authorized = request.headers.authorization === expected;
  counters[authorized ? 'authorized' : 'unauthorized'] += 1;
  counters.methods[request.method] = (counters.methods[request.method] || 0) + 1;
  if (request.url === '/stats') return json(response, 200, counters);
  if (!authorized) return json(response, 401, { error: { code: 'unauthorized' } });
  // Endpoint prefix that refuses every request with 400, whatever the phase.
  if (request.url.startsWith('/refuse/')) return json(response, 400, { error: { code: 'bad_request' } });
  if (request.method === 'GET' && request.url === '/v1/models') return json(response, 200, { data: [{ id: 'fixture-z' }, { id: 'fixture-a' }] });
  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    const body = await read(request); const model = typeof body.model === 'string' ? body.model : 'missing';
    counters.models[model] = (counters.models[model] || 0) + 1;
    // Models the provider knows but refuses to serve: rejected requests, not a missing model.
    if (model === 'fixture-legacy') return json(response, 400, { error: { code: 'unsupported_model_parameters' } });
    if (model === 'fixture-unprocessable') return json(response, 422, { error: { code: 'unprocessable_model_request' } });
    if (!['fixture-a', 'fixture-z'].includes(model)) return json(response, 404, { error: { code: 'model_not_found' } });
    const requestData = parseTask(body); const result = requestData.taskId === 'analyse_document'
      ? { subject: 'facture', documentType: 'facture', dates: ['2026-08-16'], topics: ['électricité'], purpose: 'classement', parties: ['Fixture'], identifiers: ['F-16'], amount: null, signals: ['document_type', 'document_date'] }
      : requestData.taskId === 'suggest_filename'
        ? { value: '2026-08-16_facture_fixture_F-16', confidence: .9, signals: ['document_type'], reviewRequired: false, failureReason: null }
        : { path: '/Comptabilité/Électricité', confidence: .9, signals: ['matched_folder_path'], reviewRequired: false, failureReason: null };
    return json(response, 200, { choices: [{ message: { content: JSON.stringify(result) } }] });
  }
  return json(response, 404, { error: { code: 'not_found' } });
});
server.listen(Number(process.env.BYOK_FIXTURE_PORT || 0), '127.0.0.1', () => process.stdout.write(`${server.address().port}\n`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
function json(response, status, body) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); }
async function read(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; } }
function parseTask(body) { try { const content = body.messages?.find((message) => message.role === 'user')?.content; return JSON.parse(content || '{}'); } catch { return {}; } }
