/**
 * True when `TActual` and `TExpected` are the same type. Unlike mutual assignability, this
 * tells `any` and an untyped document apart from a generated document type.
 */
export type Equal<TActual, TExpected> =
  (<T>() => T extends TActual ? 1 : 2) extends <T>() => T extends TExpected ? 1 : 2 ? true : false

/** Fails to compile unless its type argument is `true`: `expectTrue<Equal<A, B>>()`. */
export const expectTrue = <_TCheck extends true>(): void => {}
