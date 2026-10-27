declare module 'omggif' {
  interface GifWriterOptions {
    palette?: number[];
    loop?: number;
    background?: number;
  }

  interface GifFrameOptions {
    palette?: number[];
    delay?: number;
    disposal?: number;
    transparent?: number;
  }

  interface GifFrameInfo {
    x: number;
    y: number;
    width: number;
    height: number;
    delay: number;
    disposal: number;
    transparent_index: number | null;
    interlaced: boolean;
    has_local_palette: boolean;
  }

  export class GifWriter {
    constructor(buf: Uint8Array, width: number, height: number, options?: GifWriterOptions);
    addFrame(
      x: number,
      y: number,
      width: number,
      height: number,
      pixels: Uint8Array | number[],
      options?: GifFrameOptions,
    ): number;
    end(): number;
  }

  export class GifReader {
    constructor(buf: Uint8Array);
    width: number;
    height: number;
    numFrames(): number;
    loopCount(): number | null;
    frameInfo(index: number): GifFrameInfo;
  }
}
