/**
 * Regenerate the wallpaper stylesheet from the bundled JPEG. The client module
 * host serves only lib/client.js and its source map, so the image is embedded
 * as a data URI; the package test pins the generated stylesheet against the
 * source image.
 */
import { readFile, writeFile } from 'node:fs/promises'

const image = await readFile(new URL('../src/client/background.jpg', import.meta.url))
const base64 = image.toString('base64')
const css = `/* Wallpaper shell surfaces: the frame and the conversation column paint the same
   bundled image with viewport-fixed attachment, so the two surfaces read as one
   continuous wallpaper. The sidebar and details columns keep their opaque fills,
   which keeps their copy readable over the image. */
:global([data-slot='root'] > div),
:global([data-slot='conversation'] > [data-phase]) {
  background-color: var(--dsw-alias-bg-base);
  background-image: url('data:image/jpeg;base64,${base64}');
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
  background-attachment: fixed;
}
`
await writeFile(new URL('../src/client/background.module.css', import.meta.url), css)
console.log(`wrote ${css.length} bytes to src/client/background.module.css`)
