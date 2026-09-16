// hls.js ships no declaration for its "light" build (no subtitles, alternate
// audio or DRM — none of which we use). Its API is a subset of the full build,
// so the full build's types describe it.
declare module "hls.js/light" {
  export * from "hls.js";
  export { default } from "hls.js";
}
