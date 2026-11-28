import type { DateChip } from '../../../shared/schema/types.js';
import { prepareExportText } from './escape.js';

function parts(dateTime: string): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$/.exec(dateTime);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  return { year, month, day, hour, minute };
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function formatTime12(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function weekdayName(year: number, month: number, day: number): string {
  const utc = new Date(Date.UTC(year, month - 1, day));
  return WEEKDAYS[utc.getUTCDay()];
}

export function formatDateChip(chip: DateChip): string {
  const parsed = parts(chip.dateTime);
  if (parsed === null) {
    return '';
  }
  const { year, month, day, hour, minute } = parsed;
  const monthName = MONTHS[month - 1] ?? '';
  let value: string;
  switch (chip.format) {
    case 'windows-short':
      value = `${month}/${day}/${year}`;
      break;
    case 'windows-long':
      value = `${weekdayName(year, month, day)}, ${monthName} ${day}, ${year}`;
      break;
    case 'month-day-year':
      value = `${monthName} ${day}, ${year}`;
      break;
    case 'day-month-year':
      value = `${day} ${monthName} ${year}`;
      break;
    case 'iso-date':
      value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      break;
    case 'short-date-time':
      value = `${month}/${day}/${year} ${formatTime12(hour, minute)}`;
      break;
    case 'time':
      value = formatTime12(hour, minute);
      break;
    default:
      value = chip.dateTime;
      break;
  }
  return prepareExportText(value);
}