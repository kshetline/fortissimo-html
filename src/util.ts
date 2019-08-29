let performanceCopy: any;
let processCopy: any;

try {
  performanceCopy = performance;
}
catch (err) {}

try {
  processCopy = process && process.hrtime;
}
catch (err) {}

export function processMillis(): number {
  if (performanceCopy)
    return performanceCopy.now();
  else if (processCopy) {
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
