import type { BodyInline, DateChip } from '../schema/types.js';

export const DATE_CHIP_FORMATS = [
  'windows-short',
  'windows-long',
  'month-day-year',
  'day-month-year',
  'iso-date',
  'short-date-time',
  'time',
] as const;

export type DateChipFormat = DateChip['format'];

const MONTH_NAMES = [
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

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function parseDateTime(value: string): DateTimeParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!isRealDateTime(value)) {
    return null;
  }
  return { year, month, day, hour, minute };
}

export function isRealDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) {
    return false;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = monthLengths[month] ?? 0;
  return day <= maxDay;
}

function formatClock12(hour: number, minute: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${twelve}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function windowsShortDate(parts: DateTimeParts): string {
  return `${parts.month}/${parts.day}/${parts.year}`;
}

export const DATE_CHIP_FORMAT_LABELS: Readonly<Record<DateChipFormat, string>> = {
  'windows-short': 'Windows short date',
  'windows-long': 'Windows long date',
  'month-day-year': 'Month day, year',
  'day-month-year': 'Day month year (MLA)',
  'iso-date': 'ISO date',
  'short-date-time': 'Short date and time',
  time: 'Time only',
};

export function formatDateTime(dateTime: string, format: DateChipFormat): string {
  const parts = parseDateTime(dateTime);
  if (parts === null) {
    return '';
  }
  const monthName = MONTH_NAMES[parts.month - 1] ?? '';
  const weekday = weekdayFor(parts);
  const clock = formatClock12(parts.hour, parts.minute);
  switch (format) {
    case 'windows-short':
      return windowsShortDate(parts);
    case 'windows-long':
      return `${weekday}, ${monthName} ${parts.day}, ${parts.year}`;
    case 'month-day-year':
      return `${monthName} ${parts.day}, ${parts.year}`;
    case 'day-month-year':
      return `${parts.day} ${monthName} ${parts.year}`;
    case 'iso-date':
      return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    case 'short-date-time':
      return `${windowsShortDate(parts)} ${clock}`;
    case 'time':
      return clock;
    default:
      return windowsShortDate(parts);
  }
}

function weekdayFor(parts: DateTimeParts): string {
  const date = new Date(parts.year, parts.month - 1, parts.day);
  return WEEKDAY_NAMES[date.getDay()] ?? '';
}

export function nowLocalDateTime(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function partsToDateInput(parts: DateTimeParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function partsToTimeInput(parts: DateTimeParts): string {
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function dateTimeFromFields(dateValue: string, timeValue: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) {
    return null;
  }
  const candidate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${timeMatch[1]}:${timeMatch[2]}`;
  return isRealDateTime(candidate) ? candidate : null;
}

export function formattedInlineText(content: readonly BodyInline[]): string {
  let text = '';
  for (const item of content) {
    if (item.type === 'text' || item.type === 'link') {
      text += item.text;
    } else if (item.type === 'dateChip') {
      text += formatDateTime(item.dateTime, item.format);
    }
  }
  return text;
}