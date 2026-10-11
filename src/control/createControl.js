// ONE generic factory for a readable/writable/observable control — the single implementation
// every control id in contract.js is built from, replacing webseq's ~30 hand-copied
// listener/cache blocks (ECS-156 plan §9). Shaped to match midi-core's own Control<D>
// (`{ def, getValue, setValue, onChange }`), so a future midi-core adapter could consume this
// registry directly.
export function createControl({ def, read, write, subscribe }) {
  return {
    def,
    getValue: () => read(),
    setValue: write ? (value) => write(value) : () => {},
    onChange: subscribe ?? (() => () => {}),
  };
}
