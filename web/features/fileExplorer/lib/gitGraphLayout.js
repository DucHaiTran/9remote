// Lane layout for a commit graph. Commits arrive newest first (git --date-order); each row
// gets the lane of its node plus the segments to draw in its top and bottom halves.
// A lane carries the hash it is waiting for and a color that follows the branch line.

export const UNCOMMITTED_HASH = "*";

function freeSlot(lanes) {
  const i = lanes.indexOf(null);
  return i === -1 ? lanes.length : i;
}

function trim(lanes) {
  while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
}

/**
 * @param commits [{ hash, parents }]
 * @param colorCount palette size
 * @returns { rows: [{ col, color, top: [[x0,x1,color]], bottom: [[x0,x1,color]] }], width }
 */
export function layoutGraph(commits, colorCount) {
  const lanes = []; // { hash, color } | null
  let nextColor = 0;
  let width = 1;
  const rows = [];

  for (const commit of commits) {
    const top = [];
    let col = lanes.findIndex((l) => l && l.hash === commit.hash);
    let color;
    if (col === -1) {
      col = freeSlot(lanes);
      color = nextColor++ % colorCount;
    } else {
      color = lanes[col].color;
    }

    // Top half: every lane waiting for this commit bends into the node; the rest run straight.
    lanes.forEach((l, i) => {
      if (!l) return;
      if (l.hash === commit.hash) {
        top.push([i, col, l.color]);
        lanes[i] = null;
      } else {
        top.push([i, i, l.color]);
      }
    });

    // First parent keeps the node's lane and color; further parents join or open lanes.
    const bottom = [];
    const [first, ...rest] = commit.parents;
    lanes[col] = first ? { hash: first, color } : null;
    if (first) bottom.push([col, col, color]);
    const opened = new Set();
    for (const parent of rest) {
      let j = lanes.findIndex((l) => l && l.hash === parent);
      if (j === -1) {
        j = freeSlot(lanes);
        lanes[j] = { hash: parent, color: nextColor++ % colorCount };
        opened.add(j);
      }
      bottom.push([col, j, lanes[j].color]);
    }
    // Lanes that were already running pass straight through, including one a merge just joined.
    lanes.forEach((l, i) => {
      if (l && i !== col && !opened.has(i)) bottom.push([i, i, l.color]);
    });

    width = Math.max(width, lanes.length, col + 1);
    rows.push({ col, color, top, bottom });
    trim(lanes);
  }
  return { rows, width };
}
