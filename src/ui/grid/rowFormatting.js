import { noteNumberToName, toHex } from "../../model/notes.js";
import { getEffectCommand } from "../../model/effects.js";

// Event -> display strings, kept separate from the model so note-number/hex formatting
// decisions never leak into model/ (ECS-156 plan §5/§9).
export function formatCell(event) {
  const effect = getEffectCommand(event.effectCommand);
  return {
    note: noteNumberToName(event.note),
    instrument: toHex(event.instrument, 2),
    velocity: toHex(event.velocity, 2),
    fx: `${effect ? effect.code : "-"}${toHex(event.effectParam, 2)}`,
  };
}
