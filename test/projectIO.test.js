import { File as NodeFile } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";
import { downloadProjectFile, pickProjectFileFromHost } from "../src/persistence/projectIO.js";

// The browser paths (download link, file input) need a DOM; what is testable is the host's file dialogs, which a plugin
// uses instead (its WebView has no file input and ignores downloads).
const installHost = (files) => {
  globalThis.__webdspHost = { kind: "native", files };
};
afterEach(() => {
  delete globalThis.__webdspHost;
  delete globalThis.File;
});

describe("project files through the host's dialogs", () => {
  it("saves the project JSON through the host's save dialog and reports whether it was saved", async () => {
    const saved = [];
    installHost({ saveFile: async (o) => (saved.push(o), { name: o.suggestedName }), openFile: async () => null });
    expect(await downloadProjectFile({ formatVersion: 2, song: { name: "x" } }, "song.json")).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0].suggestedName).toBe("song.json");
    expect(JSON.parse(saved[0].data)).toEqual({ formatVersion: 2, song: { name: "x" } });

    installHost({ saveFile: async () => null, openFile: async () => null }); // the user cancelled
    expect(await downloadProjectFile({}, "song.json")).toBe(false);
  });

  it("opens through the host's dialog as a File the existing loader can read, or null on cancel / no host", async () => {
    globalThis.File = NodeFile;
    expect(await pickProjectFileFromHost()).toBeNull(); // a browser: no host dialog

    const json = JSON.stringify({ formatVersion: 2 });
    let asked;
    installHost({
      saveFile: async () => null,
      openFile: async (o) => ((asked = o), { name: "song.json", data: new TextEncoder().encode(json).buffer }),
    });
    const file = await pickProjectFileFromHost();
    expect(asked).toEqual({ extensions: ["json"] });
    expect(file.name).toBe("song.json");
    expect(await file.text()).toBe(json);

    installHost({ saveFile: async () => null, openFile: async () => null });
    expect(await pickProjectFileFromHost()).toBeNull();
  });
});
