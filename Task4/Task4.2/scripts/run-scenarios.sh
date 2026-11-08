#!/usr/bin/env bash
# Запускает платежи по всем сценариям процесса. Требует запущенный стек (docker compose up -d).
set -euo pipefail
API=${API:-http://localhost:3000}

pay() {
  local title=$1 body=$2
  printf '%-40s ' "$title"
  curl -sf -X POST "$API/payments" -H 'Content-Type: application/json' -d "$body"
  echo
}

pay "1. Успех"                          '{}'
pay "2. Недостаточно средств"           '{"amount": 5000, "balance": 1000}'
pay "3. Ошибка списания"                '{"chargeFails": true}'
pay "4. Антифрод запретил"              '{"fraudScenario": "REJECTED"}'
pay "5. Антифрод не ответил (cut-off)"  '{"fraudScenario": "TIMEOUT"}'
pay "6. Перевод не прошёл + 2 повтора возврата" '{"transferFails": true, "refundFailures": 2}'
pay "7. Ручная проверка (решить в Tasklist)"     '{"fraudScenario": "MANUAL"}'
pay "8. Ручная проверка (решить в Tasklist)"     '{"fraudScenario": "MANUAL"}'
pay "9. Ручная проверка, cut-off 1 мин"          '{"fraudScenario": "MANUAL", "manualReviewTimeout": "PT1M"}'

echo
echo "Ручные проверки: откройте Tasklist http://localhost:8082 (demo/demo) — одну задачу разрешите, другую запретите."
echo "Ход процессов: Operate http://localhost:8081 (demo/demo). Лог обработчиков: docker compose logs payment-worker"
