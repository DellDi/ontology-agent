const SHANGHAI = 'Asia/Shanghai';

const DATE_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const TIME_ONLY = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SHANGHAI,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** 统一把 ISO/时间戳渲染为上海时区 24 小时制；非法输入原样返回避免吞错。 */
export function formatShanghaiDateTime(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return DATE_TIME.format(date);
}

export function formatShanghaiTime(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return TIME_ONLY.format(date);
}
