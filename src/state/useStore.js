import { useSyncExternalStore } from "react";

// Subscribes a React chrome component to one store event and reads a selector over the
// store's state — React 18's built-in hook for exactly this "external store" shape (ECS-156
// plan §4/§9). The only file that imports both React and store.js.
export function useStore(store, eventName, selector) {
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(eventName, onStoreChange),
    () => selector(store.getState()),
  );
}
