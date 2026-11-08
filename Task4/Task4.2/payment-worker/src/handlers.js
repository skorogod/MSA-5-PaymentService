// Обработчики шагов платёжной саги (типы задач из process.bpmn).
// Сервисы Payment / FraudCheck / Notification эмулируются: поведение задаётся переменными сценария.

const REFUND_RETRIES = 5; // совпадает с retries у refund-user в process.bpmn
const COMPENSATE_CREATE_PAYMENT = 'Activity_0wivbqw'; // id обработчика компенсации в process.bpmn

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(step, job, message) {
  const { paymentId, amount } = job.variables;
  console.log(`${new Date().toISOString()} [${step}] payment=${paymentId} amount=${amount} ${message}`);
}

const handlers = {
  'create-payment': (job) => {
    log('CREATE_PAYMENT', job, 'платёж создан -> NEW');
    return job.complete({ status: 'NEW' });
  },

  'check-availability': (job) => {
    const { amount, balance } = job.variables;
    const paymentAvailable = balance >= amount;
    log('CHECK_PAYMENT_AVAILABILITY', job, `balance=${balance} -> ${paymentAvailable ? 'средств достаточно' : 'средств недостаточно'}`);
    return job.complete({ paymentAvailable });
  },

  'pre-payment': (job) => {
    const { amount, balance, chargeFails } = job.variables;
    if (chargeFails) {
      log('PRE_PAYMENT', job, 'ошибка списания -> BPMN error CHARGE_FAILED');
      return job.error('CHARGE_FAILED', 'Не удалось списать средства');
    }
    log('PRE_PAYMENT', job, `списано, balance=${balance - amount} -> DEBITED`);
    return job.complete({ status: 'DEBITED', balance: balance - amount });
  },

  'auto-fraud-check': async (job) => {
    const { fraudScenario = 'APPROVED' } = job.variables;
    log('AUTO_CHECK', job, `FRAUD_CHECK, сценарий=${fraudScenario}`);
    if (fraudScenario === 'TIMEOUT') {
      // Антифрод «завис»: через 5 с сработает boundary-таймер и платёж уйдёт в APPROVED (cut-off)
      await sleep(7000);
      log('AUTO_CHECK', job, 'ответ опоздал, задачу уже снял таймер cut-off');
      return job.complete({ fraudDecision: 'APPROVED' }).catch(() => job.forward());
    }
    const status = { APPROVED: 'APPROVED', REJECTED: 'BLOCKED', MANUAL: 'MANUAL_REVIEW' }[fraudScenario];
    log('AUTO_CHECK', job, `решение=${fraudScenario} -> ${status}`);
    return job.complete({ fraudDecision: fraudScenario, status });
  },

  'payment-to-counterpart': (job) => {
    if (job.variables.transferFails) {
      log('PAYMENT_TO_CONTERPART', job, 'перевод не прошёл -> BPMN error TRANSFER_FAILED');
      return job.error('TRANSFER_FAILED', 'Не удалось перевести средства контрагенту');
    }
    log('PAYMENT_TO_CONTERPART', job, 'APPROVED -> средства переведены контрагенту (pivot) -> COMPLETED');
    return job.complete({ status: 'COMPLETED' });
  },

  'notify-user-success': (job) => {
    log('NOTIFY_USER_SUCCESS', job, 'клиент уведомлён об успешной оплате');
    return job.complete();
  },

  'prohibit-payment': (job) => {
    log('PROHIBIT_PAYMENT', job, 'платёж помечен запрещённым -> BLOCKED');
    return job.complete({ status: 'BLOCKED' });
  },

  'notify-security': (job) => {
    log('NOTIFY_SECURITY', job, 'служба безопасности уведомлена');
    return job.complete();
  },

  // Компенсация PRE_PAYMENT. Повторяется через job retries, пока возврат не пройдёт.
  'refund-user': (job) => {
    const { amount, balance, refundFailures = 0 } = job.variables;
    const attempt = REFUND_RETRIES - job.retries + 1;
    if (attempt <= refundFailures) {
      log('REFUND_USER', job, `REFUNDING, попытка ${attempt} не удалась, повтор`);
      return job.fail({ errorMessage: 'Payment Service недоступен', retries: job.retries - 1, retryBackOff: 2000 });
    }
    log('REFUND_USER', job, `REFUNDING, попытка ${attempt}: средства возвращены, balance=${balance + amount}`);
    return job.complete({ status: 'REFUNDING', balance: balance + amount });
  },

  // Используется и в ветке отмены, и как компенсация CREATE_PAYMENT (isForCompensation)
  'cancel-payment': (job) => {
    if (job.elementId === COMPENSATE_CREATE_PAYMENT) {
      log('CANCEL_PAYMENT', job, 'компенсация CREATE_PAYMENT: платёж аннулирован');
      return job.complete();
    }
    log('CANCEL_PAYMENT', job, 'платёж аннулирован');
    return job.complete({ status: 'CANCELLED' });
  },

  'notify-user-not-available': (job) => {
    log('NOTIFY_USER_NOT_AVAILABLE', job, 'клиент уведомлён об отмене платежа -> CANCELLED');
    return job.complete({ status: 'CANCELLED' });
  },

  'notify-user-refund': (job) => {
    log('NOTIFY_USER_REFUND', job, 'клиент уведомлён о возврате средств -> REFUNDED');
    return job.complete({ status: 'REFUNDED' });
  },
};

module.exports = { handlers };
