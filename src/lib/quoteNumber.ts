export function generateQuoteNumber(date = new Date()): string {
  const year = date.getFullYear();
  const seq = Math.floor(Math.random() * 900000) + 100000;
  return `R365-${year}-${seq}`;
}
