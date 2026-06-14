// Custom DOM events shared between the Stahl Shrine recipe's independently
// bundled scripts (e.g. stahl-recipe.ts and stahl-butterfly.ts), which don't
// share module state since each is its own esbuild entry point.

// Dispatched on `document` the first time the ASCII slideshow is revealed
// (i.e. the first time any recipe step is clicked).
export const SLIDESHOW_REVEALED_EVENT = "stahl:slideshow-revealed";
