import { createPattern } from "./pattern.js";

// Each bank holds its own independent pattern list (not a shared/global pattern pool) —
// switching banks switches which list of patterns is being edited/played.
export function createBank({ id, name, trackCount = 8, rowCount = 64, patternCount = 1 } = {}) {
  return {
    id,
    name: name ?? `Bank ${id}`,
    patterns: Array.from({ length: patternCount }, (_, i) =>
      createPattern({ trackCount, rowCount, name: `Pattern ${i + 1}` }),
    ),
    activePatternIndex: 0,
  };
}
