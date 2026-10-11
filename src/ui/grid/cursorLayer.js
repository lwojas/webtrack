// The edit-cursor overlay — same "one dedicated layer, moved via transform" mechanism as
// playheadLayer.js, but updated on navigation events instead of every frame (ECS-156 plan
// §4). Position is measured from the real target cell element rather than a duplicated
// column-width constant, so CSS stays the single source of truth for grid geometry.
export function createCursorLayer() {
  let el = null;

  function mount(containerEl) {
    el = document.createElement("div");
    el.className = "tracker-cursor";
    el.style.position = "absolute";
    el.style.top = "0";
    el.style.left = "0";
    el.style.visibility = "hidden";
    el.style.pointerEvents = "none";
    containerEl.appendChild(el);
  }

  function setPosition(cellEl) {
    if (!el) return;
    if (!cellEl) {
      el.style.visibility = "hidden";
      return;
    }
    el.style.visibility = "visible";
    el.style.width = `${cellEl.offsetWidth}px`;
    el.style.height = `${cellEl.offsetHeight}px`;
    el.style.transform = `translate(${cellEl.offsetLeft}px, ${cellEl.offsetTop}px)`;
  }

  function unmount() {
    el?.remove();
    el = null;
  }

  return { mount, unmount, setPosition };
}
