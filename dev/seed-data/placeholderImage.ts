import sharp from 'sharp'

export const PLACEHOLDER_IMAGE_WIDTH = 800
export const PLACEHOLDER_IMAGE_HEIGHT = 600

/** Escapes the characters that would end or break out of SVG text. */
const escapeXml = (text: string): string =>
  text.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`)

/**
 * Draws the picture of a demo product: its title on a background colour of its own.
 *
 * The demo needs an image per product to look like a shop, and it has to work on a first
 * start without a network connection (an aeroplane, a CI runner, a firewalled machine),
 * so the pictures are drawn here instead of downloaded. The colour follows from the title,
 * which keeps a product's picture the same every time the database is seeded.
 */
export const createPlaceholderImage = async (title: string): Promise<Buffer> => {
  let hash = 0
  for (const character of title) {
    hash = (hash * 31 + character.charCodeAt(0)) % 360
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PLACEHOLDER_IMAGE_WIDTH}" height="${PLACEHOLDER_IMAGE_HEIGHT}">
    <rect width="100%" height="100%" fill="hsl(${hash}, 45%, 62%)"/>
    <text x="50%" y="50%" fill="white" font-family="sans-serif" font-size="44" font-weight="bold"
      text-anchor="middle" dominant-baseline="middle">${escapeXml(title)}</text>
  </svg>`

  return await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer()
}
