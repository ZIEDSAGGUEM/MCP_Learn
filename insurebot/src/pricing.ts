// A toy pricing model. Good enough to produce believable monthly premiums.
const BASE_EUR = 25;

export function priceFor(age: number, smoker: boolean, conditions: string[]): number {
  let price = BASE_EUR + Math.max(0, age - 25) * 1.2;
  if (smoker) price *= 1.6;
  price *= 1 + 0.15 * conditions.length;
  return Math.round(price * 100) / 100;
}
