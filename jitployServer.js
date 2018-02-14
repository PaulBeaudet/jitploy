// jitployServer.js ~ Copyright 2017 Paul Beaudet ~ MIT License
// Relays github webhook information to clients
var RELAY_DB = 'jitployRelay';
var CD_HOURS_START = 16; // 5  pm UTC / 12 EST  // Defines hours when deployments can happen
var CD_HOURS_END   = 4;  //1  11 pm UTC /  6 EST  // TODO get this thing on your own server to remove this non-sense
var ONE_HOUR = 3600000;
var ONE_DAY = 86400000;
var DOWNTIME = ONE_HOUR * 12; // hours of downtime

var service = { // logic for adding a removing service integrations
    s: [], // array where we store properties and functions of connected sevices
    disconnect: function(socketId){                                                          // hold socketId information in closure
        return function socketDisconnect(){
            service.do(socketId, function removeservice(index){
                console.log(service.s[index].name + ' was disconnected');
                service.s.splice(index, 1);
            });// given its there remove service from services array
        };
    },
    do: function(socketId, foundCallback){                     // executes a callback with one of our services based on socket id
        var serviceNumber = service.s.map(function(eachservice){
            return eachservice.socketId;
        }).indexOf(socketId);                                  // figure index service in our services array
        if(serviceNumber > -1){foundCallback(serviceNumber);}  // NOTE we remove services keeping ids in closure would be inaccurate
    },
    doByName: function(name, foundCallback){                   // executes a callback with one of our services based on socket id
        var serviceNumber = service.s.map(function(eachservice){
            return eachservice.name;
        }).indexOf(name);                                      // figure index service in our services array
        if(serviceNumber > -1){foundCallback(serviceNumber);}  // NOTE we remove services keeping ids in closure would be inaccurate
    }
};

var mongo = {
    client: require('mongodb').MongoClient,
    db: {},                                            // object that contains connected databases
    connect: function(url, dbName){                    // url to db and what well call this db in case we want multiple
        mongo.client.connect(url, mongo.bestCase(function onConnect(db){
            mongo.db[dbName] = db;
        }));
    },
    bestCase: function(mongoSuccessCallback, noResultCallback){          // awful abstraction layer to be lazy
        return function handleWorstCaseThings(error, wantedThing){       // this is basically the same pattern for every mongo query callback
            if(error){
                mongo.log('well guess we failed to plan for this: ' + error);
            } else if (wantedThing){
                mongoSuccessCallback(wantedThing);
            } else if (noResultCallback){
                noResultCallback();
            }
        };
    },
    log: function(msg){                                // persistent logs
        var timestamp = new Date();
        mongo.db[RELAY_DB].collection('logs').insertOne({
                msg: msg,
                timestamp: timestamp.toDateString()
            }, function onInsert(error){
            if(error){
                console.log('Mongo Log error: ' + error);
                console.log(msg);
            }
        });
    }
};

var socket = {                                                         // socket.io singleton: handles socket server logic
    io: require('socket.io'),                                          // grab socket.io library
    listen: function(server){                                          // create server and setup on connection events
        socket.io = socket.io(server);                                 // specify http server to make connections w/ to get socket.io object
        socket.io.on('connection', function(client){                   // client holds socket vars and methods for each connection event
            client.on('authenticate', socket.setup(client));           // initially clients can only ask to authenticate
            ohBother.whenIsBreakTime();                                // Server attempt to be lazy telling clients to buzz off
        }); // basically we want to authorize our users before setting up event handlers for them or adding them to emit whitelist
    },
    setup: function(client){
        return function(authPacket){
            if(authPacket && authPacket.hasOwnProperty('name') && authPacket.hasOwnProperty('token')){ // lets be sure we got something valid from client
                mongo.db[RELAY_DB].collection('clients').findOne({name: authPacket.name, token: authPacket.token}, mongo.bestCase(function onFind(doc){
                    authPacket.socketId = client.id;
                    console.log(authPacket.name + ' was connected');
                    service.s.push(authPacket);                            // hold on to what clients are connected to us
                    client.on('disconnect', service.disconnect(client.id));// remove service from service array on disconnect
                }, function onNoResult(){
                    mongo.log('client not found: ' + JSON.stringify(authPacket, null, 4));
                    socket.badClient(client);
                }));
            } else {
                mongo.log('invalid client data: ' + authPacket);
                socket.io.to(client.id).emit('break', {time: 0});
                client.on('disconnect', function(){mongo.log('Rejected socket disconnected: ' + client.id);});
            }
        };
    },
    deploy: function(repository){
        console.log('looking for ' + repository);
        service.doByName(repository, function deployIt(index){
            console.log('Signal deploy for ' + repository);
            socket.io.to(service.s[index].socketId).emit('deploy');
        });
    }
};

var ohBother = {     // determines when to tell clients to buzz off so server can sleep
    sleeping: true,  // makes sure only one time about to ask for a break is called
    whenIsBreakTime: function(){
        var duration = ohBother.toOffHours(CD_HOURS_START, CD_HOURS_END);
        console.log('durration to break ' + duration);
        if(ohBother.sleeping){setTimeout(ohBother.askForBreak, duration);} // oh bother you woke me up
        ohBother.sleeping = false; // any time this is called server has been woken
    },
    askForBreak: function(){
        socket.io.emit('break', {time: DOWNTIME}); // ask clients to buzz of for x amount of time once a day
        ohBother.sleeping = true;
    },
    toOffHours: function(hourStart, hourEnd){
        var currentDate = new Date();
        var currentHour = currentDate.getHours();
        var currentMillis = currentDate.getTime();
        if(hourStart < hourEnd){
            if(currentHour < hourStart || currentHour >= hourEnd){return 0;} // if was supposed to be sleeping, stays up a half hour once woke
            return currentDate.setHours(hourEnd, 0, 0, 0) - currentMillis; // return millis before on time is up
        } else {
            if(currentHour <= hourEnd){} // if was supposed to be sleeping, stays up a half hour once woke
            else if (currentHour < hourStart){return 0;}
            return currentDate.setHours(23 + hourEnd, 0, 0, 0) - currentMillis; // return millis before on time is up
        }
    }
};

var github = {
    crypto: require('crypto'),
    querystring: require('querystring'),
    verifyHook: function(signature, payload, secret){
        var computedSignature = 'sha1=' + github.crypto.createHmac("sha1", secret).update(JSON.stringify(payload)).digest("hex");
        return github.crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(computedSignature, 'utf8'));
    },
    listenEvent: function(responseURI){                           // create route handler for test or prod
        return function(req, res){                                // route handler
            if(req.body){
                res.status(200).send('OK');res.end();             // ACK notification
                var findQuery = {fullRepoName: req.body.repository.full_name.toLowerCase()};
                mongo.db[RELAY_DB].collection('github_secrets').findOne(findQuery, mongo.bestCase(function onFind(doc){
                    console.log('verifing secret');
                    if(github.verifyHook(req.headers['x-hub-signature'], req.body, doc.secret)){
                        socket.deploy(req.body.repository.name);  // to look up git hub secret check if valid request and signal deploy
                    } else {console.log('secret no good');}
                }));
                console.log('Just got a post from ' + req.body.repository.full_name);   // see what we get
            }
        };
    }
};

var serve = {                                                // handles express server setup
    express: require('express'),                             // server framework library
    parse: require('body-parser'),                           // middleware to parse JSON bodies
    theSite: function (){                                    // methode call to serve site
        var app = serve.express();                           // create famework object
        var http = require('http').Server(app);              // http server for express framework
        app.use(serve.parse.json());                         // support JSON bodies
        var router = serve.express.Router();                 // create express router object to add routing events to
        router.get('/', function(req, res){res.send('running');}); // for automated things to know we are heathy
        router.post('/deploy', github.listenEvent());        // real listener post route
        app.use(router);                                     // get express to user the routes we set
        return http;
    }
};

mongo.connect(process.env.MONGODB_URI, RELAY_DB);            // connect to jitploy relay database
var http = serve.theSite();                                  // set express middleware and routes up
socket.listen(http);                                         // listen and handle socket connections
http.listen(process.env.PORT);                               // listen on specified PORT enviornment variable

var pkgjson = require('./package.json');
console.log('Starting ' + pkgjson.name + ' version ' + pkgjson.version); // show version of package when restarted
