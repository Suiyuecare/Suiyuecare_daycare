// Full-embedded fonts must not substitute glyphs absent from pdf-lib's width map.
// fontkit mutates feature objects internally; callers pass a fresh copy per render.
export const TAIPEI_PDF_FONT_FEATURES = Object.freeze({ liga: false, clig: false, calt: false, locl: false, palt: false, kern: false });
