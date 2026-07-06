const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function toDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${day} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatTime(value) {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat('es-EC', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Guayaquil'
  }).format(date);
}

function daysUntil(value) {
  const date = toDate(value);
  if (!date) {
    return 0;
  }
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.max(0, Math.ceil((end - start) / 86400000));
}

function membershipStatus(endDate, storedStatus) {
  const days = daysUntil(endDate);
  if (storedStatus === 'Cancelada') {
    return 'Vencida';
  }
  if (days <= 0) {
    return 'Vencida';
  }
  if (days <= 7) {
    return 'Por vencer';
  }
  return 'Activa';
}

module.exports = {
  formatDate,
  formatTime,
  daysUntil,
  membershipStatus
};
