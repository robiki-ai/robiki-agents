import { isObject, isUndefined, isNull } from './types';

export function merge<T>(args: Partial<T>[]): T {
  return args.reduce<Partial<T>>((acc, curr) => {
    if (!curr) return acc;
    Object.entries(curr).forEach(([key, value]) => {
      if (isUndefined(value) || isNull(value)) return;
      if (isObject(value)) {
        const prev = acc[key as keyof T] as Partial<T[keyof T]>;
        acc[key as keyof T] = merge<T[keyof T]>([isObject(prev) ? prev : {}, value as Partial<T[keyof T]>]);
        return;
      }
      acc[key as keyof T] = value as T[keyof T];
    });
    return acc;
  }, {} as T) as T;
}
