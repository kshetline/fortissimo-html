export function processMillis(): number {
  if (typeof performance !== 'undefined')
    return performance.now();
  else if (typeof process !== 'undefined') {
    if ((process.hrtime as any).bigint)
      return Number((process.hrtime as any).bigint()) / 1000000;
    else {
      const time = process.hrtime();

      return time[0] * 1000 + time[1] / 1000000;
    }
  }
  else
    return Date.now();
}
