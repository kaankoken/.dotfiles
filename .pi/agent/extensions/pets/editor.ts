import type { EditorComponent, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { allocateImageId, getCapabilities, getCellDimensions, renderImage, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { PET_COLUMNS, PET_ROWS, type LoadedPet } from "./core.ts";

export type PetView = {
  pet?: LoadedPet;
  visible: boolean;
  renderer: "auto" | "ansi";
  index: number;
  onLook: (degrees: number | undefined) => void;
  onClick: () => void;
};

export function decorateEditor(editor: EditorComponent, view: () => PetView): EditorComponent {
  const originalRender = editor.render.bind(editor);
  const originalMouse = editor.handleMouse?.bind(editor);
  const imageIds = new WeakMap<LoadedPet, Map<number, number>>();
  let rail: { leftWidth: number; height: number; centerX: number; centerY: number } | undefined;

  editor.render = (width: number) => {
    const state = view();
    if (!state.pet || !state.visible || width < 52) {
      rail = undefined;
      return originalRender(width);
    }
    const frame = state.pet.frames.get(state.index);
    if (!frame) return originalRender(width);
    const leftWidth = width - PET_COLUMNS - 2;
    const left = originalRender(leftWidth);
    let right = frame.ansi;
    const caps = getCapabilities();
    if (state.renderer === "auto" && caps.images === "kitty" && !process.env.TMUX) {
      let ids = imageIds.get(state.pet);
      if (!ids) { ids = new Map(); imageIds.set(state.pet, ids); }
      let imageId = ids.get(state.index);
      if (imageId === undefined) { imageId = allocateImageId(); ids.set(state.index, imageId); }
      const native = renderImage(frame.png, { widthPx: 192, heightPx: 208 }, {
        maxWidthCells: PET_COLUMNS, maxHeightCells: PET_ROWS, imageId, moveCursor: false,
      });
      if (native) {
        const padding = " ".repeat(Math.floor((PET_COLUMNS - native.columns) / 2));
        right = [padding + native.sequence + " ".repeat(native.columns)];
        for (let row = 1; row < native.rows; row++) right.push("");
      }
    }
    const top = 1;
    rail = { leftWidth, height: left.length, centerX: leftWidth + 2 + PET_COLUMNS / 2, centerY: top + PET_ROWS / 2 };
    return Array.from({ length: Math.max(left.length, top + PET_ROWS) }, (_, row) => {
      const line = truncateToWidth(left[row] ?? "", leftWidth, "");
      const petLine = row >= top ? right[row - top] ?? "" : "";
      return line + "\x1b[0m" + " ".repeat(leftWidth - visibleWidth(line) + 2) + petLine +
        " ".repeat(Math.max(0, PET_COLUMNS - visibleWidth(petLine)));
    });
  };

  editor.handleMouse = (event: TuiMouseEvent): TuiMouseEventResult | undefined => {
    if (!rail) return originalMouse?.(event);
    const state = view();
    if (event.type === "move" && state.pet?.manifest.spriteVersionNumber === 2) {
      const cell = getCellDimensions();
      const dx = (event.x - rail.centerX) * cell.widthPx;
      const dy = (event.y - rail.centerY) * cell.heightPx;
      state.onLook(Math.hypot(dx, dy) < cell.widthPx ? undefined : Math.atan2(dx, -dy) * 180 / Math.PI);
    }
    if (event.x >= rail.leftWidth) {
      if (event.type === "click" && event.button === "left") state.onClick();
      return { handled: true, render: event.type === "click" };
    }
    return originalMouse?.({ ...event, width: rail.leftWidth, height: rail.height });
  };
  return editor;
}
