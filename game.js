/*
 * Pac-Man AI Showdown - Main Game Controller
 * Connects the game engine with AI controllers
 */

var GAME = (function () {
    var state = WAITING,
        audio = null,
        ghosts = [],
        ghostSpecs = ["#FF0000", "#FFB8DE", "#00FFDE", "#FFB847"], // Blinky, Pinky, Inky, Clyde
        eatenCount = 0,
        level = 0,
        tick = 0,
        ghostPos, userPos,
        stateChanged = true,
        timerStart = null,
        lastTime = 0,
        ctx = null,
        timer = null,
        map = null,
        user = null,
        stored = null;
    
    // AI settings
    var pacmanAI = 'greedy';
    var ghostAI = 'classic'; // Always classic
    var aiTickCounter = 0;
    var lastPacmanMove = NONE;
    var minimaxDepth = 6;
    var lastGhostPositions = []; // Track ghost positions to detect moves
    
    // Benchmark mode
    var benchmarkMode = false;
    var benchmarkAlgos = ['random', 'greedy', 'astar', 'minimax'];
    var benchmarkCurrentAlgo = 0;
    var benchmarkCurrentRun = 0;
    var benchmarkRunsPerAlgo = 100;
    var benchmarkResults = {};
    var benchmarkRunStart = 0;
    var benchmarkGhostsEaten = 0;
    var benchmarkTimer = null;
    var benchmarkCancelled = false;
    
    // Algorithm descriptions
    var algoDescriptions = {
        'random': {
            title: 'Random',
            paradigm: 'Reactive',
            desc: 'Picks a random valid direction at each intersection. No intelligence - just demonstrates the baseline. Survives longer than you might expect!'
        },
        'greedy': {
            title: 'Greedy',
            paradigm: 'Reactive',
            desc: 'Always moves toward the nearest pellet. Simple reflex agent - no planning, no danger awareness. Often walks straight into ghosts.'
        },
        'astar': {
            title: 'A* Pathfinding',
            paradigm: 'Planning',
            desc: 'Smart goal selection: hunts edible ghosts, grabs power pellets when threatened, otherwise collects pellets. Optimal routing with danger avoidance.'
        },
        'minimax': {
            title: 'Minimax',
            paradigm: 'Game Theory',
            desc: 'Assumes ghosts will make the worst move for Pac-Man and plans accordingly. Designed for adversarial games like chess. Overkill for predictable ghosts!'
        },
        'adaptive': {
            title: 'Adaptive',
            paradigm: 'Learning',
            desc: 'Learns ghost patterns through observation, then uses Expectimax to plan. Starts uncertain, gets smarter each game. Watch the confidence grow!'
        }
    };
    
    function getTick() { return tick; }
    
    function drawScore(text, position) {
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "12px 'Press Start 2P'";
        ctx.fillText(text, (position["new"]["x"] / 10) * map.blockSize,
                     ((position["new"]["y"] + 5) / 10) * map.blockSize);
    }
    
    function dialog(text) {
        ctx.fillStyle = "#FFFF00";
        ctx.font = "14px 'Press Start 2P'";
        var width = ctx.measureText(text).width,
            x = ((map.width * map.blockSize) - width) / 2;
        ctx.fillText(text, x, (map.height * 10) + 8);
    }
    
    function soundDisabled() {
        return localStorage["soundDisabled"] === "true";
    }
    
    function startLevel() {
        user.resetPosition();
        for (var i = 0; i < ghosts.length; i += 1) {
            ghosts[i].reset();
        }
        audio.play("start");
        timerStart = tick;
        setState(COUNTDOWN);
    }
    
    function startNewGame() {
        setState(WAITING);
        level = 1;
        user.reset();
        map.reset();
        map.draw(ctx);
        PacmanAI.resetStats();
        startLevel();
    }
    
    function keyDown(e) {
        if (e.keyCode === KEY.N) {
            startNewGame();
        } else if (e.keyCode === KEY.S) {
            audio.disableSound();
            localStorage["soundDisabled"] = !soundDisabled();
        } else if (e.keyCode === KEY.P && state === PAUSE) {
            audio.resume();
            map.draw(ctx);
            setState(stored);
        } else if (e.keyCode === KEY.P) {
            stored = state;
            setState(PAUSE);
            audio.pause();
            map.draw(ctx);
            dialog("PAUSED");
        }
        return true;
    }
    
    function loseLife() {
        setState(WAITING);
        
        // If benchmarking, record the run and continue
        if (benchmarkMode) {
            recordBenchmarkRun();
            return;
        }
        
        user.loseLife();
        if (user.getLives() > 0) {
            startLevel();
        }
    }
    
    // ==================
    // BENCHMARK MODE
    // ==================
    
    function startBenchmark() {
        benchmarkMode = true;
        benchmarkCancelled = false;
        benchmarkCurrentAlgo = 0;
        benchmarkCurrentRun = 0;
        benchmarkResults = {};
        
        // Initialize results for each algo
        benchmarkAlgos.forEach(function(algo) {
            benchmarkResults[algo] = {
                runs: [],
                avgSurvivalTime: 0,
                avgScore: 0,
                avgGhostsEaten: 0,
                avgDecisionTime: 0
            };
        });
        
        // Disable sound during benchmark
        audio.disableSound();
        
        // Update UI - show cancel button
        var btn = document.getElementById('benchmark-btn');
        btn.textContent = '✕ Cancel';
        btn.style.background = '#330000';
        btn.style.borderColor = '#FF0000';
        btn.style.color = '#FF0000';
        document.getElementById('benchmark-status').style.display = 'block';
        document.getElementById('benchmark-results').style.display = 'none';
        
        // Start first run
        startBenchmarkRun();
    }
    
    function cancelBenchmark() {
        benchmarkCancelled = true;
        benchmarkMode = false;
        
        if (benchmarkTimer) {
            clearInterval(benchmarkTimer);
            benchmarkTimer = null;
        }
        
        // Reset UI
        var btn = document.getElementById('benchmark-btn');
        btn.textContent = 'Run Benchmark';
        btn.style.background = '#002200';
        btn.style.borderColor = '#00FF00';
        btn.style.color = '#00FF00';
        document.getElementById('benchmark-status').style.display = 'none';
        
        setState(WAITING);
    }
    
    function startBenchmarkRun() {
        if (benchmarkCancelled) return;
        
        var algo = benchmarkAlgos[benchmarkCurrentAlgo];
        pacmanAI = algo;
        document.getElementById('pacman-ai').value = algo;
        updateAlgoDescription();
        
        // Update status
        var totalRuns = benchmarkAlgos.length * benchmarkRunsPerAlgo;
        var currentRun = benchmarkCurrentAlgo * benchmarkRunsPerAlgo + benchmarkCurrentRun + 1;
        document.getElementById('benchmark-status').innerHTML = 
            'Testing: <span style="color:#FFFF00;">' + algo.toUpperCase() + '</span><br>' +
            'Run ' + currentRun + ' of ' + totalRuns;
        
        // Reset game state
        level = 1;
        user.reset();
        map.reset();
        map.draw(ctx);
        PacmanAI.resetStats();
        benchmarkGhostsEaten = 0;
        
        // Start playing immediately (skip countdown)
        user.resetPosition();
        for (var i = 0; i < ghosts.length; i++) {
            ghosts[i].reset();
        }
        
        benchmarkRunStart = tick;
        setState(PLAYING); // Skip countdown, go straight to playing
        
        // Run game loop at maximum speed
        if (benchmarkTimer) {
            clearInterval(benchmarkTimer);
        }
        benchmarkTimer = setInterval(benchmarkLoop, 1); // 1ms interval = as fast as possible
    }
    
    // Fast benchmark game loop - runs multiple frames per call
    function benchmarkLoop() {
        if (benchmarkCancelled || !benchmarkMode) return;
        
        // Run multiple game frames per interval for speed
        for (var frame = 0; frame < 10; frame++) {
            if (state !== PLAYING) break;
            
            tick++;
            
            // Simplified game logic (no rendering except occasionally)
            makeAIDecisions();
            
            ghostPos = [];
            for (var i = 0; i < ghosts.length; i++) {
                ghostPos.push(ghosts[i].move(ctx));
            }
            var u = user.move(ctx);
            userPos = u["new"];
            
            // Check collisions
            for (var i = 0; i < ghosts.length; i++) {
                if (collided(userPos, ghostPos[i]["new"])) {
                    if (ghosts[i].isVunerable()) {
                        ghosts[i].eat();
                        eatenCount++;
                        user.addScore(eatenCount * 50);
                        incrementGhostsEaten();
                    } else if (ghosts[i].isDangerous()) {
                        // Death - record and move on
                        if (benchmarkTimer) {
                            clearInterval(benchmarkTimer);
                            benchmarkTimer = null;
                        }
                        recordBenchmarkRun();
                        return;
                    }
                }
            }
        }
        
        // Render occasionally so user can see progress
        if (tick % 30 === 0) {
            map.draw(ctx);
            for (var i = 0; i < ghosts.length; i++) {
                ghosts[i].draw(ctx);
            }
            user.draw(ctx);
            drawFooter();
        }
    }
    
    function recordBenchmarkRun() {
        if (benchmarkCancelled) return;
        
        var algo = benchmarkAlgos[benchmarkCurrentAlgo];
        var survivalTicks = tick - benchmarkRunStart;
        var survivalTime = survivalTicks / Pacman.FPS;
        var stats = PacmanAI.getStats();
        
        benchmarkResults[algo].runs.push({
            survivalTime: survivalTime,
            score: user.theScore(),
            ghostsEaten: benchmarkGhostsEaten,
            avgDecisionTime: stats.avgDecisionTime
        });
        
        benchmarkCurrentRun++;
        
        if (benchmarkCurrentRun >= benchmarkRunsPerAlgo) {
            // Move to next algorithm
            benchmarkCurrentRun = 0;
            benchmarkCurrentAlgo++;
            
            if (benchmarkCurrentAlgo >= benchmarkAlgos.length) {
                // All done!
                finishBenchmark();
                return;
            }
        }
        
        // Start next run immediately
        startBenchmarkRun();
    }
    
    function finishBenchmark() {
        benchmarkMode = false;
        
        if (benchmarkTimer) {
            clearInterval(benchmarkTimer);
            benchmarkTimer = null;
        }
        
        // Calculate averages
        benchmarkAlgos.forEach(function(algo) {
            var results = benchmarkResults[algo];
            var runs = results.runs;
            
            if (runs.length === 0) return;
            
            var totalTime = 0, totalScore = 0, totalGhosts = 0, totalDecision = 0;
            runs.forEach(function(run) {
                totalTime += run.survivalTime;
                totalScore += run.score;
                totalGhosts += run.ghostsEaten;
                totalDecision += run.avgDecisionTime;
            });
            
            results.avgSurvivalTime = (totalTime / runs.length).toFixed(1);
            results.avgScore = Math.round(totalScore / runs.length);
            results.avgGhostsEaten = (totalGhosts / runs.length).toFixed(1);
            results.avgDecisionTime = (totalDecision / runs.length).toFixed(2);
        });
        
        // Display results
        displayBenchmarkResults();
        
        // Reset UI
        var btn = document.getElementById('benchmark-btn');
        btn.textContent = 'Run Benchmark';
        btn.style.background = '#002200';
        btn.style.borderColor = '#00FF00';
        btn.style.color = '#00FF00';
        document.getElementById('benchmark-status').style.display = 'none';
        
        // Re-enable sound
        audio.disableSound();
        
        // Redraw the map properly
        map.draw(ctx);
        setState(WAITING);
    }
    
    function displayBenchmarkResults() {
        // Sort by average score descending
        var sortedAlgos = benchmarkAlgos.slice().sort(function(a, b) {
            return benchmarkResults[b].avgScore - benchmarkResults[a].avgScore;
        });
        
        var html = '<p style="color: #666; font-size: 0.6em; margin-bottom: 15px;">10 runs per algorithm, sorted by average score</p>';
        html += '<table class="results-table">';
        html += '<tr>';
        html += '<th>Rank</th>';
        html += '<th>Algorithm</th>';
        html += '<th style="text-align:right;">Survival</th>';
        html += '<th style="text-align:right;">Avg Score</th>';
        html += '<th style="text-align:right;">Ghosts Eaten</th>';
        html += '<th style="text-align:right;">Decision Time</th>';
        html += '</tr>';
        
        sortedAlgos.forEach(function(algo, idx) {
            var r = benchmarkResults[algo];
            var rankClass = idx < 3 ? 'rank-' + (idx + 1) : '';
            var rankEmoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : (idx + 1);
            html += '<tr>';
            html += '<td><span class="rank-badge ' + rankClass + '">' + rankEmoji + '</span></td>';
            html += '<td>' + algoDescriptions[algo].title + '</td>';
            html += '<td style="text-align:right;">' + r.avgSurvivalTime + 's</td>';
            html += '<td style="text-align:right;">' + r.avgScore + '</td>';
            html += '<td style="text-align:right;">' + r.avgGhostsEaten + '</td>';
            html += '<td style="text-align:right;">' + r.avgDecisionTime + 'ms</td>';
            html += '</tr>';
        });
        
        html += '</table>';
        
        // Add analysis summary
        var winner = sortedAlgos[0];
        var winnerData = benchmarkResults[winner];
        html += '<div style="background: #001a00; border: 1px solid #00FF00; border-radius: 8px; padding: 12px; margin-top: 15px;">';
        html += '<p style="color: #00FF00; font-size: 0.65em; margin: 0 0 8px 0;">🏆 WINNER: ' + algoDescriptions[winner].title.toUpperCase() + '</p>';
        html += '<p style="color: #aaa; font-size: 0.55em; margin: 0; line-height: 1.6;">';
        html += 'Averaged ' + winnerData.avgScore + ' points over ' + winnerData.runs.length + ' games, ';
        html += 'surviving ' + winnerData.avgSurvivalTime + 's and eating ' + winnerData.avgGhostsEaten + ' ghosts per game.';
        html += '</p></div>';
        
        document.getElementById('modal-results-body').innerHTML = html;
        
        // Show modal
        document.getElementById('benchmark-modal').classList.add('active');
        
        // Set up modal event handlers
        document.getElementById('modal-close-x').onclick = closeBenchmarkModal;
        document.getElementById('modal-close-btn').onclick = closeBenchmarkModal;
        document.getElementById('modal-copy-btn').onclick = copyResultsAsText;
        
        // Close on overlay click
        document.getElementById('benchmark-modal').onclick = function(e) {
            if (e.target === this) closeBenchmarkModal();
        };
        
        // Close on Escape key
        document.addEventListener('keydown', handleModalEscape);
    }
    
    function handleModalEscape(e) {
        if (e.key === 'Escape') {
            closeBenchmarkModal();
        }
    }
    
    function closeBenchmarkModal() {
        document.getElementById('benchmark-modal').classList.remove('active');
        document.removeEventListener('keydown', handleModalEscape);
    }
    
    function copyResultsAsText() {
        var sortedAlgos = benchmarkAlgos.slice().sort(function(a, b) {
            return benchmarkResults[b].avgScore - benchmarkResults[a].avgScore;
        });
        
        var text = '## Pac-Man AI Benchmark Results\n';
        text += '(10 runs per algorithm, averaged)\n\n';
        text += '| Rank | Algorithm | Survival | Score | Ghosts Eaten | Decision Time |\n';
        text += '|:----:|-----------|----------|------:|:------------:|---------------:|\n';
        
        sortedAlgos.forEach(function(algo, idx) {
            var r = benchmarkResults[algo];
            var rank = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : (idx + 1);
            text += '| ' + rank + ' | ' + algoDescriptions[algo].title + ' | ' + r.avgSurvivalTime + 's | ' + r.avgScore + ' | ' + r.avgGhostsEaten + ' | ' + r.avgDecisionTime + 'ms |\n';
        });
        
        text += '\n### Raw Data\n\n';
        
        benchmarkAlgos.forEach(function(algo) {
            var r = benchmarkResults[algo];
            text += '**' + algoDescriptions[algo].title + '**\n';
            r.runs.forEach(function(run, idx) {
                text += '- Run ' + (idx + 1) + ': ' + run.survivalTime.toFixed(1) + 's, Score: ' + run.score + ', Ghosts: ' + run.ghostsEaten + '\n';
            });
            text += '\n';
        });
        
        navigator.clipboard.writeText(text).then(function() {
            var btn = document.getElementById('modal-copy-btn');
            btn.textContent = '✓ Copied!';
            btn.style.background = '#003300';
            btn.style.borderColor = '#00FF00';
            setTimeout(function() {
                btn.textContent = '📋 Copy as Markdown';
                btn.style.background = '#001133';
                btn.style.borderColor = '#00FFDE';
            }, 2000);
        });
    }
    
    function incrementGhostsEaten() {
        if (benchmarkMode) {
            benchmarkGhostsEaten++;
        }
    }
    
    function setState(nState) {
        state = nState;
        stateChanged = true;
    }
    
    function collided(user, ghost) {
        return (Math.sqrt(Math.pow(ghost.x - user.x, 2) + Math.pow(ghost.y - user.y, 2))) < 10;
    }
    
    function drawFooter() {
        var topLeft = (map.height * map.blockSize),
            textBase = topLeft + 17;
        
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, topLeft, (map.width * map.blockSize), 30);
        
        ctx.fillStyle = "#FFFF00";
        for (var i = 0, len = user.getLives(); i < len; i++) {
            ctx.fillStyle = "#FFFF00";
            ctx.beginPath();
            ctx.moveTo(150 + (25 * i) + map.blockSize / 2, (topLeft + 1) + map.blockSize / 2);
            ctx.arc(150 + (25 * i) + map.blockSize / 2, (topLeft + 1) + map.blockSize / 2,
                    map.blockSize / 2, Math.PI * 0.25, Math.PI * 1.75, false);
            ctx.fill();
        }
        
        ctx.fillStyle = "#FFFF00";
        ctx.font = "10px 'Press Start 2P'";
        ctx.fillText("Score: " + user.theScore(), 10, textBase);
        ctx.fillText("Lvl: " + level, 280, textBase);
    }
    
    function redrawBlock(pos) {
        map.drawBlock(Math.floor(pos.y / 10), Math.floor(pos.x / 10), ctx);
        map.drawBlock(Math.ceil(pos.y / 10), Math.ceil(pos.x / 10), ctx);
    }
    
    // AI decision making
    function makeAIDecisions() {
        aiTickCounter++;
        
        var pacmanPos = user.getPosition();
        var pacmanDir = user.getDirection();
        
        // Make decisions more frequently, or immediately if stopped
        if (pacmanDir !== NONE && aiTickCounter % 3 !== 0) return;
        var ghostPositions = ghosts.map(function(g) { return g.getPosition(); });
        
        // Observe ghost moves for adaptive learning
        if (lastGhostPositions.length === 4) {
            for (var i = 0; i < ghosts.length; i++) {
                var oldPos = lastGhostPositions[i];
                var newPos = ghostPositions[i];
                var dx = Math.round((newPos.x - oldPos.x) / 10);
                var dy = Math.round((newPos.y - oldPos.y) / 10);
                
                var move = NONE;
                if (dx > 0) move = RIGHT;
                else if (dx < 0) move = LEFT;
                else if (dy > 0) move = DOWN;
                else if (dy < 0) move = UP;
                
                if (move !== NONE) {
                    PacmanAI.recordGhostMove(i, oldPos, pacmanPos, move);
                }
            }
        }
        lastGhostPositions = ghostPositions.map(function(p) { return {x: p.x, y: p.y}; });
        
        // Build ghost states array with vulnerability info
        var ghostStates = ghosts.map(function(g) {
            return {
                isEdible: g.isVunerable(),
                isDangerous: g.isDangerous()
            };
        });
        
        // Pac-Man AI
        var pacmanMove = NONE;
        
        switch(pacmanAI) {
            case 'greedy':
                pacmanMove = PacmanAI.PacmanControllers.greedy(map, pacmanPos, lastPacmanMove);
                break;
            case 'random':
                pacmanMove = PacmanAI.PacmanControllers.random(map, pacmanPos, lastPacmanMove);
                break;
            case 'astar':
                pacmanMove = PacmanAI.PacmanControllers.astar(map, pacmanPos, ghostPositions, ghostStates, lastPacmanMove);
                break;
            case 'minimax':
                pacmanMove = PacmanAI.PacmanControllers.minimax(map, pacmanPos, ghostPositions, ghostStates, minimaxDepth, lastPacmanMove);
                break;
            case 'adaptive':
                pacmanMove = PacmanAI.PacmanControllers.adaptive(map, pacmanPos, ghostPositions, ghostStates, minimaxDepth, lastPacmanMove);
                break;
        }
        
        if (pacmanMove !== NONE) {
            user.setDue(pacmanMove);
            lastPacmanMove = pacmanMove;
        }
        
        // Ghost AI
        for (var i = 0; i < ghosts.length; i++) {
            var ghost = ghosts[i];
            if (ghost.isVunerable() || !ghost.isDangerous()) continue;
            
            var ghostMove = NONE;
            
            switch(ghostAI) {
                case 'classic':
                    ghostMove = PacmanAI.GhostControllers.classic(map, ghost, pacmanPos, pacmanDir, ghosts);
                    break;
                case 'random':
                    ghostMove = PacmanAI.GhostControllers.random(map, ghost);
                    break;
                case 'astar':
                    ghostMove = PacmanAI.GhostControllers.astar(map, ghost, pacmanPos);
                    break;
                case 'minimax':
                    ghostMove = PacmanAI.GhostControllers.minimax(map, ghost, pacmanPos, ghostPositions, ghostStates, 3);
                    break;
            }
            
            if (ghostMove !== NONE) {
                ghost.setDue(ghostMove);
            }
        }
        
        // Update stats display
        updateStatsDisplay();
    }
    
    function updateStatsDisplay() {
        var stats = PacmanAI.getStats();
        document.getElementById('nodes-eval').textContent = stats.nodesEvaluated;
        document.getElementById('decision-time').textContent = 
            stats.avgDecisionTime.toFixed(2);
        
        // Show confidence and observations for adaptive mode
        if (pacmanAI === 'adaptive') {
            var modelStats = PacmanAI.getGhostModelStats();
            var confidenceEl = document.getElementById('ghost-confidence');
            var obsEl = document.getElementById('ghost-observations');
            
            if (confidenceEl) {
                confidenceEl.textContent = modelStats.confidence + '%';
            }
            if (obsEl) {
                obsEl.textContent = modelStats.totalObservations;
            }
        }
    }
    
    function updateAlgoDescription() {
        var descEl = document.getElementById('algo-description');
        var info = algoDescriptions[pacmanAI] || algoDescriptions['greedy'];
        
        var depthNote = '';
        if (pacmanAI === 'minimax' || pacmanAI === 'adaptive') {
            depthNote = '<br><br><em style="color:#00FFDE;">Lookahead: 6 moves</em>';
        }
        
        descEl.innerHTML = 
            '<span style="color:#888;font-size:0.8em;">' + info.paradigm + '</span>' +
            '<h4 style="margin-top:4px;">' + info.title + '</h4><p>' + info.desc + depthNote + '</p>';
        
        // Update confidence row visibility immediately
        var confidenceEl = document.getElementById('ghost-confidence');
        var obsEl = document.getElementById('ghost-observations');
        var obsRow = document.getElementById('observations-row');
        var resetBtn = document.getElementById('reset-learning');
        
        if (pacmanAI === 'adaptive') {
            var modelStats = PacmanAI.getGhostModelStats();
            if (confidenceEl) {
                confidenceEl.parentElement.style.display = 'flex';
                confidenceEl.textContent = modelStats.confidence + '%';
            }
            if (obsEl && obsRow) {
                obsRow.style.display = 'flex';
                obsEl.textContent = modelStats.totalObservations;
            }
            if (resetBtn) {
                resetBtn.style.display = 'block';
            }
        } else {
            if (confidenceEl) {
                confidenceEl.parentElement.style.display = 'none';
            }
            if (obsRow) {
                obsRow.style.display = 'none';
            }
            if (resetBtn) {
                resetBtn.style.display = 'none';
            }
        }
    }
    
    function mainDraw() {
        var diff, u, i, len, nScore;
        
        // Make AI decisions
        makeAIDecisions();
        
        ghostPos = [];
        for (i = 0, len = ghosts.length; i < len; i += 1) {
            ghostPos.push(ghosts[i].move(ctx));
        }
        u = user.move(ctx);
        
        for (i = 0, len = ghosts.length; i < len; i += 1) {
            redrawBlock(ghostPos[i].old);
        }
        redrawBlock(u.old);
        
        for (i = 0, len = ghosts.length; i < len; i += 1) {
            ghosts[i].draw(ctx);
        }
        user.draw(ctx);
        
        userPos = u["new"];
        
        for (i = 0, len = ghosts.length; i < len; i += 1) {
            if (collided(userPos, ghostPos[i]["new"])) {
                if (ghosts[i].isVunerable()) {
                    audio.play("eatghost");
                    ghosts[i].eat();
                    eatenCount += 1;
                    nScore = eatenCount * 50;
                    drawScore(nScore, ghostPos[i]);
                    user.addScore(nScore);
                    incrementGhostsEaten(); // Track for benchmark
                    setState(EATEN_PAUSE);
                    timerStart = tick;
                } else if (ghosts[i].isDangerous()) {
                    audio.play("die");
                    setState(DYING);
                    timerStart = tick;
                }
            }
        }
    }
    
    function mainLoop() {
        var diff;
        
        if (state !== PAUSE) {
            ++tick;
        }
        
        map.drawPills(ctx);
        
        if (state === PLAYING) {
            mainDraw();
        } else if (state === WAITING && stateChanged) {
            stateChanged = false;
            map.draw(ctx);
            dialog("Press N to Start");
        } else if (state === EATEN_PAUSE && (tick - timerStart) > (Pacman.FPS / 3)) {
            map.draw(ctx);
            setState(PLAYING);
        } else if (state === DYING) {
            if (tick - timerStart > (Pacman.FPS * 2)) {
                loseLife();
            } else {
                redrawBlock(userPos);
                for (i = 0, len = ghosts.length; i < len; i += 1) {
                    redrawBlock(ghostPos[i].old);
                    ghostPos.push(ghosts[i].draw(ctx));
                }
                user.drawDead(ctx, (tick - timerStart) / (Pacman.FPS * 2));
            }
        } else if (state === COUNTDOWN) {
            diff = 5 + Math.floor((timerStart - tick) / Pacman.FPS);
            if (diff === 0) {
                map.draw(ctx);
                setState(PLAYING);
            } else {
                if (diff !== lastTime) {
                    lastTime = diff;
                    map.draw(ctx);
                    dialog("Starting in: " + diff);
                }
            }
        }
        
        drawFooter();
    }
    
    function eatenPill() {
        audio.play("eatpill");
        timerStart = tick;
        eatenCount = 0;
        for (var i = 0; i < ghosts.length; i += 1) {
            ghosts[i].makeEatable(ctx);
        }
    }
    
    function completedLevel() {
        setState(WAITING);
        level += 1;
        map.reset();
        user.newLevel();
        startLevel();
    }
    
    function keyPress(e) {
        if (state !== WAITING && state !== PAUSE) {
            e.preventDefault();
            e.stopPropagation();
        }
    }
    
    function init(wrapper, root) {
        var i, len, ghost,
            blockSize = wrapper.offsetWidth / 19,
            canvas = document.createElement("canvas");
        
        canvas.setAttribute("width", (blockSize * 19) + "px");
        canvas.setAttribute("height", (blockSize * 22) + 30 + "px");
        
        wrapper.appendChild(canvas);
        
        ctx = canvas.getContext('2d');
        
        audio = new Pacman.Audio({"soundDisabled": soundDisabled});
        map = new Pacman.Map(blockSize);
        user = new Pacman.User({
            "completedLevel": completedLevel,
            "eatenPill": eatenPill
        }, map);
        
        for (i = 0, len = ghostSpecs.length; i < len; i += 1) {
            ghost = new Pacman.Ghost({"getTick": getTick}, map, ghostSpecs[i], i);
            ghosts.push(ghost);
        }
        
        map.draw(ctx);
        dialog("Loading ...");
        
        // Setup AI selectors
        document.getElementById('pacman-ai').addEventListener('change', function(e) {
            pacmanAI = e.target.value;
            PacmanAI.resetStats();
            
            // Show/hide depth selector for minimax and adaptive
            var depthSelector = document.getElementById('depth-selector');
            updateAlgoDescription();
        });
        
        document.getElementById('reset-learning').addEventListener('click', function() {
            if (confirm('Reset learned ghost patterns? This will clear all observations.')) {
                PacmanAI.resetGhostModel();
                updateAlgoDescription();
            }
        });
        
        document.getElementById('benchmark-btn').addEventListener('click', function() {
            if (benchmarkMode) {
                cancelBenchmark();
            } else {
                startBenchmark();
            }
        });
        
        // Action buttons
        var newGameBtn = document.getElementById('new-game-btn');
        var pauseBtn = document.getElementById('pause-btn');
        var soundBtn = document.getElementById('sound-btn');
        
        if (newGameBtn) {
            newGameBtn.addEventListener('click', function() {
                console.log('[Button] New Game clicked');
                startNewGame();
            });
        }
        
        if (pauseBtn) {
            pauseBtn.addEventListener('click', function() {
                console.log('[Button] Pause clicked, state:', state);
                if (state === PAUSE) {
                    audio.resume();
                    map.draw(ctx);
                    setState(stored);
                    this.textContent = '⏸ Pause';
                } else if (state === PLAYING || state === COUNTDOWN) {
                    stored = state;
                    setState(PAUSE);
                    audio.pause();
                    map.draw(ctx);
                    dialog("PAUSED");
                    this.textContent = '▶ Resume';
                }
            });
        }
        
        if (soundBtn) {
            soundBtn.addEventListener('click', function() {
                console.log('[Button] Sound clicked');
                audio.disableSound();
                localStorage["soundDisabled"] = !soundDisabled();
                this.textContent = soundDisabled() ? '🔇' : '🔊';
            });
            // Initialize sound button state
            soundBtn.textContent = soundDisabled() ? '🔇' : '🔊';
        }
        
        updateAlgoDescription();
        
        var extension = Modernizr.audio.ogg ? 'ogg' : 'mp3';
        var audio_files = [
            ["start", root + "audio/opening_song." + extension],
            ["die", root + "audio/die." + extension],
            ["eatghost", root + "audio/eatghost." + extension],
            ["eatpill", root + "audio/eatpill." + extension],
            ["eating", root + "audio/eating.short." + extension],
            ["eating2", root + "audio/eating.short." + extension]
        ];
        
        load(audio_files, function() { loaded(); });
    }
    
    function load(arr, callback) {
        if (arr.length === 0) {
            callback();
        } else {
            var x = arr.pop();
            audio.load(x[0], x[1], function() { load(arr, callback); });
        }
    }
    
    function loaded() {
        // No message needed - New button has pulse animation
        
        document.addEventListener("keydown", keyDown, true);
        document.addEventListener("keypress", keyPress, true);
        
        timer = window.setInterval(mainLoop, 1000 / Pacman.FPS);
    }
    
    return {
        "init": init,
        "getTick": getTick,
        "redraw": function() { if (map && ctx) map.draw(ctx); },
        "newGame": startNewGame,
        "togglePause": function() {
            if (state === PAUSE) {
                audio.resume();
                map.draw(ctx);
                setState(stored);
                return false; // not paused
            } else if (state === PLAYING || state === COUNTDOWN) {
                stored = state;
                setState(PAUSE);
                audio.pause();
                map.draw(ctx);
                dialog("PAUSED");
                return true; // paused
            }
            return null; // no change
        },
        "toggleSound": function() {
            audio.disableSound();
            localStorage["soundDisabled"] = !soundDisabled();
            return soundDisabled();
        },
        "soundDisabled": soundDisabled
    };
}());

// Initialize game when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('[Init] DOMContentLoaded fired');
    console.log('[Init] Modernizr.canvas:', Modernizr.canvas);
    console.log('[Init] Modernizr.localstorage:', Modernizr.localstorage);
    console.log('[Init] Modernizr.audio:', Modernizr.audio);
    console.log('[Init] Modernizr.audio.ogg:', Modernizr.audio.ogg);
    console.log('[Init] Modernizr.audio.mp3:', Modernizr.audio.mp3);
    
    var el = document.getElementById("pacman");
    
    if (Modernizr.canvas && Modernizr.localstorage && 
        Modernizr.audio && (Modernizr.audio.ogg || Modernizr.audio.mp3)) {
        console.log('[Init] Modernizr checks passed, calling GAME.init');
        window.setTimeout(function () { 
            GAME.init(el, "https://raw.githubusercontent.com/daleharvey/pacman/master/"); 
        }, 0);
    } else {
        console.log('[Init] Modernizr checks FAILED');
        el.innerHTML = "Sorry, needs a modern browser<br /><small>" +
            "(Firefox 3.6+, Chrome 4+, Opera 10+ and Safari 4+)</small>";
    }
});
