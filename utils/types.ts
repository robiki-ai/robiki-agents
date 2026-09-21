export function type(v: any): string {
  return Object.prototype.toString.call(v).slice(8, -1).toLowerCase();
}

export function isObject(v: any): boolean {
  return type(v) === 'object';
}

export function isString(v: any): boolean {
  return type(v) === 'string';
}

export function isNumber(v: any): boolean {
  return type(v) === 'number';
}

export function isBoolean(v: any): boolean {
  return type(v) === 'boolean';
}

export function isFunction(v: any): boolean {
  return type(v) === 'function';
}

export function isArray(v: any): boolean {
  return type(v) === 'array';
}

export function isNull(v: any): boolean {
  return type(v) === 'null';
}

export function isUndefined(v: any): boolean {
  return type(v) === 'undefined';
}
