/**
 * Whether `key` is an own property of `object`. Records keyed by section
 * keys are read through this, so a key such as `constructor` finds nothing
 * rather than reading Object.prototype.
 */
export function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}
