export type ValueOf<T> = T[keyof T];

export function defineEnum<T extends Record<string, string | number>>(o: T) {
  return o as Readonly<T> & { readonly type: T[keyof T] };
}
