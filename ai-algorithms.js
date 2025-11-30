/*
 * AI Algorithms for Pac-Man
 * Implementations: Classic 1980s, Random, Greedy, A*, Minimax, Adaptive Expectimax
 */

var PacmanAI = (function() {
    
    // Stats tracking
    var stats = {
        decisionsPerSecond: 0,
        nodesEvaluated: 0,
        avgDecisionTime: 0,
        decisionCount: 0,
        totalTime: 0,
        ghostModelConfidence: 0
    };
    
    // Move history for anti-oscillation (tracks last N positions)
    var moveHistory = [];
    var HISTORY_LENGTH = 16;
    var positionVisitCount = {};  // Track how many times each position visited
    
    // Direction opposites for detecting reversals
    var opposites = {};
    opposites[UP] = DOWN;
    opposites[DOWN] = UP;
    opposites[LEFT] = RIGHT;
    opposites[RIGHT] = LEFT;
    
    // ===================
    // GHOST MODEL (Bayesian Learning)
    // ===================
    
    // Stores observed ghost moves: ghostObservations[ghostIdx][situation][move] = count
    var ghostObservations = {};
    var totalObservations = 0;
    var SMOOTHING = 1; // Laplace smoothing - prevents 0 probabilities
    
    function resetGhostModel() {
        ghostObservations = {};
        totalObservations = 0;
        for (var i = 0; i < 4; i++) {
            ghostObservations[i] = {};
        }
        saveGhostModel(); // Clear saved model too
    }
    
    function saveGhostModel() {
        try {
            var data = {
                observations: ghostObservations,
                total: totalObservations
            };
            localStorage.setItem('pacman-ghost-model', JSON.stringify(data));
        } catch (e) {
            // localStorage not available or full
        }
    }
    
    function loadGhostModel() {
        try {
            var saved = localStorage.getItem('pacman-ghost-model');
            if (saved) {
                var data = JSON.parse(saved);
                ghostObservations = data.observations || {};
                totalObservations = data.total || 0;
                
                // Ensure all ghost indices exist
                for (var i = 0; i < 4; i++) {
                    if (!ghostObservations[i]) {
                        ghostObservations[i] = {};
                    }
                }
                
                stats.ghostModelConfidence = Math.min(100, Math.round(totalObservations / 2));
                return true;
            }
        } catch (e) {
            // localStorage not available or corrupted
        }
        return false;
    }
    
    // Initialize on load - try to restore saved model
    if (!loadGhostModel()) {
        // No saved model, start fresh
        for (var i = 0; i < 4; i++) {
            ghostObservations[i] = {};
        }
    }
    
    // Get a simplified situation key based on relative positions
    function getSituation(ghostPos, pacmanPos) {
        var gx = Math.round(ghostPos.x / 10);
        var gy = Math.round(ghostPos.y / 10);
        var px = Math.round(pacmanPos.x / 10);
        var py = Math.round(pacmanPos.y / 10);
        
        // Relative direction: where is PacMan relative to ghost?
        var dx = px - gx;
        var dy = py - gy;
        
        var horizontal = dx > 2 ? 'R' : (dx < -2 ? 'L' : 'H'); // Right, Left, or Horizontal-close
        var vertical = dy > 2 ? 'D' : (dy < -2 ? 'U' : 'V');   // Down, Up, or Vertical-close
        
        // Distance category
        var dist = Math.abs(dx) + Math.abs(dy);
        var distCat = dist < 5 ? 'near' : (dist < 10 ? 'mid' : 'far');
        
        return horizontal + vertical + '_' + distCat;
    }
    
    // Record an observed ghost move
    function recordGhostMove(ghostIdx, ghostPos, pacmanPos, move) {
        if (move === NONE) return;
        
        var situation = getSituation(ghostPos, pacmanPos);
        
        if (!ghostObservations[ghostIdx][situation]) {
            ghostObservations[ghostIdx][situation] = {};
            ghostObservations[ghostIdx][situation][UP] = 0;
            ghostObservations[ghostIdx][situation][DOWN] = 0;
            ghostObservations[ghostIdx][situation][LEFT] = 0;
            ghostObservations[ghostIdx][situation][RIGHT] = 0;
        }
        
        ghostObservations[ghostIdx][situation][move]++;
        totalObservations++;
        
        // Update confidence stat
        stats.ghostModelConfidence = Math.min(100, Math.round(totalObservations / 2));
        
        // Persist to localStorage periodically (every 10 observations to avoid excessive writes)
        if (totalObservations % 10 === 0) {
            saveGhostModel();
        }
    }
    
    // Get learned move probabilities for a ghost in a situation
    function getGhostMoveProbabilities(ghostIdx, ghostPos, pacmanPos) {
        var situation = getSituation(ghostPos, pacmanPos);
        var obs = ghostObservations[ghostIdx][situation];
        
        var probs = {};
        var directions = [UP, DOWN, LEFT, RIGHT];
        
        if (!obs) {
            // No observations - return uniform distribution
            for (var i = 0; i < directions.length; i++) {
                probs[directions[i]] = 0.25;
            }
            return probs;
        }
        
        // Calculate probabilities with Laplace smoothing
        var total = SMOOTHING * 4; // Start with smoothing counts
        for (var i = 0; i < directions.length; i++) {
            total += obs[directions[i]] || 0;
        }
        
        for (var i = 0; i < directions.length; i++) {
            var count = (obs[directions[i]] || 0) + SMOOTHING;
            probs[directions[i]] = count / total;
        }
        
        return probs;
    }
    
    // ===================
    // EXPECTIMAX ALGORITHM
    // ===================
    
    function expectimax(map, pacmanPos, ghostPositions, ghostStates, depth, isMaximizing, nodesRef) {
        nodesRef.count++;
        
        if (depth === 0) {
            return evaluateState(map, pacmanPos, ghostPositions, ghostStates);
        }
        
        var pacmanGrid = toGrid(pacmanPos);
        var validMoves = getValidMoves(map, pacmanPos);
        
        if (validMoves.length === 0) {
            return evaluateState(map, pacmanPos, ghostPositions, ghostStates);
        }
        
        var deltas = {
            [UP]: {x: 0, y: -10},
            [DOWN]: {x: 0, y: 10},
            [LEFT]: {x: -10, y: 0},
            [RIGHT]: {x: 10, y: 0}
        };
        
        if (isMaximizing) {
            // Pac-Man's turn (maximize)
            var maxEval = -Infinity;
            
            for (var i = 0; i < validMoves.length; i++) {
                var move = validMoves[i];
                var newPos = {
                    x: pacmanPos.x + deltas[move].x,
                    y: pacmanPos.y + deltas[move].y
                };
                
                var evalScore = expectimax(map, newPos, ghostPositions, ghostStates, depth - 1, false, nodesRef);
                maxEval = Math.max(maxEval, evalScore);
            }
            return maxEval;
        } else {
            // Ghosts' turn (expected value based on learned probabilities)
            var expectedValue = 0;
            var directions = [UP, DOWN, LEFT, RIGHT];
            
            // For simplicity, we compute expected value over first ghost's moves
            // (Full version would enumerate all ghost combinations, but that's expensive)
            var ghostIdx = 0; // Focus on Blinky for probability, move all ghosts
            var probs = getGhostMoveProbabilities(ghostIdx, ghostPositions[0], pacmanPos);
            
            for (var d = 0; d < directions.length; d++) {
                var dir = directions[d];
                var prob = probs[dir];
                
                if (prob < 0.01) continue; // Skip very unlikely moves
                
                // Simulate all ghosts moving (others use simple chase toward their predicted positions)
                var newGhostPositions = ghostPositions.map(function(gPos, idx) {
                    var gGrid = toGrid(gPos);
                    var pGrid = toGrid(pacmanPos);
                    
                    var gDelta = deltas[dir]; // Use sampled direction for ghost 0
                    if (idx > 0) {
                        // Other ghosts: use their own learned probabilities to pick most likely move
                        var otherProbs = getGhostMoveProbabilities(idx, gPos, pacmanPos);
                        var bestProb = 0;
                        var bestDir = UP;
                        for (var dd = 0; dd < directions.length; dd++) {
                            if (otherProbs[directions[dd]] > bestProb) {
                                bestProb = otherProbs[directions[dd]];
                                bestDir = directions[dd];
                            }
                        }
                        gDelta = deltas[bestDir];
                    }
                    
                    // Check if move is valid
                    var testPos = {x: gPos.x + gDelta.x, y: gPos.y + gDelta.y};
                    if (map.isFloorSpace(toGrid(testPos))) {
                        return testPos;
                    }
                    return gPos; // Stay in place if invalid
                });
                
                var evalScore = expectimax(map, pacmanPos, newGhostPositions, ghostStates, depth - 1, true, nodesRef);
                expectedValue += prob * evalScore;
            }
            
            return expectedValue;
        }
    }
    
    function resetStats() {
        stats.decisionsPerSecond = 0;
        stats.nodesEvaluated = 0;
        stats.avgDecisionTime = 0;
        stats.decisionCount = 0;
        stats.totalTime = 0;
        stats.ghostModelConfidence = Math.min(100, Math.round(totalObservations / 2));
        moveHistory = [];
        positionVisitCount = {};  // Reset visit counts each game
        // Note: We don't reset ghostObservations here - learning persists across games!
    }
    
    function fullReset() {
        resetStats();
        resetGhostModel();
    }
    
    // Check if a move would cause oscillation (revisiting recent positions)
    function getOscillationPenalty(pos, move, lastMove) {
        var penalty = 0;
        
        // Penalize reversing direction (stronger penalty)
        if (lastMove !== undefined && lastMove !== NONE && move === opposites[lastMove]) {
            penalty += 50;
        }
        
        // Penalize revisiting recent positions
        var deltas = {
            [UP]: {x: 0, y: -1},
            [DOWN]: {x: 0, y: 1},
            [LEFT]: {x: -1, y: 0},
            [RIGHT]: {x: 1, y: 0}
        };
        var newPos = {
            x: Math.round(pos.x / 10) + deltas[move].x,
            y: Math.round(pos.y / 10) + deltas[move].y
        };
        var posKey = newPos.x + ',' + newPos.y;
        
        // Check recent history - heavy penalty for recent revisits
        for (var i = 0; i < moveHistory.length; i++) {
            if (moveHistory[i] === posKey) {
                // More recent = higher penalty (scaled up significantly)
                penalty += 50 * (1 + (moveHistory.length - i) / moveHistory.length);
            }
        }
        
        // Exponential penalty for positions visited many times overall
        var visitCount = positionVisitCount[posKey] || 0;
        if (visitCount > 2) {
            penalty += Math.pow(visitCount - 2, 2) * 30;  // 30, 120, 270, 480...
        }
        
        return penalty;
    }
    
    function recordPosition(pos) {
        var posKey = Math.round(pos.x / 10) + ',' + Math.round(pos.y / 10);
        moveHistory.push(posKey);
        if (moveHistory.length > HISTORY_LENGTH) {
            moveHistory.shift();
        }
        // Track total visits to this position
        positionVisitCount[posKey] = (positionVisitCount[posKey] || 0) + 1;
    }
    
    function recordDecision(time, nodes) {
        stats.decisionCount++;
        stats.totalTime += time;
        stats.nodesEvaluated += nodes;
        stats.avgDecisionTime = stats.totalTime / stats.decisionCount;
    }
    
    function getStats() {
        return stats;
    }
    
    // Utility: Get valid moves from a position
    function getValidMoves(map, pos) {
        var moves = [];
        var directions = [UP, DOWN, LEFT, RIGHT];
        var deltas = {
            [UP]: {x: 0, y: -1},
            [DOWN]: {x: 0, y: 1},
            [LEFT]: {x: -1, y: 0},
            [RIGHT]: {x: 1, y: 0}
        };
        
        var gridX = Math.round(pos.x / 10);
        var gridY = Math.round(pos.y / 10);
        
        for (var i = 0; i < directions.length; i++) {
            var dir = directions[i];
            var newPos = {
                x: gridX + deltas[dir].x,
                y: gridY + deltas[dir].y
            };
            if (map.isFloorSpace(newPos)) {
                moves.push(dir);
            }
        }
        return moves;
    }
    
    // Utility: Manhattan distance
    function manhattanDistance(pos1, pos2) {
        return Math.abs(pos1.x - pos2.x) + Math.abs(pos1.y - pos2.y);
    }
    
    // Tunnel constants (row 10, columns 0 and 18)
    var TUNNEL_ROW = 10;
    var MAP_WIDTH = 19;
    
    // Utility: Manhattan distance considering tunnel wrap-around
    function tunnelAwareDistance(pos1, pos2) {
        var directDist = Math.abs(pos1.x - pos2.x) + Math.abs(pos1.y - pos2.y);
        
        // Check if tunnel could be shorter
        // Tunnel is at row 10, connecting x=0 and x=18
        var tunnelDist = Infinity;
        
        // Cost to reach tunnel from pos1 + 1 (tunnel crossing) + cost from tunnel to pos2
        var pos1ToTunnelLeft = Math.abs(pos1.x - 0) + Math.abs(pos1.y - TUNNEL_ROW);
        var pos1ToTunnelRight = Math.abs(pos1.x - (MAP_WIDTH - 1)) + Math.abs(pos1.y - TUNNEL_ROW);
        var pos2ToTunnelLeft = Math.abs(pos2.x - 0) + Math.abs(pos2.y - TUNNEL_ROW);
        var pos2ToTunnelRight = Math.abs(pos2.x - (MAP_WIDTH - 1)) + Math.abs(pos2.y - TUNNEL_ROW);
        
        // Go left through tunnel, exit right (or vice versa)
        tunnelDist = Math.min(
            pos1ToTunnelLeft + 1 + pos2ToTunnelRight,
            pos1ToTunnelRight + 1 + pos2ToTunnelLeft
        );
        
        return Math.min(directDist, tunnelDist);
    }
    
    // Utility: Convert pixel position to grid position
    function toGrid(pos) {
        return {
            x: Math.round(pos.x / 10),
            y: Math.round(pos.y / 10)
        };
    }
    
    // ===================
    // A* PATHFINDING
    // ===================
    
    function astar(map, start, goal) {
        var startGrid = toGrid(start);
        var goalGrid = toGrid(goal);
        
        var openSet = [startGrid];
        var cameFrom = {};
        var gScore = {};
        var fScore = {};
        var nodesEvaluated = 0;
        
        var key = function(pos) { return pos.x + ',' + pos.y; };
        
        gScore[key(startGrid)] = 0;
        fScore[key(startGrid)] = tunnelAwareDistance(startGrid, goalGrid);
        
        while (openSet.length > 0) {
            nodesEvaluated++;
            
            // Get node with lowest fScore
            var current = openSet.reduce(function(a, b) {
                return (fScore[key(a)] || Infinity) < (fScore[key(b)] || Infinity) ? a : b;
            });
            
            if (current.x === goalGrid.x && current.y === goalGrid.y) {
                // Reconstruct path and return first move
                var path = [current];
                while (cameFrom[key(current)]) {
                    current = cameFrom[key(current)];
                    path.unshift(current);
                }
                
                if (path.length > 1) {
                    var next = path[1];
                    var dx = next.x - startGrid.x;
                    var dy = next.y - startGrid.y;
                    
                    // Handle tunnel wrap-around
                    var direction = NONE;
                    if (startGrid.y === TUNNEL_ROW && next.y === TUNNEL_ROW) {
                        // Check for tunnel wrap
                        if (startGrid.x === 0 && next.x === MAP_WIDTH - 1) {
                            direction = LEFT; // Go left through tunnel
                        } else if (startGrid.x === MAP_WIDTH - 1 && next.x === 0) {
                            direction = RIGHT; // Go right through tunnel
                        } else if (dx > 0) direction = RIGHT;
                        else if (dx < 0) direction = LEFT;
                    } else {
                        if (dx > 0) direction = RIGHT;
                        else if (dx < 0) direction = LEFT;
                        else if (dy > 0) direction = DOWN;
                        else if (dy < 0) direction = UP;
                    }
                    
                    return { direction: direction, nodesEvaluated: nodesEvaluated };
                }
                return { direction: NONE, nodesEvaluated: nodesEvaluated };
            }
            
            // Remove current from openSet
            openSet = openSet.filter(function(n) { return !(n.x === current.x && n.y === current.y); });
            
            // Check neighbors (including tunnel wrap-around)
            var neighbors = [
                {x: current.x + 1, y: current.y},
                {x: current.x - 1, y: current.y},
                {x: current.x, y: current.y + 1},
                {x: current.x, y: current.y - 1}
            ];
            
            // Add tunnel connections at row 10
            if (current.y === TUNNEL_ROW) {
                if (current.x === 0) {
                    neighbors.push({x: MAP_WIDTH - 1, y: TUNNEL_ROW}); // Wrap to right side
                } else if (current.x === MAP_WIDTH - 1) {
                    neighbors.push({x: 0, y: TUNNEL_ROW}); // Wrap to left side
                }
            }
            
            for (var i = 0; i < neighbors.length; i++) {
                var neighbor = neighbors[i];
                
                // Skip invalid positions (but allow tunnel endpoints)
                var isTunnelWrap = (current.y === TUNNEL_ROW && 
                    ((current.x === 0 && neighbor.x === MAP_WIDTH - 1) ||
                     (current.x === MAP_WIDTH - 1 && neighbor.x === 0)));
                
                if (!isTunnelWrap && !map.isFloorSpace(neighbor)) continue;
                if (isTunnelWrap && !map.isFloorSpace(neighbor)) continue;
                
                var tentativeG = (gScore[key(current)] || Infinity) + 1;
                
                if (tentativeG < (gScore[key(neighbor)] || Infinity)) {
                    cameFrom[key(neighbor)] = current;
                    gScore[key(neighbor)] = tentativeG;
                    fScore[key(neighbor)] = tentativeG + tunnelAwareDistance(neighbor, goalGrid);
                    
                    var inOpen = openSet.some(function(n) { return n.x === neighbor.x && n.y === neighbor.y; });
                    if (!inOpen) {
                        openSet.push(neighbor);
                    }
                }
            }
            
            // Safety limit
            if (nodesEvaluated > 500) break;
        }
        
        return { direction: NONE, nodesEvaluated: nodesEvaluated };
    }
    
    // ===================
    // MINIMAX ALGORITHM
    // ===================
    
    function minimax(map, pacmanPos, ghostPositions, ghostStates, depth, isMaximizing, alpha, beta, nodesRef) {
        nodesRef.count++;
        
        if (depth === 0) {
            return evaluateState(map, pacmanPos, ghostPositions, ghostStates);
        }
        
        var pacmanGrid = toGrid(pacmanPos);
        var validMoves = getValidMoves(map, pacmanPos);
        
        if (validMoves.length === 0) {
            return evaluateState(map, pacmanPos, ghostPositions, ghostStates);
        }
        
        var deltas = {
            [UP]: {x: 0, y: -10},
            [DOWN]: {x: 0, y: 10},
            [LEFT]: {x: -10, y: 0},
            [RIGHT]: {x: 10, y: 0}
        };
        
        if (isMaximizing) {
            // Pac-Man's turn (maximize)
            var maxEval = -Infinity;
            
            for (var i = 0; i < validMoves.length; i++) {
                var move = validMoves[i];
                var newPos = {
                    x: pacmanPos.x + deltas[move].x,
                    y: pacmanPos.y + deltas[move].y
                };
                
                var evalScore = minimax(map, newPos, ghostPositions, ghostStates, depth - 1, false, alpha, beta, nodesRef);
                maxEval = Math.max(maxEval, evalScore);
                alpha = Math.max(alpha, evalScore);
                if (beta <= alpha) break; // Pruning
            }
            return maxEval;
        } else {
            // Ghosts' turn (minimize)
            var minEval = Infinity;
            
            // Move ghosts toward Pac-Man (only dangerous ones move aggressively, edible ones move away)
            var newGhostPositions = ghostPositions.map(function(gPos, idx) {
                var gGrid = toGrid(gPos);
                var pGrid = toGrid(pacmanPos);
                
                var dx = pGrid.x - gGrid.x;
                var dy = pGrid.y - gGrid.y;
                
                // If ghost is edible, it tries to move away from Pac-Man
                var multiplier = ghostStates[idx].isEdible ? -1 : 1;
                
                var moveX = dx !== 0 ? (dx > 0 ? 10 * multiplier : -10 * multiplier) : 0;
                var moveY = dy !== 0 ? (dy > 0 ? 10 * multiplier : -10 * multiplier) : 0;
                
                // Prefer the axis with greater distance
                if (Math.abs(dx) > Math.abs(dy)) {
                    var testPos = {x: gPos.x + moveX, y: gPos.y};
                    if (map.isFloorSpace(toGrid(testPos))) {
                        return testPos;
                    }
                }
                var testPos = {x: gPos.x, y: gPos.y + moveY};
                if (map.isFloorSpace(toGrid(testPos))) {
                    return testPos;
                }
                return gPos;
            });
            
            var evalScore = minimax(map, pacmanPos, newGhostPositions, ghostStates, depth - 1, true, alpha, beta, nodesRef);
            minEval = Math.min(minEval, evalScore);
            
            return minEval;
        }
    }
    
    function evaluateState(map, pacmanPos, ghostPositions, ghostStates) {
        var score = 0;
        var pacmanGrid = toGrid(pacmanPos);
        var mapData = map.getMap();
        
        // Count dangerous vs edible ghosts
        var dangerousGhosts = [];
        var edibleGhosts = [];
        for (var i = 0; i < ghostPositions.length; i++) {
            if (ghostStates[i].isEdible) {
                edibleGhosts.push(ghostPositions[i]);
            } else {
                dangerousGhosts.push(ghostPositions[i]);
            }
        }
        
        // Handle dangerous ghosts - heavily penalize being close
        for (var i = 0; i < dangerousGhosts.length; i++) {
            var ghostGrid = toGrid(dangerousGhosts[i]);
            var dist = manhattanDistance(pacmanGrid, ghostGrid);
            if (dist < 2) {
                score -= 2000; // Imminent death!
            } else if (dist < 4) {
                score -= 500 / dist; // Very dangerous
            } else if (dist < 8) {
                score -= 50 / dist; // Stay aware
            }
        }
        
        // Handle edible ghosts - heavily reward eating them!
        for (var i = 0; i < edibleGhosts.length; i++) {
            var ghostGrid = toGrid(edibleGhosts[i]);
            var dist = manhattanDistance(pacmanGrid, ghostGrid);
            if (dist === 0) {
                score += 1000; // Eating a ghost!
            } else if (dist < 5) {
                score += 400 / dist; // Chase edible ghosts aggressively
            } else if (dist < 10) {
                score += 100 / dist; // Worth pursuing
            }
        }
        
        // Reward being on a pellet
        if (mapData[pacmanGrid.y] && mapData[pacmanGrid.y][pacmanGrid.x] === Pacman.BISCUIT) {
            score += 50;
        }
        
        // Power pellets are valuable - especially when dangerous ghosts are near
        if (mapData[pacmanGrid.y] && mapData[pacmanGrid.y][pacmanGrid.x] === Pacman.PILL) {
            var powerPelletValue = 150;
            // Extra valuable if dangerous ghosts are nearby
            if (dangerousGhosts.length > 0 && edibleGhosts.length === 0) {
                var nearestDangerDist = Math.min.apply(Math, dangerousGhosts.map(function(g) {
                    return manhattanDistance(pacmanGrid, toGrid(g));
                }));
                if (nearestDangerDist < 10) {
                    powerPelletValue = 500; // Very valuable!
                }
            }
            score += powerPelletValue;
        }
        
        // If no edible ghosts and safe from danger, seek pellets
        if (edibleGhosts.length === 0 && (dangerousGhosts.length === 0 || 
            Math.min.apply(Math, dangerousGhosts.map(function(g) {
                return manhattanDistance(pacmanGrid, toGrid(g));
            })) > 8)) {
            var nearestPellet = findNearestPellet(map, pacmanGrid);
            if (nearestPellet) {
                var pelletDist = manhattanDistance(pacmanGrid, nearestPellet);
                score += 30 - pelletDist; // Moderate reward for efficiency
            }
        }
        
        return score;
    }
    
    function findNearestPellet(map, pos) {
        var mapData = map.getMap();
        var nearest = null;
        var minDist = Infinity;
        
        for (var y = 0; y < mapData.length; y++) {
            for (var x = 0; x < mapData[y].length; x++) {
                if (mapData[y][x] === Pacman.BISCUIT || mapData[y][x] === Pacman.PILL) {
                    var dist = manhattanDistance(pos, {x: x, y: y});
                    if (dist < minDist) {
                        minDist = dist;
                        nearest = {x: x, y: y};
                    }
                }
            }
        }
        return nearest;
    }
    
    // Find nearest regular pellet only (not power pellets)
    function findNearestRegularPellet(map, pos) {
        var mapData = map.getMap();
        var nearest = null;
        var minDist = Infinity;
        
        for (var y = 0; y < mapData.length; y++) {
            for (var x = 0; x < mapData[y].length; x++) {
                if (mapData[y][x] === Pacman.BISCUIT) {
                    var dist = manhattanDistance(pos, {x: x, y: y});
                    if (dist < minDist) {
                        minDist = dist;
                        nearest = {x: x, y: y};
                    }
                }
            }
        }
        return nearest;
    }
    
    // Find nearest power pellet
    function findNearestPowerPellet(map, pos) {
        var mapData = map.getMap();
        var nearest = null;
        var minDist = Infinity;
        
        for (var y = 0; y < mapData.length; y++) {
            for (var x = 0; x < mapData[y].length; x++) {
                if (mapData[y][x] === Pacman.PILL) {
                    var dist = manhattanDistance(pos, {x: x, y: y});
                    if (dist < minDist) {
                        minDist = dist;
                        nearest = {x: x, y: y};
                    }
                }
            }
        }
        return nearest;
    }
    
    // ===================
    // CLASSIC GHOST AI (1980s)
    // ===================
    
    var ClassicGhostAI = {
        // Simple direction picker: moves toward target without pathfinding (1980s style)
        moveToward: function(map, ghostPos, targetPos) {
            var ghostGrid = toGrid(ghostPos);
            var targetGrid = toGrid(targetPos);
            var validMoves = getValidMoves(map, ghostPos);
            
            if (validMoves.length === 0) return NONE;
            
            var dx = targetGrid.x - ghostGrid.x;
            var dy = targetGrid.y - ghostGrid.y;
            
            // Prefer axis with larger distance
            var preferredMoves = [];
            if (Math.abs(dx) > Math.abs(dy)) {
                // Horizontal first
                if (dx > 0) preferredMoves = [RIGHT, dy > 0 ? DOWN : UP, LEFT];
                else preferredMoves = [LEFT, dy > 0 ? DOWN : UP, RIGHT];
            } else {
                // Vertical first
                if (dy > 0) preferredMoves = [DOWN, dx > 0 ? RIGHT : LEFT, UP];
                else preferredMoves = [UP, dx > 0 ? RIGHT : LEFT, DOWN];
            }
            
            // Pick first valid preferred move
            for (var i = 0; i < preferredMoves.length; i++) {
                if (validMoves.indexOf(preferredMoves[i]) !== -1) {
                    return preferredMoves[i];
                }
            }
            
            return validMoves[0];
        },
        
        // Blinky (Red) - Direct chase
        blinky: function(map, ghostPos, pacmanPos) {
            return this.moveToward(map, ghostPos, pacmanPos);
        },
        
        // Pinky (Pink) - Ambush (target 4 tiles ahead of Pac-Man)
        pinky: function(map, ghostPos, pacmanPos, pacmanDir) {
            var deltas = {
                [UP]: {x: 0, y: -40},
                [DOWN]: {x: 0, y: 40},
                [LEFT]: {x: -40, y: 0},
                [RIGHT]: {x: 40, y: 0},
                [NONE]: {x: 0, y: 0}
            };
            
            var delta = deltas[pacmanDir] || {x: 0, y: 0};
            var target = {
                x: pacmanPos.x + delta.x,
                y: pacmanPos.y + delta.y
            };
            
            return this.moveToward(map, ghostPos, target);
        },
        
        // Inky (Cyan) - Flanking (complex targeting)
        inky: function(map, ghostPos, pacmanPos, blinkyPos) {
            // Target is reflection of Blinky across Pac-Man
            var target = {
                x: pacmanPos.x + (pacmanPos.x - blinkyPos.x),
                y: pacmanPos.y + (pacmanPos.y - blinkyPos.y)
            };
            return this.moveToward(map, ghostPos, target);
        },
        
        // Clyde (Orange) - Erratic (chase if far, scatter if close)
        clyde: function(map, ghostPos, pacmanPos) {
            var dist = manhattanDistance(toGrid(ghostPos), toGrid(pacmanPos));
            if (dist > 8) {
                // Chase
                return this.moveToward(map, ghostPos, pacmanPos);
            } else {
                // Scatter to corner
                return this.moveToward(map, ghostPos, {x: 0, y: 210});
            }
        }
    };
    
    // ===================
    // PAC-MAN AI CONTROLLERS
    // ===================
    
    var PacmanControllers = {
        
        greedy: function(map, pacmanPos, lastMove) {
            // Greedy: simple nearest pellet chase, no danger awareness
            var startTime = performance.now();
            var pacmanGrid = toGrid(pacmanPos);
            
            var validMoves = getValidMoves(map, pacmanPos);
            if (validMoves.length === 0) return NONE;
            
            var nearest = findNearestPellet(map, pacmanGrid);
            
            // If no pellets left, just pick any valid move
            if (!nearest) {
                var endTime = performance.now();
                recordDecision(endTime - startTime, validMoves.length);
                recordPosition(pacmanPos);
                return validMoves[0];
            }
            
            var deltas = {
                [UP]: {x: 0, y: -1},
                [DOWN]: {x: 0, y: 1},
                [LEFT]: {x: -1, y: 0},
                [RIGHT]: {x: 1, y: 0}
            };
            
            var bestMove = validMoves[0];
            var bestScore = -Infinity;
            
            for (var i = 0; i < validMoves.length; i++) {
                var move = validMoves[i];
                var newPos = {
                    x: pacmanGrid.x + deltas[move].x,
                    y: pacmanGrid.y + deltas[move].y
                };
                var dist = manhattanDistance(newPos, nearest);
                // Score: closer is better, minus oscillation penalty
                var score = -dist - getOscillationPenalty(pacmanPos, move, lastMove);
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = move;
                }
            }
            
            var endTime = performance.now();
            recordDecision(endTime - startTime, validMoves.length);
            recordPosition(pacmanPos);
            return bestMove;
        },
        
        random: function(map, pacmanPos, lastMove) {
            var moves = getValidMoves(map, pacmanPos);
            if (moves.length === 0) return NONE;
            
            // Even random avoids immediate reversals and recent positions
            var bestMove = moves[0];
            var bestScore = -Infinity;
            
            for (var i = 0; i < moves.length; i++) {
                var move = moves[i];
                var score = Math.random() * 10 - getOscillationPenalty(pacmanPos, move, lastMove);
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = move;
                }
            }
            
            recordPosition(pacmanPos);
            return bestMove;
        },
        
        astar: function(map, pacmanPos, ghostPositions, ghostStates, lastMove) {
            var startTime = performance.now();
            var pacmanGrid = toGrid(pacmanPos);
            var nodesEvaluated = 0;
            
            // Check ghost states
            var edibleGhosts = [];
            var dangerousGhostGrids = [];
            var closestDangerDist = Infinity;
            
            for (var g = 0; g < ghostPositions.length; g++) {
                var ghostGrid = toGrid(ghostPositions[g]);
                if (ghostStates[g].isEdible) {
                    edibleGhosts.push(ghostGrid);
                } else if (ghostStates[g].isDangerous) {
                    dangerousGhostGrids.push(ghostGrid);
                    var dist = manhattanDistance(pacmanGrid, ghostGrid);
                    if (dist < closestDangerDist) {
                        closestDangerDist = dist;
                    }
                }
            }
            
            // Determine goal priority:
            // 1. If ghosts are edible -> hunt nearest ghost
            // 2. If dangerous ghost is close (within 8 tiles) -> go for power pellet
            // 3. Otherwise -> collect regular pellets
            var goalGrid = null;
            var huntingGhost = false;
            
            if (edibleGhosts.length > 0) {
                // Hunt nearest edible ghost
                var nearestGhost = null;
                var minDist = Infinity;
                for (var i = 0; i < edibleGhosts.length; i++) {
                    var dist = manhattanDistance(pacmanGrid, edibleGhosts[i]);
                    if (dist < minDist) {
                        minDist = dist;
                        nearestGhost = edibleGhosts[i];
                    }
                }
                goalGrid = nearestGhost;
                huntingGhost = true;
            } else if (closestDangerDist < 8) {
                // Ghost is close! Try to get a power pellet
                var powerPellet = findNearestPowerPellet(map, pacmanGrid);
                if (powerPellet) {
                    goalGrid = powerPellet;
                } else {
                    // No power pellets left, just get regular pellets
                    goalGrid = findNearestRegularPellet(map, pacmanGrid);
                }
            } else {
                // Safe - collect regular pellets
                goalGrid = findNearestRegularPellet(map, pacmanGrid);
                if (!goalGrid) {
                    // No regular pellets, get power pellet
                    goalGrid = findNearestPowerPellet(map, pacmanGrid);
                }
            }
            
            if (!goalGrid) {
                var moves = getValidMoves(map, pacmanPos);
                return moves.length > 0 ? moves[0] : NONE;
            }
            
            var openSet = [pacmanGrid];
            var cameFrom = {};
            var gScore = {};
            var fScore = {};
            
            var key = function(pos) { return pos.x + ',' + pos.y; };
            
            // Calculate danger cost for a tile (only when not hunting)
            function dangerCost(pos) {
                if (huntingGhost) return 0; // No danger penalty when hunting
                var cost = 0;
                for (var i = 0; i < dangerousGhostGrids.length; i++) {
                    var dist = manhattanDistance(pos, dangerousGhostGrids[i]);
                    if (dist < 2) cost += 50;
                    else if (dist < 4) cost += 20;
                    else if (dist < 6) cost += 5;
                }
                return cost;
            }
            
            gScore[key(pacmanGrid)] = 0;
            fScore[key(pacmanGrid)] = manhattanDistance(pacmanGrid, goalGrid);
            
            while (openSet.length > 0) {
                nodesEvaluated++;
                
                var current = openSet.reduce(function(a, b) {
                    return (fScore[key(a)] || Infinity) < (fScore[key(b)] || Infinity) ? a : b;
                });
                
                if (current.x === goalGrid.x && current.y === goalGrid.y) {
                    // Reconstruct path
                    var path = [current];
                    while (cameFrom[key(current)]) {
                        current = cameFrom[key(current)];
                        path.unshift(current);
                    }
                    
                    if (path.length > 1) {
                        var next = path[1];
                        var dx = next.x - pacmanGrid.x;
                        var dy = next.y - pacmanGrid.y;
                        
                        var direction = NONE;
                        if (dx > 0) direction = RIGHT;
                        else if (dx < 0) direction = LEFT;
                        else if (dy > 0) direction = DOWN;
                        else if (dy < 0) direction = UP;
                        
                        var endTime = performance.now();
                        recordDecision(endTime - startTime, nodesEvaluated);
                        return direction;
                    }
                    break;
                }
                
                openSet = openSet.filter(function(n) { return !(n.x === current.x && n.y === current.y); });
                
                var neighbors = [
                    {x: current.x + 1, y: current.y},
                    {x: current.x - 1, y: current.y},
                    {x: current.x, y: current.y + 1},
                    {x: current.x, y: current.y - 1}
                ];
                
                for (var i = 0; i < neighbors.length; i++) {
                    var neighbor = neighbors[i];
                    if (!map.isFloorSpace(neighbor)) continue;
                    
                    // Cost = 1 (base) + danger penalty
                    var moveCost = 1 + dangerCost(neighbor);
                    var tentativeG = (gScore[key(current)] || Infinity) + moveCost;
                    
                    if (tentativeG < (gScore[key(neighbor)] || Infinity)) {
                        cameFrom[key(neighbor)] = current;
                        gScore[key(neighbor)] = tentativeG;
                        fScore[key(neighbor)] = tentativeG + manhattanDistance(neighbor, goalGrid);
                        
                        var inOpen = openSet.some(function(n) { return n.x === neighbor.x && n.y === neighbor.y; });
                        if (!inOpen) {
                            openSet.push(neighbor);
                        }
                    }
                }
                
                if (nodesEvaluated > 500) break;
            }
            
            // Fallback: pick move that goes toward goal while avoiding immediate danger
            var validMoves = getValidMoves(map, pacmanPos);
            if (validMoves.length === 0) return NONE;
            
            var deltas = {
                [UP]: {x: 0, y: -1},
                [DOWN]: {x: 0, y: 1},
                [LEFT]: {x: -1, y: 0},
                [RIGHT]: {x: 1, y: 0}
            };
            
            var bestMove = validMoves[0];
            var bestScore = -Infinity;
            
            for (var i = 0; i < validMoves.length; i++) {
                var move = validMoves[i];
                var newPos = {
                    x: pacmanGrid.x + deltas[move].x,
                    y: pacmanGrid.y + deltas[move].y
                };
                // Score = closer to goal is good, danger is bad, oscillation is bad
                var score = -manhattanDistance(newPos, goalGrid) - dangerCost(newPos) - getOscillationPenalty(pacmanPos, move, lastMove);
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = move;
                }
            }
            
            var endTime = performance.now();
            recordDecision(endTime - startTime, nodesEvaluated);
            recordPosition(pacmanPos);
            return bestMove;
        },
        
        minimax: function(map, pacmanPos, ghostPositions, ghostStates, depth, lastMove) {
            var startTime = performance.now();
            depth = depth || 4;
            
            var validMoves = getValidMoves(map, pacmanPos);
            if (validMoves.length === 0) return NONE;
            
            var bestMove = validMoves[0];
            var bestScore = -Infinity;
            var nodesRef = { count: 0 };
            
            var deltas = {
                [UP]: {x: 0, y: -10},
                [DOWN]: {x: 0, y: 10},
                [LEFT]: {x: -10, y: 0},
                [RIGHT]: {x: 10, y: 0}
            };
            
            for (var i = 0; i < validMoves.length; i++) {
                var move = validMoves[i];
                var newPos = {
                    x: pacmanPos.x + deltas[move].x,
                    y: pacmanPos.y + deltas[move].y
                };
                
                var score = minimax(map, newPos, ghostPositions, ghostStates, depth - 1, false, -Infinity, Infinity, nodesRef);
                
                // Apply oscillation penalty
                score -= getOscillationPenalty(pacmanPos, move, lastMove);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = move;
                }
            }
            
            var endTime = performance.now();
            recordDecision(endTime - startTime, nodesRef.count);
            recordPosition(pacmanPos);
            
            return bestMove;
        },
        
        adaptive: function(map, pacmanPos, ghostPositions, ghostStates, depth, lastMove) {
            var startTime = performance.now();
            depth = depth || 4;
            
            var validMoves = getValidMoves(map, pacmanPos);
            if (validMoves.length === 0) return NONE;
            
            var bestMove = validMoves[0];
            var bestScore = -Infinity;
            var nodesRef = { count: 0 };
            
            var deltas = {
                [UP]: {x: 0, y: -10},
                [DOWN]: {x: 0, y: 10},
                [LEFT]: {x: -10, y: 0},
                [RIGHT]: {x: 10, y: 0}
            };
            
            for (var i = 0; i < validMoves.length; i++) {
                var move = validMoves[i];
                var newPos = {
                    x: pacmanPos.x + deltas[move].x,
                    y: pacmanPos.y + deltas[move].y
                };
                
                // Use expectimax with learned ghost model
                var score = expectimax(map, newPos, ghostPositions, ghostStates, depth - 1, false, nodesRef);
                
                // Apply oscillation penalty
                score -= getOscillationPenalty(pacmanPos, move, lastMove);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = move;
                }
            }
            
            var endTime = performance.now();
            recordDecision(endTime - startTime, nodesRef.count);
            recordPosition(pacmanPos);
            
            return bestMove;
        }
    };
    
    // ===================
    // GHOST AI CONTROLLERS
    // ===================
    
    var GhostControllers = {
        
        classic: function(map, ghost, pacmanPos, pacmanDir, allGhosts) {
            var ghostPos = ghost.getPosition();
            var idx = ghost.getIndex();
            
            switch(idx) {
                case 0: return ClassicGhostAI.blinky(map, ghostPos, pacmanPos);
                case 1: return ClassicGhostAI.pinky(map, ghostPos, pacmanPos, pacmanDir);
                case 2: 
                    var blinkyPos = allGhosts[0] ? allGhosts[0].getPosition() : pacmanPos;
                    return ClassicGhostAI.inky(map, ghostPos, pacmanPos, blinkyPos);
                case 3: return ClassicGhostAI.clyde(map, ghostPos, pacmanPos);
                default: return ClassicGhostAI.blinky(map, ghostPos, pacmanPos);
            }
        },
        
        random: function(map, ghost) {
            var ghostPos = ghost.getPosition();
            var moves = getValidMoves(map, ghostPos);
            if (moves.length === 0) return NONE;
            return moves[Math.floor(Math.random() * moves.length)];
        },
        
        astar: function(map, ghost, pacmanPos) {
            var ghostPos = ghost.getPosition();
            return astar(map, ghostPos, pacmanPos).direction;
        },
        
        minimax: function(map, ghost, pacmanPos, allGhostPositions, ghostStates, depth) {
            // For ghost minimax, we want to minimize Pac-Man's score
            var startTime = performance.now();
            depth = depth || 3;
            
            var ghostPos = ghost.getPosition();
            var ghostIdx = ghost.getIndex();
            
            // If this ghost is edible, just try to run away (don't use minimax)
            if (ghostStates[ghostIdx].isEdible) {
                // Simple evasion: move away from Pac-Man
                var validMoves = getValidMoves(map, ghostPos);
                if (validMoves.length === 0) return NONE;
                
                var ghostGrid = toGrid(ghostPos);
                var pacmanGrid = toGrid(pacmanPos);
                var bestMove = validMoves[0];
                var maxDist = -Infinity;
                
                var deltas = {
                    [UP]: {x: 0, y: -1},
                    [DOWN]: {x: 0, y: 1},
                    [LEFT]: {x: -1, y: 0},
                    [RIGHT]: {x: 1, y: 0}
                };
                
                for (var i = 0; i < validMoves.length; i++) {
                    var move = validMoves[i];
                    var newPos = {
                        x: ghostGrid.x + deltas[move].x,
                        y: ghostGrid.y + deltas[move].y
                    };
                    var dist = manhattanDistance(newPos, pacmanGrid);
                    if (dist > maxDist) {
                        maxDist = dist;
                        bestMove = move;
                    }
                }
                return bestMove;
            }
            
            // Normal minimax for dangerous ghosts
            var validMoves = getValidMoves(map, ghostPos);
            if (validMoves.length === 0) return NONE;
            
            var bestMove = validMoves[0];
            var bestScore = Infinity; // Ghost wants to minimize
            var nodesRef = { count: 0 };
            
            var deltas = {
                [UP]: {x: 0, y: -10},
                [DOWN]: {x: 0, y: 10},
                [LEFT]: {x: -10, y: 0},
                [RIGHT]: {x: 10, y: 0}
            };
            
            for (var i = 0; i < validMoves.length; i++) {
                var move = validMoves[i];
                var newGhostPos = {
                    x: ghostPos.x + deltas[move].x,
                    y: ghostPos.y + deltas[move].y
                };
                
                // Update this ghost's position in the array
                var newGhostPositions = allGhostPositions.map(function(pos, idx) {
                    if (idx === ghostIdx) return newGhostPos;
                    return pos;
                });
                
                var score = minimax(map, pacmanPos, newGhostPositions, ghostStates, depth - 1, true, -Infinity, Infinity, nodesRef);
                
                if (score < bestScore) {
                    bestScore = score;
                    bestMove = move;
                }
            }
            
            var endTime = performance.now();
            recordDecision(endTime - startTime, nodesRef.count);
            
            return bestMove;
        }
    };
    
    // Public API
    return {
        PacmanControllers: PacmanControllers,
        GhostControllers: GhostControllers,
        getStats: getStats,
        resetStats: resetStats,
        fullReset: fullReset,
        recordGhostMove: recordGhostMove,
        resetGhostModel: resetGhostModel,
        getGhostModelStats: function() {
            return {
                totalObservations: totalObservations,
                confidence: stats.ghostModelConfidence
            };
        },
        manhattanDistance: manhattanDistance,
        toGrid: toGrid,
        astar: astar
    };
    
})();
