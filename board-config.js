// board-config.js — SanaTaisto board layout & tile distribution

export const BOARD_SIZE = 15;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 40;
export const FINNISH_BONUS = 10; // per word longer than 6 letters

// Board layout (0-indexed row, col):
//    A B C D E F G H I J K L M N O
//  1 DL. TW. . DL. DL. DL. . TW. DL
//  2 . DL DL. DW. DL DL DL. DW. DL DL.
//  3 TW. DL DL. TL. . . TL. . . . TW
//  4 . . . TL. . . . . . . TL. . .
//  5 . DW. . . . TL. TL. . . . DW.
//  6 . . . . TL. . . . . TL. . . .
//  7 . . . . . . . DW. . . . . . .
//  8 . . . . . . . ★ . . . . . . .
//  9 . . . . . . . . . . . . . . .
// 10 . . . . TL. . . . . TL. . . .
// 11 . DW. . . . TL. TL. . . . DW.
// 12 . . . TL. . . . . . . TL. . .
// 13 TW. . . . TL. . . TL. DL DL. TW
// 14 . DL DL. DW. DL DL DL. DW. DL DL.
// 15 DL. TW. . DL. DL. DL. . TW. DL
export const PREMIUMS = {
  TW: [  // 8 — corners of inner quadrant
    [0, 2],  [0, 12],
    [2, 0],  [2, 14],
    [12, 0], [12, 14],
    [14, 2], [14, 12],
  ],
  DW: [  // 8 — symmetric pairs
    [1, 4],  [1, 10],
    [4, 1],  [4, 13],
    [10, 1], [10, 13],
    [13, 4], [13, 10],
  ],
  TL: [  // 16
    [2, 5],  [2, 9],
    [3, 3],  [3, 11],
    [4, 6],  [4, 8],
    [5, 4],  [5, 10],
    [9, 4],  [9, 10],
    [10, 6], [10, 8],
    [11, 3], [11, 11],
    [12, 5], [12, 9],
  ],
  DL: [  // 28
    // row 0
    [0, 0],  [0, 5],  [0, 7],  [0, 9],  [0, 14],
    // row 1
    [1, 1],  [1, 2],  [1, 6],  [1, 7],  [1, 8],  [1, 12], [1, 13],
    // row 2
    [2, 2],  [2, 3],
    // row 12
    [12, 11], [12, 12],
    // row 13
    [13, 1],  [13, 2],  [13, 6],  [13, 7],  [13, 8],  [13, 12], [13, 13],
    // row 14
    [14, 0],  [14, 5],  [14, 7],  [14, 9],  [14, 14],
  ],
};

// Finnish tile distribution (102 tiles)
export const TILE_BAG_DEFINITION = {
  ' ': { count: 2,  points: 0  },
  'A': { count: 7,  points: 1  },
  'E': { count: 9,  points: 1  },
  'I': { count: 10, points: 1  },
  'N': { count: 9,  points: 1  },
  'S': { count: 7,  points: 1  },
  'T': { count: 9,  points: 1  },
  'K': { count: 6,  points: 3  },
  'L': { count: 6,  points: 2  },
  'O': { count: 5,  points: 2  },
  'Ä': { count: 5,  points: 2  },
  'M': { count: 3,  points: 3  },
  'U': { count: 4,  points: 3  },
  'H': { count: 2,  points: 4  },
  'J': { count: 2,  points: 4  },
  'P': { count: 2,  points: 4  },
  'R': { count: 2,  points: 4  },
  'V': { count: 2,  points: 4  },
  'Y': { count: 2,  points: 4  },
  'D': { count: 1,  points: 7  },
  'Ö': { count: 2,  points: 7  },
  'B': { count: 1,  points: 8  },
  'F': { count: 1,  points: 8  },
  'G': { count: 1,  points: 8  },
  'W': { count: 1,  points: 8  },
  'C': { count: 1,  points: 10 },
};

// Elo constants
export const INITIAL_RATING = 1200;
export const K_FACTOR      = 32;
export const RATING_SCALE  = 400;
