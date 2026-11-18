// Existing saves identify levels by their one-based position. Append new levels at the end.
export const levels = [
  ["######", "#    #", "# @$.#", "#    #", "######"],
  ["#######", "#  .  #", "#  $  #", "# @$ .#", "#     #", "#######"],
  ["########", "# .  . #", "# $  $ #", "#   @  #", "#      #", "########"],
];

export const gomoku = { boardSize: 9, winningStones: 5, winScore: 100000, lineWeight: 6, attackWeight: 1.1, centerWeight: 0.01 };
