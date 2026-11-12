// Shared by the server (cookie handling) and the client (switcher dropdown).
export const ACTING_LEADER_COOKIE = "acting_leader_id";

// Typed result for every action: expected failures are values, not thrown errors.
export type ActionFailure = { ok: false; code: string; message: string };
export type ActionResult<T extends object = object> = ({ ok: true } & T) | ActionFailure;
