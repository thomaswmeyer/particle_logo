/**
 * @typedef {object} OverlayOptions
 * @property {string} [href]     where the mark links (default https://tom.to/)
 * @property {string} [label]    accessible name of the link
 * @property {string} [text]     plain-text fallback shown without WebGL2 (default the first word)
 * @property {string[]} [words]  the words cycled through
 * @property {string} [font]     CSS font-family for the text (default FONT_FAMILY)
 * @property {number} [bottom]   px from the bottom edge, or the safe-area inset if larger (default 16)
 * @property {number} [right]    px from the right edge, or the safe-area inset if larger (default 16)
 * @property {number} [zIndex]   (default 9)
 * @property {string} [size]     CSS length for the font size (default clamp(28px, 6.5vmin, 48px))
 * @property {string | Element | null} [until]
 *   an element (or selector) the mark lives with: when it is hidden
 *   (display none or the hidden attribute) or removed, the mark fades out and
 *   releases its GL context, the way a start screen's signature goes when Play
 *   is pressed. If it is already gone when the overlay mounts, the mark never appears.
 */
/**
 * @param {OverlayOptions} [opts]
 * @returns {{ leave(): void, destroy(): void }} handle: `leave` fades the mark out and destroys it, `destroy` is immediate
 */
export function overlayInkMark(opts?: OverlayOptions): {
    leave(): void;
    destroy(): void;
};
export type OverlayOptions = {
    /**
     * where the mark links (default https://tom.to/)
     */
    href?: string | undefined;
    /**
     * accessible name of the link
     */
    label?: string | undefined;
    /**
     * plain-text fallback shown without WebGL2 (default the first word)
     */
    text?: string | undefined;
    /**
     * the words cycled through
     */
    words?: string[] | undefined;
    /**
     * CSS font-family for the text (default FONT_FAMILY)
     */
    font?: string | undefined;
    /**
     * px from the bottom edge, or the safe-area inset if larger (default 16)
     */
    bottom?: number | undefined;
    /**
     * px from the right edge, or the safe-area inset if larger (default 16)
     */
    right?: number | undefined;
    /**
     * (default 9)
     */
    zIndex?: number | undefined;
    /**
     * CSS length for the font size (default clamp(28px, 6.5vmin, 48px))
     */
    size?: string | undefined;
    /**
     * an element (or selector) the mark lives with: when it is hidden
     * (display none or the hidden attribute) or removed, the mark fades out and
     * releases its GL context, the way a start screen's signature goes when Play
     * is pressed. If it is already gone when the overlay mounts, the mark never appears.
     */
    until?: string | Element | null | undefined;
};
