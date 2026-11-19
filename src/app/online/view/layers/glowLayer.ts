/**
 * The light of a lit scene (`PlayerScene.glow`): the GM's small picture of it stretched over the map, smoothed as the
 * canvas stretches it, over the map and under the grid and the tokens. Black where players' tokens see nothing, dimmed
 * where only their memory shows, and tinted by the lights' colours; the darkness fog still covers what they do not see.
 */
import { intersects } from '../camera';
import type { PlayerLayer } from './layerTypes';

/** Decodes a data URL to an image; tests pass their own. */
export type GlowDecoder = (url: string) => Promise<HTMLImageElement | ImageBitmap>;

export const decodeImage: GlowDecoder = async (url) => {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
};

export function createGlowLayer(decode: GlowDecoder = decodeImage): PlayerLayer {
  /** The picture being shown and the one being decoded: the old one stays up until the new one is ready. */
  let shown: { url: string; image: HTMLImageElement | ImageBitmap } | null = null;
  let loading: string | null = null;
  const load = (url: string): void => {
    loading = url;
    decode(url).then((image) => {
      if (loading !== url) return;
      shown = { url, image };
      loading = null;
    }, (error: unknown) => {
      if (loading !== url) return;
      loading = null;
      console.warn('[Atlas VTT Connect] Could not show the scene\'s light:', error);
    });
  };
  return {
    // While a picture is decoding the view keeps drawing, so it shows as soon as it is ready.
    animating: () => loading !== null,
    draw(surface, frame): void {
      const { map, glow } = frame.scene;
      if (!glow) {
        shown = null;
        loading = null;
        return;
      }
      if (shown?.url !== glow.image && loading !== glow.image) load(glow.image);
      if (!shown || !(map.width > 0) || !(map.height > 0)) return;
      if (!intersects({ x: 0, y: 0, width: map.width, height: map.height }, frame.visible)) return;
      surface.image(shown.image, 0, 0, map.width, map.height, null);
    },
    dispose(): void {
      shown = null;
      loading = null;
    },
  };
}
