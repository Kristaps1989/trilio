// One row of chips that swipes sideways on a phone and wraps from 640 px up
// (results page, owner 1 Nov 2026: the products come first). The right edge
// fades while there is more to swipe; the chips stay real links and buttons.
export const SWIPE_ROW =
  "-my-1 flex gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden " +
  "[mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] " +
  "sm:flex-wrap sm:overflow-visible sm:[mask-image:none]";
