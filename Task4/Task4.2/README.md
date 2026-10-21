# Task 4.2 — прототип платёжного процесса на Camunda 8

Оркестрация платёжной саги OrchestrPay на BPMN-движке Camunda 8 (Zeebe 8.5). Процесс — исполняемая версия диаграммы из [Task4.1](../Task4.1/diagram.bpmn), обработчики шагов — сервис `payment-worker` на Node.js.

## Состав

| Путь | Что это |
| --- | --- |
| [docker-compose.yml](docker-compose.yml) | Стек: Zeebe, Operate, Tasklist, Elasticsearch, деплой процесса, `payment-worker` |
| [deploy-process/Dockerfile](deploy-process/Dockerfile) | Образ с `zbctl`, деплоит `process.bpmn` в Zeebe при старте стека |
| [process.bpmn](process.bpmn) | Исполняемый процесс `payment-process` |
| [payment-worker/](payment-worker/) | Сервис: обработчики задач + HTTP-API для запуска платежа |
| [scripts/run-scenarios.sh](scripts/run-scenarios.sh) | Запуск всех сценариев |
| [screenshots/](screenshots/) | Скриншоты Tasklist, Operate и лога сервиса |

## Запуск

```bash
cd Task4/Task4.2
cp .env.tamplate .env        # если .env ещё нет
docker compose up -d --build
./scripts/run-scenarios.sh
```

| UI | Адрес | Логин |
| --- | --- | --- |
| Tasklist | http://localhost:8082 | demo / demo |
| Operate | http://localhost:8081 | demo / demo |
| payment-worker API | http://localhost:3000 | — |

Лог обработчиков: `docker compose logs -f payment-worker`.

## Процесс

Из диаграммы 4.1 исполняемая версия отличается только техническими деталями:

- у каждой Service Task есть тип задачи (`zeebe:taskDefinition`), его обрабатывает `payment-worker`;
- условия ветвлений (`yes/no`, `accepted/manual/rejected`) заданы FEEL-выражениями на стрелках;
- таймеры: cut-off автопроверки `PT5S`, cut-off ручной проверки — переменная `manualReviewTimeout` (по умолчанию `PT20M`);
- ошибки: `CHARGE_FAILED` (списание) и `TRANSFER_FAILED` (перевод контрагенту) — Error Boundary Events;
- ручная проверка MANUAL_CHECK — User Task с формой «Разрешить / Запретить» в Tasklist;
- откат саги — Compensation Throw Event: движок вызывает обработчики `REFUND_USER` и `CANCEL_PAYMENT` у выполненных шагов;
- повтор возврата (маркер Loop в 4.1) реализован через job retries: у `refund-user` 5 попыток с паузой 2 с.

## Обработчики

| Тип задачи | Шаг | Что делает |
| --- | --- | --- |
| `create-payment` | CREATE_PAYMENT | статус NEW |
| `check-availability` | CHECK_PAYMENT_AVAILABILITY | `paymentAvailable = balance >= amount` |
| `pre-payment` | PRE_PAYMENT | списание → DEBITED, при `chargeFails` — BPMN error `CHARGE_FAILED` |
| `auto-fraud-check` | AUTO_CHECK | эмуляция антифрода: APPROVED / REJECTED / MANUAL / TIMEOUT (ответ через 7 с → cut-off) |
| `payment-to-counterpart` | PAYMENT_TO_CONTERPART (pivot) | перевод → COMPLETED, при `transferFails` — BPMN error `TRANSFER_FAILED` |
| `prohibit-payment`, `notify-security` | PROHIBIT_PAYMENT, NOTIFY_SECURITY | выполняются параллельно, статус BLOCKED |
| `refund-user` | REFUND_USER (компенсация PRE_PAYMENT) | возврат; первые `refundFailures` попыток «падают» → повтор |
| `cancel-payment` | CANCEL_PAYMENT (ветка отмены и компенсация CREATE_PAYMENT) | аннулирование платежа |
| `notify-user-*` | NOTIFY_USER_* | уведомления клиента |

## Сценарии

`POST /payments` запускает процесс. Тело задаёт сценарий, пустое тело — успешный платёж.

| # | Тело запроса | Результат |
| --- | --- | --- |
| 1 | `{}` | COMPLETED |
| 2 | `{"amount": 5000, "balance": 1000}` | нехватка средств → CANCELED |
| 3 | `{"chargeFails": true}` | ошибка списания → CANCELED |
| 4 | `{"fraudScenario": "REJECTED"}` | запрет → PROHIBIT + NOTIFY_SECURITY → компенсация → REFUNDED |
| 5 | `{"fraudScenario": "TIMEOUT"}` | антифрод молчит 5 с → cut-off → COMPLETED |
| 6 | `{"transferFails": true, "refundFailures": 2}` | перевод упал → компенсация, возврат с 3-й попытки → REFUNDED |
| 7 | `{"fraudScenario": "MANUAL"}` | задача в Tasklist → «Разрешить» → COMPLETED |
| 8 | `{"fraudScenario": "MANUAL"}` | задача в Tasklist → «Запретить» → REFUNDED |
| 9 | `{"fraudScenario": "MANUAL", "manualReviewTimeout": "PT1M"}` | оператор не ответил за 1 мин → cut-off → COMPLETED |

```bash
curl -X POST localhost:3000/payments -H 'Content-Type: application/json' -d '{"fraudScenario": "MANUAL"}'
```

## Скриншоты

- `tasklist-01-open-tasks.png` — задачи ручной проверки в Tasklist
- `tasklist-02-manual-check-approve.png` — оператор разрешает платёж
- `tasklist-03-manual-check-reject.png` — оператор запрещает платёж
- `tasklist-04-completed-tasks.png`, `tasklist-05-completed-task-details.png` — выполненные задачи
- `operate-01-instances.png` — все экземпляры процесса
- `operate-02-success.png`, `operate-03-transfer-failed-refund-retry.png`, `operate-04-manual-reject-compensation.png` — пройденные пути
- `worker-log.png` — лог `payment-worker`, где видны вызовы всех обработчиков
