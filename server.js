"use strict"

var app = require('express')();
var http = require('http').Server(app);
var path = require('path');
var io = require('socket.io')(http);
var url = require('url');
var fs = require('fs');
var Player = require('./Player.js').Player;
var Asteroid = require('./Asteroid.js').Asteroid;
var Resource = require('./Resource.js').Resource;
var Missile = require('./Missile.js').Missile;
var sitePrefix = './public';
var site = fs.realpathSync('.') + path.sep + 'public';
var OK = 200, Redirect = 307, NotFound = 404, BadType = 415, Error = 500;

function fail(response, code) {
  response.writeHead(code);
  response.end();
}

app.get('/', function(req, res) {
  res.sendFile('public/index.html', {root:'.'});
});

app.get(/^(.+)$/, function(req, res) {
  var filename = url.parse(req.url).pathname;
  if (!inSite(sitePrefix+filename)) return fail(res, NotFound);
  res.sendFile(sitePrefix+filename, {root:'.'});
});

function starts(s,prefix) {
  return s.indexOf(prefix) == 0;
}

function inSite(file) {
  var real;
  try {
    real = fs.realpathSync(file);
  }
  catch (err) {
    console.log("WARNING: Trying to access a file not in the site: "+file);
    console.log(err.message);
    return false;
  }
  return starts(real,site);
}

// GAME CODE STARTS HERE //

var spectators = [];
var players = [];
var asteroids = [];
var resources = [];
var missiles = [];
var scores = [];
//var numAsteroids = 1000;
var healthLimit = 100;
var shieldLimit = 200;
var numResources = 200;
var asteroidBelts = [
  [ 500,1000 ,0.00002,0.00001,1],
  [1000,1100 ,0.0004 ,0.     ,1], /* Dense belt */
  [1100,2000 ,0.00006,0.00004,1],
  [2000,2100 ,0.0004 ,0      ,1], /* Dense belt */
  [2100,3000 ,0.00008,0.00004,1],
  [3000,3100 ,0.0004 ,0      ,1], /* Dense belt */
  [3100,4950 ,0.00001,0.00004,1],
  [4950,5000 ,0.0004 ,0      ,1] /* Dense belt */
];
var baseRadius = 300;
var baseShieldRadius = 400
var junkPrice = 20;
var gridSize = 200;
var idCounter = 0;
var frameDelay = 40;
var missileSpeed = 100;
var fireRates = [0,1,2,3];
var fuelCapacities = [60,120,240,480];
var junkCapacities = [5,10,20,40];
//var weaponDamage = [0,20,40,60]
var STARTER_SHIP = 0;
var KEY_CODES = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  SPACE: 32
};
var TO_RADIANS = Math.PI/180; 
var mapCurrXLimits = [-10000,10000];
var mapCurrYLimits = [-10000,10000];

var asteroidClass = {
  id: 0,
  ind: 1,
  x: 2,
  y: 3,
  health: 4,
  angle: 5,
  width: 6,
  height: 7,
  timeOfDeath: 8,
  timeSinceDeath: 9,
  lastMoveTime: 10,
  type: 11,
  imageNum: 12
};

//Prices
var fuelPrice = 20;
var healPrice = 20;
var shieldPrice = 50;
var holdPrice = 100;
var weaponPrice = 100;
var enginePrice = 100;

//Grid variables
var numNegXGrids = -Math.min(Math.floor(mapCurrXLimits[0]/gridSize),0);
var numNegYGrids = -Math.min(Math.floor(mapCurrYLimits[0]/gridSize),0);
var lastXGridIndex = Math.ceil((mapCurrXLimits[1]-mapCurrXLimits[0])/gridSize);
var lastYGridIndex = Math.ceil((mapCurrYLimits[1]-mapCurrYLimits[0])/gridSize);

io.on('connection', function(socket) {
  var spectator = new Player(socket.id,'spectator');
  spectators.push(spectator);
  if (spectators.length + players.length == 1) console.log('A user connected. There is now 1 user.');
  else console.log('A user connected. There are now '+(spectators.length + players.length).toString()+' users.');
  var player;

  socket.on('start', function(name) {
    if (typeof(name) == 'string') {
      if (name == '') {
        socket.emit('validation response',{answer:false,message:'You must have a name.'});
      } else if (name.length > 10) {
        socket.emit('validation response',{answer:false,message:'Max name length is 10 character.'});
      } else {
        var nameTaken = false;
        for (var i = 0; i < players.length; i++) {
          if (players[i].name == name) {
            nameTaken = true;
            break;
          }
        }
        if (nameTaken) {
          socket.emit('validation response',{answer:false,message:'That name is already taken.'});  
        } else {
          socket.emit('validation response',{answer:true});
          spectator = null
          spectators.splice(spectators.indexOf(spectator),1);
          player = new Player(socket.id,name);
          players.push(player);
          socket.emit('player',player);
          socket.emit('ping','');
          player.pingStart = Date.now();
          if (players.length == 1) console.log('Player added. There is now 1 player.');
          else console.log('Player added. There are now '+(players.length).toString()+' players.');
        }
      }
    }
  }); 
  socket.on('keyupdate', function(keyState) {
    if (typeof(player) != 'undefined') {
      player.keyState = keyState;
      player.lastMovedTime = Date.now();
    }
  });
  socket.on('disconnect', function() {
    if (typeof(player) != 'undefined') {
      players.splice(players.indexOf(player), 1);
      var ind = gridPlayers[player.gridX][player.gridY].indexOf(player);
      gridPlayers[player.gridX][player.gridY].splice(ind,1);
      if (spectators.length + players.length == 1) console.log('A user disconnected. There is now 1 user.');
      else console.log('A user disconnected. There are now '+(spectators.length + players.length).toString()+' users.');
    } else if (spectator != null) {
      spectator = null;
      spectators.splice(spectators.indexOf(spectator),1);
      if (spectators.length + players.length == 1) console.log('A user disconnected. There is now 1 user.');
      else console.log('A user disconnected. There are now '+(spectators.length + players.length).toString()+' users.');
    } 
  });
  socket.on('ping response', function(data) {
    if (typeof(player) != 'undefined') {
      player.ping = Date.now() - player.pingStart;
      setTimeout(function(){socket.emit('ping',''); player.pingStart = Date.now();},2000);
    }
  });
  socket.on('canvassize', function(canvasSize) {
    if (typeof(player) != 'undefined') {
      player.canvasSize = canvasSize;
    }
  });
  socket.on('refillfuel', function(response){
    var playerIsNearShop = (player.x*player.x + player.y*player.y < baseShieldRadius*baseShieldRadius)
    if (player.starterShip) var fuelCapacity = fuelCapacities[STARTER_SHIP];
    else var fuelCapacity = fuelCapacities[player.holdLevel+1];
    if (player.cash >= fuelPrice && player.fuel < fuelCapacity && playerIsNearShop) {
      player.fuel = Math.min(player.fuel+20,fuelCapacity);
      player.cash -= 20;
      socket.emit('refillfuel',true);
    } else {
      socket.emit('refillfuel',false);
    }
  });
  socket.on('refillhealth', function(response){
    var playerIsNearShop = (player.x*player.x + player.y*player.y < baseShieldRadius*baseShieldRadius)
    if (player.cash >= healPrice && player.health < healthLimit && playerIsNearShop) {
      player.health = Math.min(player.health+20,healthLimit);
      player.cash -= 20;
      socket.emit('refillhealth',true);
    } else {
      socket.emit('refillhealth',false);
    }
  });
  socket.on('upgradeshield', function(data){
    var playerIsNearShop = (player.x*player.x + player.y*player.y < baseShieldRadius*baseShieldRadius)
    if (player.cash >= shieldPrice && playerIsNearShop && player.shield < shieldLimit ) {
      player.shield = Math.min(player.shield+20,shieldLimit);
      player.cash -= 50;
      socket.emit('upgradeshield',true);
    } else {
      socket.emit('upgradeshield',false);
    }
  });
  socket.on('upgradeship', function(response){
    var playerIsNearShop = (player.x*player.x + player.y*player.y < baseShieldRadius*baseShieldRadius)
    if (player.starterShip && player.cash >= holdPrice && playerIsNearShop) {
      player.starterShip = false;
      player.junkCapacity += 20;
      player.fuelCapacity += 20;
      player.cash -= 100;
      socket.emit('upgradeship',true);
    } else {
      socket.emit('upgradeship',false);
    }
  });
  socket.on('upgradehold', function(response){
    var playerIsNearShop = (player.x*player.x + player.y*player.y < baseShieldRadius*baseShieldRadius)
    if (!player.starterShip && player.cash >= holdPrice && player.holdLevel < 2 && playerIsNearShop) {
      player.holdLevel += 1;
      player.cash -= 100;
      socket.emit('upgradehold',true);
    } else {
      socket.emit('upgradehold',false);
    }
  });
  socket.on('upgradeweapon', function(response){
    var playerIsNearShop = (player.x*player.x + player.y*player.y < baseShieldRadius*baseShieldRadius)
    if (!player.starterShip && player.cash >= weaponPrice && player.weaponLevel < 2 && playerIsNearShop) {
      player.weaponLevel += 1;
      player.cash -= 100;
      socket.emit('upgradeweapon',true);
    } else {
      socket.emit('upgradeweapon',false);
    }
  });
  socket.on('upgradeengine', function(response){
    var playerIsNearShop = (player.x*player.x + player.y*player.y < baseShieldRadius*baseShieldRadius)
    if (!player.starterShip && player.cash >= enginePrice && player.engineLevel < 2 && playerIsNearShop) {
      player.engineLevel += 1;
      player.accelerationX += 20;
      player.accelerationY += 20;
      player.cash -= 100;
      socket.emit('upgradeengine',true);
    } else {
      socket.emit('upgradeengine',false);
    }
  });
});

genAsteroidsAndResources();

var gridAsteroids = sortObjectsIntoGrids(asteroids);
var gridResources = sortObjectsIntoGrids(resources);
var gridPlayers = sortObjectsIntoGrids(players);
var gridMissiles = sortObjectsIntoGrids(missiles);
var deadObjects = {
  asteroids: [],
  resources: [],
  missiles: []
};

http.listen(3000, function(){
  console.log('listening on *:3000');
});

var loop = setInterval(gameLoop,frameDelay);

function genID() {
  return idCounter++;
}

function genAsteroidsAndResources() {
  for (var i = 0; i < asteroidBelts.length; i++) {
    var b = asteroidBelts[i];
    if (b[4]) {
      var width = b[1]-b[0];
      var area = Math.PI*(b[1]*b[1] - b[0]*b[0]);
      var numAsteroids = area*b[2];
      var numResources = area*b[3];
      for (var j = 0; j < numAsteroids; j++) {
        var r = Math.random()*(b[1]-b[0])+b[0];
        var angle = Math.random()*360;
        asteroids.push(new Asteroid(genID(),r*Math.cos(angle),r*Math.sin(angle),Math.random()*360,Math.floor(Math.random()*3)));
      }
      for (var j = 0; j < numResources; j++) {
        var r = Math.random()*(b[1]-b[0])+b[0];
        var angle = Math.random()*360;
        resources.push(new Resource(genID(),r*Math.cos(angle),r*Math.sin(angle),'s'));
      }
    }
  }
}

function isNearPlayers(x,y,dist) {
  for (var i = 0; i < players.length; i++) {
    var xDiff = (x-players[i].x);
    var yDiff = (y-players[i].y);
    if (xDiff*xDiff + yDiff*yDiff < dist*dist) return true;
  }
  return false
}

function genPositionAwayFromPlayers(minRad,maxRad) {
  var r = Math.random()*(maxRad-minRad)+minRad;
  var angle = Math.random()*360;
  var x = r*Math.cos(angle);
  var y = r*Math.sin(angle);
  var nearPlayer = false;
  var dist = 1000;
  var i = 0;
  while (isNearPlayers(x,y,dist)) {
    r = Math.random()*(maxRad-minRad)+minRad;
    angle = Math.random()*360;
    x = r*Math.cos(angle);
    y = r*Math.sin(angle);
    i++;
    if (i % 5 == 0) dist *= 0.75;
  }
  return {x:x,y:y};
}

function genAsteroid(updatedObjects,minRad,maxRad) {
  var pos = genPositionAwayFromPlayers(minRad,maxRad);
  var asteroid = new Asteroid(genID(),pos.x,pos.y,Math.random()*360,Math.floor(Math.random()*3));
  asteroids.push(asteroid);
  updatedObjects.asteroidIDs.push(asteroid.id);
  sortObjectIntoGrids(asteroid, gridAsteroids);
}

function genResource(updatedObjects,minRad,maxRad) {
  var pos = genPositionAwayFromPlayers(minRad,maxRad);
  var resource = new Resource(genID(),pos.x,pos.y,'s');
  resources.push(resource);
  updatedObjects.resourceIDs.push(resource.id);
  sortObjectIntoGrids(resource, gridResources);
}

function movePlayers() {
  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    var delta = (Date.now()-p.lastMovedTime)/1000.0;
    if (Date.now() - p.lastCollisionTime > 500) {
      if (p.keyState[KEY_CODES.LEFT]) {
        p.fuel -= delta;
        p.state = 1;
        p.angle = (p.angle - p.rotationSpeed*delta) % 360;
        if (p.angle < 0) p.angle += 360;
      } else if (p.keyState[KEY_CODES.RIGHT]) {
        p.fuel -= delta;
        p.state = 2;
        p.angle = (p.angle + p.rotationSpeed*delta) % 360;
        if (p.angle < 0) p.angle += 360;
      } else if (p.keyState[KEY_CODES.UP]) {
        p.fuel -= delta;
        p.state = 3;
        p.x += p.forwardSpeed*delta*Math.cos(TO_RADIANS*p.angle);
        p.y += p.forwardSpeed*delta*Math.sin(TO_RADIANS*p.angle);
      } else {
        p.state = 0;
      }
      p.lastMovedTime = Date.now();
    }
  }
}

function acceleratePlayers() {
  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    var delta = (Date.now()-p.lastMovedTime)/1000.0;
    if (p.keyState[KEY_CODES.LEFT]) {
      if (p.fuel >= delta) {
        p.fuel -= delta;
        p.state = 1;
        p.angle = (p.angle - p.rotationSpeed*delta) % 360;
        if (p.angle < 0) p.angle += 360;
      }
    } else if (p.keyState[KEY_CODES.RIGHT]) {
      if (p.fuel >= delta) {
        p.fuel -= delta;
        p.state = 2;
        p.angle = (p.angle + p.rotationSpeed*delta) % 360;
        if (p.angle < 0) p.angle += 360;
      }
    } else if (p.keyState[KEY_CODES.UP]) {
      if (p.fuel >= delta) {
        p.speedX += p.accelerationX * delta * Math.cos(TO_RADIANS * p.angle);
        p.speedY += p.accelerationY * delta * Math.sin(TO_RADIANS * p.angle);
        p.fuel -= delta;
        p.state = 3;
      }
    } else {
      p.state = 0;
    }
    p.x += p.speedX * delta;
    p.y += p.speedY * delta;
    var newGridX = Math.floor(p.x/gridSize)+numNegXGrids;
    var newGridY = Math.floor(p.y/gridSize)+numNegYGrids;
    if (newGridX != p.gridX || newGridY != p.gridY) {
      var ind = gridPlayers[p.gridX][p.gridY].indexOf(p);
      gridPlayers[p.gridX][p.gridY].splice(ind,1);
      p.gridX = newGridX;
      p.gridY = newGridY;
      gridPlayers[p.gridX][p.gridY].push(p);
    }

    p.lastMovedTime = Date.now();
    if (p.x - p.canvasSize.width/2 - 100 < mapCurrXLimits[0]) {
      mapCurrXLimits[0] = p.x - p.canvasSize.width/2 - 100;
      updateGrids();
    }
    if (p.x + p.canvasSize.width/2 + 100 > mapCurrXLimits[1]) {
      mapCurrXLimits[1] = p.x + p.canvasSize.width/2 + 100;
      updateGrids();
    }
    if (p.y - p.canvasSize.height/2 - 100 < mapCurrYLimits[0]) {
      mapCurrYLimits[0] = p.y - p.canvasSize.height/2 - 100;
      updateGrids();
    }
    if (p.y + p.canvasSize.height/2 + 100 > mapCurrYLimits[1]) {
      mapCurrYLimits[1] = p.y + p.canvasSize.height/2 + 100;
      updateGrids();
    }
  }
}

function updateGrids() {
  numNegXGrids = -Math.min(Math.floor(mapCurrXLimits[0]/gridSize),0);
  numNegYGrids = -Math.min(Math.floor(mapCurrYLimits[0]/gridSize),0);
  lastXGridIndex = Math.ceil((mapCurrXLimits[1]-mapCurrXLimits[0])/gridSize);
  lastYGridIndex = Math.ceil((mapCurrYLimits[1]-mapCurrYLimits[0])/gridSize);
  gridAsteroids = sortObjectsIntoGrids(asteroids);
  gridResources = sortObjectsIntoGrids(resources);
  gridPlayers = sortObjectsIntoGrids(players);
  gridMissiles = sortObjectsIntoGrids(missiles);
}

function moveMissiles() {
  for (var i = 0; i < missiles.length; i++) {
    var m = missiles[i];
    if (m.health > 0) {
      var delta = (Date.now()-m.lastMovedTime)/1000.0;
      m.x += missileSpeed*delta*Math.cos(TO_RADIANS*m.angle);
      m.y += missileSpeed*delta*Math.sin(TO_RADIANS*m.angle);
      m.lastMovedTime = Date.now();

      if (m.x < mapCurrXLimits[0] || m.x > mapCurrXLimits[1] ||
          m.y < mapCurrYLimits[0] || m.y > mapCurrYLimits[1]) {
        var ind = gridMissiles[m.gridX][m.gridY].indexOf(m);
        gridMissiles[m.gridX][m.gridY].splice(ind,1);
        missiles.splice(i,1);
        i--;
        continue;
      } else if (m.x * m.x + m.y * m.y < baseShieldRadius*baseShieldRadius) {
        m.health = 0;
        m.displayExplosion = true;
        deadObjects.missiles.push(m);
      }
      var newGridX = Math.floor(m.x/gridSize)+numNegXGrids;
      var newGridY = Math.floor(m.y/gridSize)+numNegYGrids;
      if (newGridX != m.gridX || newGridY != m.gridY) {
        var ind = gridMissiles[m.gridX][m.gridY].indexOf(m);
        gridMissiles[m.gridX][m.gridY].splice(ind,1);
        m.gridX = newGridX;
        m.gridY = newGridY;
        gridMissiles[m.gridX][m.gridY].push(m);
      }
    }
  }
}

function clearDeadObjects(updatedObjects,removedObjects) {
  clearDeadAsteroids(updatedObjects,removedObjects);
  clearDeadResources(updatedObjects,removedObjects);
  clearDeadMissiles(updatedObjects,removedObjects);
}

function clearDeadAsteroids(updatedObjects,removedObjects) {
  for (var i = 0; i < deadObjects.asteroids.length; i++) {
    var a = deadObjects.asteroids[i]
    if (a.timeOfDeath == null) {
      a.timeOfDeath = Date.now();
    }
    a.timeSinceDeath = Date.now() - a.timeOfDeath;
    if (a.timeSinceDeath >= 400 && !a.destroyed) {
      a.destroyed = true;
      var belt = findBelt(a)
      asteroids.splice(asteroids.indexOf(a),1);
      var xCoord = Math.floor(a.x/gridSize)+numNegXGrids;
      var yCoord = Math.floor(a.y/gridSize)+numNegYGrids;
      var ind = gridAsteroids[xCoord][yCoord].indexOf(a);
      gridAsteroids[xCoord][yCoord].splice(ind,1);
      removedObjects.asteroidIDs.push(a.id)
      deadObjects.asteroids.splice(deadObjects.asteroids.indexOf(a),1);
      setTimeout(
        function(){
          genAsteroid(updatedObjects,
            asteroidBelts[belt][0],
            asteroidBelts[belt][1])
        }
        ,30000)
    }
  }
}

function clearDeadResources(updatedObjects,removedObjects) {
  for (var i = 0; i < deadObjects.resources.length; i++) {
    var r = deadObjects.resources[i];
    r.destroyed = true;
    var belt = findBelt(r)
    resources.splice(resources.indexOf(r),1);
    removedObjects.resourceIDs.push(r.id);
    var xCoord = Math.floor(r.x/gridSize)+numNegXGrids;
    var yCoord = Math.floor(r.y/gridSize)+numNegYGrids;
    var ind = gridResources[xCoord][yCoord].indexOf(r);
    gridResources[xCoord][yCoord].splice(ind,1);
    deadObjects.resources.splice(deadObjects.resources.indexOf(r),1);
    setTimeout(
      function(){
        genResource(updatedObjects,
          asteroidBelts[belt][0],
          asteroidBelts[belt][1])
      }
      ,30000)
  }
}

function clearDeadMissiles(updatedObjects,removedObjects) {
  for (var i = 0; i < deadObjects.missiles.length; i++) {
    var m = deadObjects.missiles[i];
    if (m.timeOfDeath == null) {
      m.timeOfDeath = Date.now();
    }
    m.timeSinceDeath = Date.now() - m.timeOfDeath;
    if ((m.timeSinceDeath >= 400 || !m.displayExplosion) && !m.destroyed) {
      m.destroyed = true;
      missiles.splice(missiles.indexOf(m),1);
      deadObjects.missiles.splice(deadObjects.missiles.indexOf(m),1);
      var ind = gridMissiles[m.gridX][m.gridY].indexOf(m);
      gridMissiles[m.gridX][m.gridY].splice(ind,1);
    }
  }
}

function sortObjectsIntoGrids(objects) {
  var grids = [];
  for (var w = mapCurrXLimits[0]; w <= mapCurrXLimits[1]+1; w += gridSize) {
    var gridCol = [];
    for (var h = mapCurrYLimits[0]; h <= mapCurrYLimits[1]+1; h += gridSize) {
      gridCol.push([]);
    }
    grids.push(gridCol);
  }
  for (var i = 0; i < objects.length; i++) {
    var xCoord = Math.floor(objects[i].x/gridSize)+numNegXGrids;
    var yCoord = Math.floor(objects[i].y/gridSize)+numNegYGrids;
    grids[xCoord][yCoord].push(objects[i]);
  }
  return grids;
}

function sortObjectIntoGrids(object, grids) {
  var xCoord = Math.floor(object.x/gridSize)+numNegXGrids;
  var yCoord = Math.floor(object.y/gridSize)+numNegYGrids;
  grids[xCoord][yCoord].push(object);
}

function calculateGridsInSight() {
  for(var i = 0; i < players.length; i++) {
    var p = players[i];
    var startXGrid = Math.max(Math.floor((p.x-(p.canvasSize.width/2))/gridSize)
      + numNegXGrids,0);
    var endXGrid = Math.min(Math.floor((p.x+(p.canvasSize.width/2))/gridSize)
      + numNegXGrids,lastXGridIndex);
    var startYGrid = Math.max(Math.floor((p.y-(p.canvasSize.height/2))/gridSize)
      + numNegYGrids,0);
    var endYGrid = Math.min(Math.floor((p.y+(p.canvasSize.height/2))/gridSize)
      + numNegYGrids,lastYGridIndex);
    p.grids = {
      startXGrid: startXGrid,
      endXGrid: endXGrid,
      startYGrid: startYGrid, 
      endYGrid: endYGrid
    };
    p.oldGridArray = p.gridArray;
    p.gridArray = [];
    for (var x = p.grids.startXGrid; x <= p.grids.endXGrid; x++) {
      for (var y = p.grids.startYGrid; y <= p.grids.endYGrid; y++) {
        p.gridArray.push(JSON.stringify([x,y]));
      }
    }
  }
}

function checkForAllCollisions(updatedObjects) {
  for(var i = 0; i < players.length; i++) {
    var p = players[i];
    checkForCollisions(p,gridAsteroids,updatedObjects.asteroidIDs);
    checkForCollisions(p,gridResources,updatedObjects.resourceIDs);
    checkForCollisions(p,gridMissiles,[]);
  }
  asteroidMissileCollisions(updatedObjects);
}

function checkForCollisions(p,gridObjects,updatedObjectIDs) {
  var socket = io.sockets.connected[p.id];
  for (var x = p.grids.startXGrid; x <= p.grids.endXGrid; x++) {
    for (var y = p.grids.startYGrid; y <= p.grids.endYGrid; y++) {
      for (var i = 0; i < gridObjects[x][y].length; i++) {
        checkForCollision(p,gridObjects[x][y][i],socket,updatedObjectIDs);
      }
    }
  }
}

function checkForCollision(p,o,socket,updatedObjectIDs) {
  var xDiff = p.x - o.x;
  var yDiff = p.y - o.y;
  var collDist = (o.width/2)*0.85 + (p.width/2)*0.85;
  if (o.health > 0 && xDiff*xDiff + yDiff*yDiff < collDist*collDist) {
    // Collision has occurred!
    if (o.type == 's') {
      if (p.starterShip) var junkCapacity = junkCapacities[STARTER_SHIP];
      else var junkCapacity = junkCapacities[p.holdLevel+1];
      if (junkCapacity > p.junk) {
        socket.emit('junkpickup',true);
        o.health -= 20;
        p.junk += 1;
      }
      deadObjects.resources.push(o);
    } else if (o.type == 'a') {
      socket.emit('asteroidHit',true);
      o.health -= 20;
      p.lastCollisionTime = Date.now();
      if (p.shield >= 20) p.shield -= 20;
      else if (p.shield == 0) p.health -= 20;
      else {
        p.health -= (20-p.shield);
        p.shield = 0;
      }
      deadObjects.asteroids.push(o);
    } else if (o.type == 'm' && o.shooterID != p.id) {
      o.displayExplosion = true;
      o.health -= 20;
      p.lastCollisionTime = Date.now();
      if (p.shield >= 20) p.shield -= 20;
      else if (p.shield == 0) p.health -= 20;
      else {
        p.health -= (20-p.shield);
        p.shield = 0;
      }
      deadObjects.missiles.push(o);
    }
    updatedObjectIDs.push(o.id);
  }
}

function asteroidMissileCollisions(updatedObjects) {
  for (var x = 0; x < gridAsteroids.length; x++) {
    for (var y = 0; y < gridAsteroids[x].length; y++) {
      // For each grid ^^
      for (var i = 0; i < gridAsteroids[x][y].length; i++) {
        // For each asteroid in the grid ^^
        var a = gridAsteroids[x][y][i];
        for (var j = 0; j < gridMissiles[x][y].length; j++) {
          //For each missile in the grid ^^
          var m = gridMissiles[x][y][j];
          var xDiff = a.x - m.x;
          var yDiff = a.y - m.y;
          var collDist = (a.width/2) + (m.width/2);
          if (a.health > 0 && m.health > 0 && xDiff*xDiff + yDiff*yDiff < collDist*collDist) {
            a.health -= 20;
            m.health = 0;
            updatedObjects.asteroidIDs.push(a.id);
          }
          if (m.health <= 0) {
            deadObjects.missiles.push(m);
          }
        }
        if (a.health <= 0) {
          deadObjects.asteroids.push(a);
        }
      }
    }
  }
}

function calculateRequiredObjects(p) {
  var playersToSend = [];
  var missilesToSend = [];
  for (var x = p.grids.startXGrid; x <= p.grids.endXGrid; x++) {
    for (var y = p.grids.startYGrid; y <= p.grids.endYGrid; y++) {
      for (var i = 0; i < gridPlayers[x][y].length; i++) {
        var o = gridPlayers[x][y][i];
        playersToSend.push(getPlayerPropertyArray(o));
      }
      for (var i = 0; i < gridMissiles[x][y].length; i++) {
        var o = gridMissiles[x][y][i];
        missilesToSend.push(getMissilePropertyArray(o));
      }
    }
  }
  return {
    players: playersToSend,
    missiles: missilesToSend
  };
}

function calculateObjectChanges(p,updatedIDs,removedIDs,gridObjects,
    objectToArray,deadObjs) {
  var newGrids = [];
  var oldGrids = [];
  var newObjects = [];
  var oldObjects = [];
  for (var i = 0; i < p.gridArray.length; i++) {
    if (p.oldGridArray.indexOf(p.gridArray[i]) == -1) {
      newGrids.push(JSON.parse(p.gridArray[i]));
    }
  }
  for (var i = 0; i < p.oldGridArray.length; i++) {
    if (p.gridArray.indexOf(p.oldGridArray[i]) == -1) {
      oldGrids.push(JSON.parse(p.oldGridArray[i]));
    }
  }

  for (var i = 0; i < newGrids.length; i++) {
    var x = newGrids[i][0];
    var y = newGrids[i][1];
    for (var j = 0; j < gridObjects[x][y].length; j++) {
      var o = gridObjects[x][y][j];
      newObjects.push(objectToArray(o));
    }
  }

  for (var x = p.grids.startXGrid; x <= p.grids.endXGrid; x++) {
    for (var y = p.grids.startYGrid; y <= p.grids.endYGrid; y++) {
      for (var j = 0; j < gridObjects[x][y].length; j++) {
        var o = gridObjects[x][y][j];
        if (deadObjs.indexOf(o) != -1 || updatedIDs.indexOf(o.id) != -1) {
          newObjects.push(objectToArray(o));
        }
      }
    }
  }

  for (var i = 0; i < oldGrids.length; i++) {
    var x = oldGrids[i][0];
    var y = oldGrids[i][1];
    for (var j = 0; j < gridObjects[x][y].length; j++) {
      oldObjects.push(gridObjects[x][y][j].id);
    }
  }

  for (var i = 0; i < removedIDs.length; i++) {
    oldObjects.push(removedIDs[i])
  }

  return {
    new: newObjects,
    old: oldObjects
  };
}

function getPlayerPropertyArray(o) {
  return [
    o.id,
    o.x,
    o.y,
    o.width,
    Math.floor(o.angle),
    o.health,
    o.name,
    o.holdLevel,
    o.weaponLevel,
    o.engineLevel,
    o.starterShip,
    o.state
  ];
}

function getAsteroidPropertyArray(o) {
  return [
    o.id,
    Math.floor(o.x),
    Math.floor(o.y),
    o.width,
    Math.floor(o.angle),
    o.health,
    o.type,
    o.timeSinceDeath,
    o.imageNum
  ];
}

function getResourcePropertyArray(o) {
  return [
    o.id,
    Math.floor(o.x),
    Math.floor(o.y),
    o.width,
    Math.floor(o.angle),
    o.health,
    o.type
  ];
}

function getMissilePropertyArray(o) {
  return [
    o.id,
    Math.floor(o.x),
    Math.floor(o.y),
    o.width,
    Math.floor(o.angle),
    o.health,
    o.type,
    o.timeSinceDeath,
    o.imageNum,
    o.shooterID,
    o.displayExplosion
  ];
}

function sendUpdates(updatedObjects,removedObjects) {
  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    var socket = io.sockets.connected[p.id];

    var dist = Math.sqrt(p.x*p.x + p.y*p.y);
    if (dist > p.furthestDistance) p.furthestDistance = dist;
    
    // Find out what each user should be able to see
    var objsToSend = calculateRequiredObjects(p);
    objsToSend.asteroids = calculateObjectChanges(p,updatedObjects.asteroidIDs,
      removedObjects.asteroidIDs,gridAsteroids,getAsteroidPropertyArray,
      deadObjects.asteroids);
    objsToSend.resources = calculateObjectChanges(p,updatedObjects.resourceIDs,
      removedObjects.resourceIDs,gridResources,getResourcePropertyArray,
      deadObjects.resources);

    // Send updates
    if (typeof(socket) != 'undefined') {
      socket.emit('player',p);
      objsToSend.scores = scores;
      socket.emit('gamedata',objsToSend);
    } else {
      console.log('Warning: Socket undefined.')
      players.splice(i);
      var ind = gridPlayers[p.gridX][p.gridY].indexOf(p);
      gridPlayers[p.gridX][p.gridY].splice(ind,1);
      i--;
    }
  }
  for (var i = 0; i < spectators.length; i++) {
    var s = spectators[i];
    var socket = io.sockets.connected[s.id];
    var objsToSend = calculateRequiredObjects(s);
    objsToSend.asteroids = calculateObjectChanges(s,updatedObjects.asteroidIDs,
      removedObjects.asteroidIDs,gridAsteroids,getAsteroidPropertyArray,
      deadObjects.asteroids);
    objsToSend.resources = calculateObjectChanges(s,updatedObjects.resourceIDs,
      removedObjects.resourceIDs,gridResources,getResourcePropertyArray,
      deadObjects.resources);
    if (typeof(socket) != 'undefined') {
      socket.emit('gamedata',objsToSend);
    }
  }
}

function findBelt(object) {
  if (typeof(object) != 'undefined') {
    var dist = Math.sqrt(object.x*object.x + object.y*object.y);
    for (var j = 0; j < asteroidBelts.length; j++) {
      if (dist >= asteroidBelts[j][0] && dist <= asteroidBelts[j][1]) return j;
    }
  }
  return 0;
}

function checkPlayers() {
  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    if (p.health <= 0) {
      players.splice(i,1);
      var ind = gridPlayers[p.gridX][p.gridY].indexOf(p);
      gridPlayers[p.gridX][p.gridY].splice(ind,1);
      if (players.length == 1) console.log('Player died. There is now 1 player.');
      else console.log('Player died. There are now '+(players.length).toString()+' players.');
      i--;
    }
  }
}

function getScores() {
  if (players.length != 0) {
    scores = [[players[0].name,players[0].score]];
    for (var i = 1; i < players.length; i++) {
      for (var j = 0; j < scores.length + 1; j++) {
        if (j == scores.length || players[i].score > scores[j][1]) {
          scores.splice(j,0,[players[i].name,players[i].score]);
          break;
        }
      }
    }
    scores = scores.splice(0,10);
  }
}

function clearJunk() {
  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    if (p.x*p.x + p.y*p.y < baseShieldRadius*baseShieldRadius) {
      if (p.furthestDistance > p.score) {
        p.score = Math.floor(p.furthestDistance);
      }
      p.furthestDistance = 0;
      if (p.junk > 0) {
        var socket = io.sockets.connected[p.id];
        socket.emit('moneyaudio',true);
      } 
      p.cash += p.junk*junkPrice;
      p.junk = 0;
      if (!p.hitShop && p.x*p.x + p.y*p.y < baseRadius*baseRadius) {
        p.hitShop = true;
        p.keyState = {};
        p.speedX = 0;
        p.speedY = 0;
      }
    } else {
      p.hitShop = false;
    }
  }
}

function fireMissiles(updatedObjects) {
  for (var i = 0; i < players.length; i++) {
    var p = players[i];
    if (p.starterShip) var fireRate = fireRates[STARTER_SHIP];
    else var fireRate = fireRates[p.weaponLevel+1];
    if (p.keyState[KEY_CODES.SPACE] && Date.now() - p.lastFiredTime > 1000/fireRate && p.x*p.x + p.y*p.y > baseShieldRadius*baseShieldRadius) {
      //Create missile
      var socket = io.sockets.connected[p.id];
      socket.emit('newmissile',true);
      var m = new Missile(genID(),p.x+5*Math.cos(p.angle*TO_RADIANS),p.y+5*Math.sin(p.angle*TO_RADIANS),p.angle,p.id);
      missiles.push(m);
      m.gridX = Math.floor(m.x/gridSize)+numNegXGrids;
      m.gridY = Math.floor(m.y/gridSize)+numNegYGrids;
      gridMissiles[m.gridX][m.gridY].push(m);
      p.lastFiredTime = Date.now();
    }
  }
}

function gameLoop() {
  var updatedObjects = {
    asteroidIDs: [],
    resourceIDs: []
  };
  var removedObjects = {
    asteroidIDs: [],
    resourceIDs: []
  };
  fireMissiles(updatedObjects);
  clearJunk();
  checkPlayers();
  acceleratePlayers();
  moveMissiles();
  calculateGridsInSight();
  checkForAllCollisions(updatedObjects);
  clearDeadObjects(updatedObjects,removedObjects);
  getScores();
  sendUpdates(updatedObjects,removedObjects);
}
