// The small marker beside a parameter's name saying how it is being moved besides its own slider:
// A = cell automation (model/cellAutomation.js), L = one or more LFOs. Purely presentational.
export default function ModBadge({ automated, lfos }) {
  if (!automated && !lfos) return null;
  const title = [automated ? "Automated from cells" : null, lfos ? `${lfos} LFO${lfos > 1 ? "s" : ""}` : null].filter(Boolean).join(" + ");
  return (
    <span className="mod-badge" title={title}>
      {automated ? "A" : ""}
      {lfos ? `${automated ? "+" : ""}L${lfos > 1 ? lfos : ""}` : ""}
    </span>
  );
}
