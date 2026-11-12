// Typed result for every action: expected failures are values, not thrown errors.
export type ActionFailure<C extends string = string> = { ok: false; code: C; message: string };
export type ActionResult<T extends object = object, C extends string = string> =
  ({ ok: true } & T) | ActionFailure<C>;
