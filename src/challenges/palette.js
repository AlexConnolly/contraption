// Shared level colours, so every pack furnishes a course the same way.
export const GREY = 0x6b7480;
export const DARK = 0x474e57;

/**
 * What a tag looks like.
 *
 * A tag is the number the physics carries on a crate and the distance
 * sensor reads back. Nothing made it a colour until now, so a level that
 * wanted a red crate said 0xd6544a and hoped the plate said the same. These
 * are the one place that mapping lives, so a plate and the cargo it wants
 * cannot drift apart.
 */
export const TAG_COLOURS = [
  0x8d96a3, // 0 - no tag, and the colour of a plate that takes anything
  0xd6544a, // 1 red
  0x46c46a, // 2 green
  0x4a86d6, // 3 blue
  0xe0b13c, // 4 yellow
  0xb06bff, // 5 purple
  0x35d0e0, // 6 cyan
  0xe08a3c, // 7 orange
  0xd35ba5, // 8 pink
  0xc8d14a, // 9 lime
];

export function tagColour(tag) {
  return TAG_COLOURS[tag] ?? TAG_COLOURS[0];
}
