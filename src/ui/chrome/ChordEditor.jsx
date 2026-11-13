import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { getSelectedPattern } from "../../model/query.js";
import { scaleOf, isNoteInScale, isChromatic } from "../../model/scale.js";
import { formatBarBeat } from "../../model/timing.js";
import { noteNumberToName } from "../../model/notes.js";
import { triggerPreview } from "../../audio/preview.js";
import { isFxSend } from "../../model/trackChannel.js";
import {
  CHORD_SPREADS,
  CHORD_TYPES,
  CUSTOM_TYPE,
  DIATONIC_TYPES,
  MAX_CHORD_VOICES,
  chordLabel,
  chordNotes,
  createChord,
  normalizeChord,
  toCustomChord,
  toggleChordTone,
  toneCount,
} from "../../model/chord.js";

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
const KEYS_BELOW = 12;
const KEYS_ABOVE = 36;

// The chord editor, opened from the Note Editor's CHORD button and shown under the grid like the chop editor.
// It edits `event.chord` (model/chord.js) of the cell under the cursor: the cell's NOTE is the chord's root, so
// typing/moving the note moves the whole chord. Type, inversion and spread rebuild the tones; clicking a key of the
// keyboard toggles a tone and turns the chord into a custom one (explicit semitone offsets from the root).
// Renders nothing while closed or while the cursor is not on a cell.
export default function ChordEditor({ store }) {
  const open = useStore(store, events.CHORD_EDITOR_CHANGED, (s) => s.chordEditorOpen);
  const cursor = useStore(store, events.CURSOR_MOVED, (s) => s.cursor);
  // A primitive fingerprint of the cell and what shapes its tones (see NoteEditor's note on in-place mutation).
  useStore(store, events.CELL_CHANGED, (s) => {
    const e = getSelectedPattern(s.song)?.tracks[s.cursor.trackIndex]?.events[s.cursor.rowIndex];
    return e ? `${e.note}|${e.instrument}|${JSON.stringify(e.chord)}` : "";
  });
  useStore(store, events.SCALE_CHANGED, (s) => `${s.song.scale?.root}|${s.song.scale?.scale}`);
  useStore(store, events.INSTRUMENTS_CHANGED, (s) => s.instruments.map((i) => `${i.output?.type}|${i.sampleMode}`).join(";"));
  if (!open) return null;

  const state = store.getState();
  const pattern = getSelectedPattern(state.song);
  const event = pattern?.tracks[cursor.trackIndex]?.events[cursor.rowIndex];
  if (!event) return null;

  const scale = scaleOf(state.song);
  const instrument = event.instrument === null ? state.instruments[state.selectedInstrumentIndex] : state.instruments[event.instrument];
  const channel = state.song.trackChannels[cursor.trackIndex];
  const chop = instrument?.output?.type === "sample" && instrument.sampleMode === "chop";
  const sendTrack = channel ? isFxSend(channel) : false;
  const chord = normalizeChord(event.chord);
  const root = event.note;
  const canChord = root !== null && !chop && !sendTrack;
  const tones = chord && root !== null ? chordNotes(chord, root, scale) : [];
  const synthVoices = instrument?.output?.type === "instrument" ? Math.min(MAX_CHORD_VOICES, tones.length) : 0;

  const setChord = (next) => store.setCell(cursor.trackIndex, cursor.rowIndex, "chord", next);
  const audition = () => {
    const trackChannel = state.song.trackChannels[cursor.trackIndex];
    if (!trackChannel || !chord || root === null) return;
    const slot = event.instrument ?? state.selectedInstrumentIndex;
    triggerPreview({ ...event, instrument: slot }, trackChannel, state.instruments, scale).catch(() => {});
  };

  const first = root === null ? 48 : Math.max(0, root - KEYS_BELOW);
  const keys = [];
  for (let n = first; n <= Math.min(127, first + KEYS_BELOW + KEYS_ABOVE); n++) keys.push(n);

  function pressKey(note) {
    if (!chord || root === null) return;
    const base = chord.type === CUSTOM_TYPE ? chord : toCustomChord(chord, root, scale);
    const next = toggleChordTone(base, note - root);
    if (next !== chord) setChord(next);
  }

  return (
    <div className="chord-editor">
      <div className="chord-editor__bar">
        <span className="chord-editor__title">CHORD · TRK {cursor.trackIndex + 1} · {formatBarBeat(cursor.rowIndex)}</span>
        <span className="chord-editor__readout">{root === null ? "no note" : `root ${noteNumberToName(root)}`}</span>
        {chord && <span className="chord-editor__readout">{chordLabel(chord)}</span>}
        <button type="button" className="fx-panel__target-btn chord-editor__close" onClick={() => store.setChordEditorOpen(false)}>
          CLOSE
        </button>
      </div>

      {!canChord ? (
        <div className="chord-editor__empty">
          {chop ? "A chop slot plays slices, not chords." : sendTrack ? "An FX send track holds no notes." : "Put a note in this cell first: it is the chord's root."}
        </div>
      ) : (
        <>
          <div className="chord-editor__bar">
            <button type="button" className={`fx-panel__target-btn${chord ? " fx-panel__target-btn--active" : ""}`} aria-pressed={Boolean(chord)} onClick={() => setChord(chord ? null : createChord("maj"))}>
              {chord ? "CHORD ON" : "CHORD OFF"}
            </button>
            {chord && (
              <>
                <label className="chord-editor__field">
                  TYPE
                  <select
                    value={chord.type}
                    onChange={(e) => setChord(e.target.value === CUSTOM_TYPE ? toCustomChord(chord, root, scale) : normalizeChord({ ...chord, type: e.target.value, offsets: undefined }))}
                  >
                    <optgroup label="Scale">
                      {DIATONIC_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Chords">
                      {CHORD_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </optgroup>
                    <option value={CUSTOM_TYPE}>Custom</option>
                  </select>
                </label>
                <label className="chord-editor__field">
                  INVERSION
                  <select value={chord.inversion ?? 0} onChange={(e) => setChord(normalizeChord({ ...chord, inversion: Number(e.target.value) }))}>
                    {Array.from({ length: Math.max(1, toneCount(chord)) }, (_, i) => (
                      <option key={i} value={i}>
                        {i === 0 ? "root" : `${i}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="chord-editor__field" title="How the tones are laid out: open lifts the second tone an octave, drop 2 lowers the second from the top, wide lifts every other tone">
                  SPREAD
                  <select value={chord.spread ?? "close"} onChange={(e) => setChord(normalizeChord({ ...chord, spread: e.target.value }))}>
                    {CHORD_SPREADS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="fx-panel__target-btn" onClick={audition} title="Play the chord on this cell's instrument">
                  ▶ PLAY
                </button>
              </>
            )}
          </div>

          {chord && (
            <>
              <div className="chord-editor__keys" role="group" aria-label="Chord tones: click a key to add or remove a tone">
                {keys.map((n) => {
                  const on = tones.includes(n);
                  const cls = ["chord-editor__key", BLACK_KEYS.has(n % 12) ? "chord-editor__key--black" : "", on ? "chord-editor__key--on" : "", n === root ? "chord-editor__key--root" : "", !isChromatic(scale) && isNoteInScale(scale, n) ? "chord-editor__key--scale" : ""].filter(Boolean).join(" ");
                  return (
                    <button type="button" key={n} className={cls} aria-pressed={on} onClick={() => pressKey(n)} title={noteNumberToName(n)}>
                      {n % 12 === 0 || on ? noteNumberToName(n) : ""}
                    </button>
                  );
                })}
              </div>
              <div className="chord-editor__hint">
                {tones.map(noteNumberToName).join(" ")}
                {chord.type !== CUSTOM_TYPE ? " · click a key to edit the tones by hand" : ` · click keys to add or remove tones (1-${MAX_CHORD_VOICES})`}
                {synthVoices > 1 ? ` · ${synthVoices} engine instances` : ""}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
