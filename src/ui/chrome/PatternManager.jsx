import { useEffect, useState } from "react";
import { useStore } from "../../state/useStore.js";
import * as events from "../../state/events.js";
import { getPatternQueueEntries } from "../../model/query.js";

// The Pattern Manager, kept deliberately simple: it establishes the pattern pool/queue
// contract (see model/song.js's doc comment), not an arrangement/timeline editor. Two
// columns: the pool of every pattern that exists (identity-level actions — rename, duplicate,
// delete, select for editing), and the ordered queue of references into that pool (playback
// order — queue again, remove a slot, see what's currently sounding). The same pattern can
// occupy more than one queue slot (model/mutations.js's appendPatternToQueue), so the two
// lists are deliberately not the same shape.

const QUEUE_HIGHLIGHT_POLL_MS = 120;

function PoolPatternRow({ store, pattern, selected, deleteDisabled }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(pattern.name);

  function startEditing() {
    setDraftName(pattern.name);
    setEditing(true);
  }

  function commitRename() {
    store.renamePattern(pattern.id, draftName);
    setEditing(false);
  }

  function cancelRename() {
    setDraftName(pattern.name);
    setEditing(false);
  }

  return (
    <div className={`pattern-manager__pool-row${selected ? " pattern-manager__pool-row--selected" : ""}`}>
      {editing ? (
        <input
          className="pattern-manager__name-input"
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            else if (e.key === "Escape") cancelRename();
          }}
        />
      ) : (
        <button
          className="pattern-manager__pool-name"
          onClick={() => store.selectPattern(pattern.id)}
          onDoubleClick={startEditing}
          title="Select for editing in the Tracker — double-click to rename"
        >
          {pattern.name}
        </button>
      )}
      <button
        className="pattern-manager__chip pattern-manager__chip--icon"
        onClick={() => store.appendPatternToQueue(pattern.id)}
        title="Add this pattern to the end of the queue again"
      >
        ▶
      </button>
      <button
        className="pattern-manager__chip pattern-manager__chip--icon"
        onClick={() => store.duplicatePattern(pattern.id)}
        title="Duplicate this pattern"
      >
        ⧉
      </button>
      <button
        className="pattern-manager__chip pattern-manager__chip--icon pattern-manager__chip--danger"
        onClick={() => store.deletePattern(pattern.id)}
        disabled={deleteDisabled}
        title={deleteDisabled ? "The last pattern can't be deleted" : "Delete this pattern"}
      >
        ✕
      </button>
    </div>
  );
}

function QueueEntryRow({ store, queueIndex, pattern, selected, playing, removeDisabled }) {
  return (
    <div
      className={`pattern-manager__queue-row${selected ? " pattern-manager__queue-row--selected" : ""}${
        playing ? " pattern-manager__queue-row--playing" : ""
      }`}
    >
      <span className={`pattern-manager__queue-index${playing ? " pattern-manager__queue-index--playing" : ""}`}>
        {playing ? "▶" : queueIndex + 1}
      </span>
      <button
        className="pattern-manager__queue-name"
        onClick={() => store.selectPattern(pattern.id)}
        title="Select for editing in the Tracker"
      >
        {pattern.name}
      </button>
      <button
        className="pattern-manager__chip pattern-manager__chip--icon pattern-manager__chip--danger"
        onClick={() => store.removeFromPatternQueue(queueIndex)}
        disabled={removeDisabled}
        title={removeDisabled ? "The queue can never be empty" : "Remove this slot from the queue"}
      >
        ✕
      </button>
    </div>
  );
}

export default function PatternManager({ store, playbackController }) {
  const [newPatternName, setNewPatternName] = useState("");
  const [playingQueueIndex, setPlayingQueueIndex] = useState(-1);

  const selectedPatternId = useStore(store, events.PATTERN_SELECTED, (s) => s.song.selectedPatternId);
  // Forces a re-render when the pool or queue changes shape; the JSX below re-reads the live
  // state straight off store.getState() rather than this fingerprint (see ui/chrome/
  // NoteEditor.jsx's CELL_CHANGED selector for the same pattern).
  useStore(store, events.PATTERN_QUEUE_CHANGED, (s) => `${s.song.patterns.length}:${s.song.patternQueue.join(",")}`);
  const playing = useStore(store, events.TRANSPORT_CHANGED, (s) => s.playing);

  // The currently playing queue entry has no store mutation/event of its own — playback
  // advances it on its own clock (audio/lookaheadPlayer.js), the same reason the grid's
  // playhead (ui/grid/playheadLayer.js) is a poll rather than a subscription. A plain React
  // interval is "inexpensive enough" here: this list is a handful of rows, not the grid's
  // thousands of cells, and setState only actually re-renders when the index changes. Clears
  // to -1 (nothing highlighted) as soon as playback stops.
  useEffect(() => {
    if (!playing) {
      setPlayingQueueIndex(-1);
      return undefined;
    }
    function refresh() {
      setPlayingQueueIndex(playbackController.getPlayingQueueIndex());
    }
    refresh();
    const intervalId = setInterval(refresh, QUEUE_HIGHLIGHT_POLL_MS);
    return () => clearInterval(intervalId);
  }, [playing, playbackController]);

  const { song } = store.getState();
  const queueEntries = getPatternQueueEntries(song);
  const canRemove = song.patternQueue.length > 1;
  const canDelete = song.patterns.length > 1;

  function handleAddPattern(e) {
    e.preventDefault();
    store.addPattern(newPatternName.trim() || undefined);
    setNewPatternName("");
  }

  return (
    <div className="pattern-manager">
      <div className="pattern-manager__panel">
        <div className="pattern-manager__header">PATTERNS</div>
        <div className="pattern-manager__pool">
          {song.patterns.map((pattern) => (
            <PoolPatternRow
              key={pattern.id}
              store={store}
              pattern={pattern}
              selected={pattern.id === selectedPatternId}
              deleteDisabled={!canDelete}
            />
          ))}
        </div>
        <form className="pattern-manager__add" onSubmit={handleAddPattern}>
          <input
            type="text"
            placeholder="New pattern name"
            value={newPatternName}
            onChange={(e) => setNewPatternName(e.target.value)}
          />
          <button type="submit">+ NEW PATTERN</button>
        </form>
      </div>

      <div className="pattern-manager__panel">
        <div className="pattern-manager__header">QUEUE</div>
        <div className="pattern-manager__queue">
          {queueEntries.map(({ queueIndex, patternId, pattern }) => (
            <QueueEntryRow
              key={queueIndex}
              store={store}
              queueIndex={queueIndex}
              pattern={pattern}
              selected={patternId === selectedPatternId}
              playing={playing && queueIndex === playingQueueIndex}
              removeDisabled={!canRemove}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
