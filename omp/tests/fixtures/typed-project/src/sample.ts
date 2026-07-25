export function greet(name: string): string {
  return "hello " + name;
}

export const INTENTIONAL_BUG = 1 + "";
