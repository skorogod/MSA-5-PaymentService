// Payment worker: регистрирует обработчики задач в Zeebe и даёт HTTP-API для запуска платежа.
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { Camunda8 } = require('@camunda8/sdk');
const { handlers } = require('./handlers');

const PORT = Number(process.env.PORT || 3000);
const PROCESS_ID = 'payment-process';

const zeebe = new Camunda8().getZeebeGrpcApiClient();

for (const [taskType, taskHandler] of Object.entries(handlers)) {
  zeebe.createWorker({ taskType, taskHandler, timeout: 30_000 });
}
console.log(`${new Date().toISOString()} [WORKER] обработчики зарегистрированы: ${Object.keys(handlers).join(', ')}`);

// Значения по умолчанию = успешный сценарий
const DEFAULTS = {
  amount: 100,
  balance: 1000,
  chargeFails: false,
  fraudScenario: 'APPROVED', // APPROVED | REJECTED | MANUAL | TIMEOUT
  transferFails: false,
  refundFailures: 0,
  manualReviewTimeout: 'PT20M',
};

async function startPayment(input) {
  const variables = { ...DEFAULTS, ...input, paymentId: randomUUID().slice(0, 8) };
  const instance = await zeebe.createProcessInstance({ bpmnProcessId: PROCESS_ID, variables });
  console.log(`${new Date().toISOString()} [API] запущен платёж payment=${variables.paymentId} instance=${instance.processInstanceKey} сценарий=${JSON.stringify(input)}`);
  return { paymentId: variables.paymentId, processInstanceKey: instance.processInstanceKey };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function send(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ok' });
    if (req.method === 'POST' && req.url === '/payments') return send(res, 201, await startPayment(await readJson(req)));
    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(`${new Date().toISOString()} [API] ошибка: ${err.message}`);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`${new Date().toISOString()} [API] слушаю :${PORT}`));

process.on('SIGTERM', async () => {
  server.close();
  await zeebe.close();
  process.exit(0);
});
