// ONE generic factory for a fire-and-forget command — matches midi-core's own Action
// (`{ def, invoke }`): something with an effect but no persistent value to read back, so it
// doesn't fit createControl.js's shape (ECS-156 plan §9).
export function createAction({ def, invoke }) {
  return { def, invoke };
}
