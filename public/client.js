"use strict"
//Game objects
var playerPresets = {angle:270, fuel:100, junk:0, health:100 ,keyState:{}, ping:0};
var player = playerPresets;
var players = []; // other players
var asteroids = [];
var resources = [];
var canvas = $("#game-canvas")[0];
var canvasSize = {height:0, width:0}
var ctx = canvas.getContext("2d");
var keyState = {};
var socket;
var frameDelay = 25;
var lastMovedTime = Date.now();
var name = 'Bob';

// Load images
var spaceshipStationary = new Image();
var spaceshipLeft = new Image();
var spaceshipRight = new Image();
var spaceshipForward = new Image();
var asteroidImage = new Image;
var asteroidHalfExpImage = new Image;
var asteroidExpImage = new Image;
var resourceImage = new Image;
var shieldImage = new Image;
var healthImage = new Image;
var fuelImage = new Image;
var junkImage = new Image;
var blueBarImage = new Image;
var pinkBarImage = new Image;
var spawnImage = new Image;
var lastCollisionTime = 0;
spaceshipStationary.src = 'images/FirstSpace_NoFlame.png';
spaceshipLeft.src = 'images/FirstSpace_RightFlame.png';
spaceshipRight.src = 'images/FirstSpace_LeftFlame.png';
spaceshipForward.src = 'images/FirstSpace.png';
var spaceship = [spaceshipStationary,spaceshipLeft,spaceshipRight,spaceshipForward]; // useful format
asteroidImage.src = 'images/Asteroid.png';
asteroidHalfExpImage.src = 'images/AsteroidHalfExplode.png';
asteroidExpImage.src = 'images/AsteroidExplode.png';
var asteroid = [asteroidImage,asteroidHalfExpImage,asteroidExpImage];
resourceImage.src = 'images/Resource.png';
shieldImage.src = 'images/ShieldIcon.png';
healthImage.src = 'images/HealthIcon.png';
fuelImage.src = 'images/FuelIcon.png';
junkImage.src = 'images/JunkIcon.png';
blueBarImage.src = 'images/BlueBar.png';
pinkBarImage.src = 'images/PinkBar.png';
spawnImage.src = 'images/spawn.png';

//Load sound effects
var audioEngineStart = new Audio('sound/engine_start.mp3');
var audioEngineStop = new Audio('sound/engine_stop.mp3');
var audioEngineOn = new Audio('sound/engine_on.mp3');

//Utilities
var usedKeys = [37, 38, 39, 40];
var KEY_CODES = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40
}
var TO_RADIANS = Math.PI/180; 

window.addEventListener('keydown',function(e){
	if (usedKeys.indexOf(e.which) != -1 && !keyState[e.which]) {
		keyState[e.which] = true;
		socket.emit('keyupdate', keyState);
		lastMovedTime = Date.now();
	}
},true);
window.addEventListener('keyup',function(e){
	if (usedKeys.indexOf(e.which) != -1 && keyState[e.which]) {
		keyState[e.which] = false;
		socket.emit('keyupdate', keyState);
		lastMovedTime = Date.now();
	}
},true);
window.addEventListener("resize", function(){
	updateCanvasSize();
},true);
window.addEventListener("blur", function(){
	keyState = {}
});

$(function() {
	registerSocketHooks();
	updateCanvasSize();
	loadOverlay(false);
	
	//Start timed canvas updates for UI
	setInterval(updateCanvas, frameDelay);
});

function start() {
	name = $("#start-popup-name")[0].value;
	socket.emit('start', name);
	socket.on('validation response', function(response){
		if (response.answer == true) {
			$('#start-popup').popup('hide');
		} else {
			$('#game-popup-response').html(response.message);
		}
    });
}

function loadOverlay(died) {
	$('#game-popup-response').html("");
	if (died){
		$('#game-popup-response').html("You died!");
	}
	player = playerPresets;
	$('#start-popup').removeClass('hidden');
	$('#start-popup').popup({
		transition: 'all 0.3s',
		autoopen: true,
		escape: false,
		blur: false
	});
}

function updateCanvasSize() {
	canvas.height = $(window).height();
	canvas.width = $(window).width();
	canvasSize.height = canvas.height;
	canvasSize.width = canvas.width;
	
	socket.emit('canvassize',canvasSize);
}

function registerSocketHooks() {
	//socket.emit('name', object);
	//socket.on('name', function to handle object);
	
	//Join player to game
	socket = io();
	
	//Hooks for websocket
	socket.on('player', function(p) {
		player = p;
	})
	socket.on('players', function(p) {
		players = p;
	})
	socket.on('gamedata', function(obj) {
		players = obj.players;
		asteroids = obj.asteroids;
		resources = obj.resources;
	})
	socket.on('ping', function(p){
      socket.emit('ping response',p);
    });
}

function getLocalCoords(x, y) {
	// Return coordinates for the user's canvas based when
	// given global coordinates.
	return {
		x:canvas.width/2 - (player.x-x),
		y:canvas.height/2 - (player.y-y)
	};
}

function movePlayer(p) {
	var p = player;
	var delta = (Date.now()-lastMovedTime)/1000.0;
	if (Date.now() - lastCollisionTime > 500) {
	    if (p.keyState[KEY_CODES.LEFT]) {
			playSoundEffect(p);
			p.state = 1;
			p.angle = (p.angle - p.rotationSpeed*delta) % 360;
			if (p.angle < 0) p.angle += 360;
	    } else if (p.keyState[KEY_CODES.RIGHT]) {
			playSoundEffect(p);
			p.state = 2;
			p.angle = (p.angle + p.rotationSpeed*delta) % 360;
			if (p.angle < 0) p.angle += 360;
	    } else if (p.keyState[KEY_CODES.UP]) {
			//console.log(p.state);
			playSoundEffect(p);
			p.state = 3;
			p.x += p.forwardSpeed*delta*Math.cos(TO_RADIANS*p.angle);
			p.y += p.forwardSpeed*delta*Math.sin(TO_RADIANS*p.angle);
	    } else {
			stopSoundEffects();
			p.state = 0;
		}
	    lastMovedTime = Date.now();
	}
}

function checkCollisions() {
	var p = player;
	for (var i = 0; i < asteroids.length; i++) {
      var a = asteroids[i];
      var xDiff = p.x - a.x;
      var yDiff = p.y - a.y;
      var collDist = (a.width/2)*0.85 + (p.width/2)*0.85;
      if (a.health > 0 && xDiff*xDiff + yDiff*yDiff < collDist*collDist) {
        // Collision has occurred!
        a.health -= 100;
        p.lastCollisionTime = Date.now()
        if (p.shield >= 20) p.shield -= 20;
        else if (p.shield == 0) p.health -= 20;
        else {
          p.health -= (20-p.shield);
          p.shield = 0;
        }
      }
    }
}

function playSoundEffect(p) {
	if (p.state == 0) {
		if (audioEngineOn.paused) {
			audioEngineStart.play();
		}
	} else {
		if (audioEngineStart.paused) {
			audioEngineOn.play();
		}
	}
}

function stopSoundEffects() {
	audioEngineStart.pause();
	audioEngineOn.pause();
}

function drawObjects() {
	//Draw spawn
	var coords = getLocalCoords(0, 0);
	ctx.drawImage(spawnImage, coords.x-341, coords.y-247, 683, 593);
	
	//Draw resources and asteroids
	for (var i = 0; i < resources.length; i++) {
		var coords = getLocalCoords(resources[i].x, resources[i].y);
		ctx.drawImage(resourceImage, coords.x-16, coords.y-16, 32, 32);
	}
	for (var i = 0; i < asteroids.length; i++) {
		var coords = getLocalCoords(asteroids[i].x, asteroids[i].y);
		if (asteroids[i].timeOfDeath == null) {
			ctx.drawImage(asteroid[0], coords.x-(asteroids[i].width/2), coords.y-(asteroids[i].height/2), asteroids[i].width, asteroids[i].height);
		}else {
			ctx.drawImage(asteroid[1+Math.min(1,Math.floor(asteroids[i].timeSinceDeath/250))], coords.x-(asteroids[i].width/2), coords.y-(asteroids[i].height/2), asteroids[i].width, asteroids[i].height);
		}
	}
}

function drawPlayers() {
	//Draw others spaceships
	for (var i = 0; i < players.length; i++) {
		if (player.id != players[i].id) {
			var coords = getLocalCoords(players[i].x, players[i].y);
			ctx.save();
			ctx.translate(coords.x,coords.y);
			ctx.rotate((players[i].angle+90)*TO_RADIANS);
			ctx.drawImage(spaceship[players[i].state], -32, -32, 64, 64);
			ctx.restore();
		}
	}
	
	//Draw our spaceship
    ctx.save();
    ctx.translate(canvas.width/2,canvas.height/2);
    ctx.rotate((player.angle+90)*TO_RADIANS);
	ctx.drawImage(spaceship[player.state], -32, -32, 64, 64);
    ctx.restore();
}

function updateCanvas() {
	//Clear canvas
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	
	movePlayer();
	checkCollisions();
	drawObjects();
	drawPlayers();
	drawUI();

	if (player.health <= 0) loadOverlay(true);
}

function drawUI() {
	//Display ping, health and sheilds (temporary).
	ctx.fillStyle="#fff";
	ctx.font="12px Arial";
	var pingText = "Ping: " + player.ping;
    ctx.fillText(pingText, 20, 30);
	
	//Display shield
	var shieldHeightOffset = 190;
	var shieldBars = Math.floor(player.shield/20);
	var shieldExcess = player.health % 20;
	ctx.drawImage(shieldImage, 20, canvas.height-shieldHeightOffset);
	for (var i = 1; i <= shieldBars; i++) {
		if (i % 2 == 0) {
			ctx.drawImage(blueBarImage, 110 + (i*20), canvas.height-shieldHeightOffset);
		} else {
			ctx.drawImage(pinkBarImage, 110 + (i*20), canvas.height-shieldHeightOffset);
		}
	}
	if (shieldExcess != 0) {
		if (shieldBars % 2 == 1) {
			ctx.drawImage(blueBarImage, 0, 0, 16*(shieldExcess/20), 32, 110 + ((shieldBars+1)*20), canvas.height-shieldHeightOffset, 16*(shieldExcess/20), 32);
		} else {
			ctx.drawImage(pinkBarImage, 0, 0, 16*(shieldExcess/20), 32, 110 + ((shieldBars+1)*20), canvas.height-shieldHeightOffset, 16*(shieldExcess/20), 32);
		}
	}
	
	//Display health
	var healthHeightOffset = 140;
	var healthBars = Math.floor(player.health/20);
	var healthExcess = player.health % 20;
	ctx.drawImage(healthImage, 20, canvas.height-healthHeightOffset);
	for (var i = 1; i <= healthBars; i++) {
		if (i % 2 == 0) {
			ctx.drawImage(blueBarImage, 110 + (i*20), canvas.height-healthHeightOffset);
		} else {
			ctx.drawImage(pinkBarImage, 110 + (i*20), canvas.height-healthHeightOffset);
		}
	}
	if (healthExcess != 0) {
		if (healthBars % 2 == 1) {
			ctx.drawImage(blueBarImage, 0, 0, 16*(healthExcess/20), 32, 110 + ((healthBars+1)*20), canvas.height-healthHeightOffset, 16*(healthExcess/20), 32);
		} else {
			ctx.drawImage(pinkBarImage, 0, 0, 16*(healthExcess/20), 32, 110 + ((healthBars+1)*20), canvas.height-healthHeightOffset, 16*(healthExcess/20), 32);
		}
	}
	
	//Display fuel
	var fuelHeightOffset = 90;
	var fuelBars = Math.floor(player.fuel/20);
	var fuelExcess = player.fuel % 20;
	ctx.drawImage(fuelImage, 20, canvas.height-fuelHeightOffset);
	for (var i = 1; i <= fuelBars; i++) {
		if (i % 2 == 0) {
			ctx.drawImage(blueBarImage, 110 + (i*20), canvas.height-fuelHeightOffset);
		} else {
			ctx.drawImage(pinkBarImage, 110 + (i*20), canvas.height-fuelHeightOffset);
		}
	}
	if (fuelExcess != 0) {
		if (fuelBars % 2 == 1) {
			ctx.drawImage(blueBarImage, 0, 0, 16*(fuelExcess/20), 32, 110 + ((fuelBars+1)*20), canvas.height-fuelHeightOffset, 16*(fuelExcess/20), 32);
		} else {
			ctx.drawImage(pinkBarImage, 0, 0, 16*(fuelExcess/20), 32, 110 + ((fuelBars+1)*20), canvas.height-fuelHeightOffset, 16*(fuelExcess/20), 32);
		}
	}
	
	//Display cargo
	var junkHeightOffset = 50;
	ctx.drawImage(junkImage, 20, canvas.height-junkHeightOffset);
	for (var i = 1; i <= player.junk; i++) {
		if (i % 2 == 0) {
			ctx.drawImage(blueBarImage, 110 + (i*20), canvas.height-junkHeightOffset);
		} else {
			ctx.drawImage(pinkBarImage, 110 + (i*20), canvas.height-junkHeightOffset);
		}
	}
}