/**
 * Sora 700, for the generated icons.
 *
 * ImageResponse's built-in font has no bold face, so `fontWeight: 700` is
 * accepted and ignored: the mark rendered at regular weight and looked thin
 * beside the wordmark it is cropped from, which at 16 pixels is the difference
 * between a recognisable icon and a smudge.
 *
 * Fetching at build time adds no new failure surface — `next/font/google`
 * already downloads Sora during the same build, so the network dependency
 * exists either way. It is still wrapped: a favicon is not worth failing a
 * deploy over, so a fetch that fails returns null and the icon falls back to
 * the default face rather than throwing.
 */
let cached: ArrayBuffer | null | undefined;

export async function soraBold(): Promise<ArrayBuffer | null> {
  if (cached !== undefined) return cached;

  try {
    // Ask as an old browser: Google serves TTF rather than WOFF2 to a UA it
    // does not recognise, and satori cannot read WOFF2.
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Sora:wght@700",
      { headers: { "User-Agent": "Mozilla/5.0" } },
    ).then((r) => r.text());

    const url = css.match(/src: url\((https:\/\/[^)]+)\)/)?.[1];
    if (!url) throw new Error("no font URL in the Google Fonts stylesheet");

    const data = await fetch(url).then((r) => r.arrayBuffer());
    cached = data;
    return data;
  } catch (err) {
    console.warn(
      "[icon] could not fetch Sora, falling back to the default face:",
      err instanceof Error ? err.message : err,
    );
    cached = null;
    return null;
  }
}
