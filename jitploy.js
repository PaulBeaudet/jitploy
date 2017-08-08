// jitploy.js ~ Copyright 2017 Paul Beaudet ~ MIT License
// Relays github webhook information to clients
var RELAY_DB = 'jitployRelay';

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

var socket = {                                                         // socket.io singleton: handles socket server logic
    io: require('socket.io'),                                          // grab socket.io library
    tokens: process.env.TOKENS ? process.env.TOKENS.split(', ') : [],  // comma deliminated string of valid tokens
    trusted_names: process.env.TRUSTED_NAMES ? process.env.TRUSTED_NAMES.split(', ') : [], // comma deliminated string of allowed names
    listen: function(server){                                          // create server and setup on connection events
        socket.io = socket.io(server);                                 // specify http server to make connections w/ to get socket.io object
        socket.io.on('connection', function(client){                   // client holds socket vars and methods for each connection event
            client.on('authenticate', socket.setup(client));           // initially clients can only ask to authenticate
        }); // basically we want to authorize our users before setting up event handlers for them or adding them to emit whitelist
    },
    setup: function(client){                                           // hold socketObj/key in closure, return callback to authorize user
        return function(authPacket){                                   // data passed from service {token:"valid token", name:"of service"}
            if(socket.auth(authPacket)){                               // make sure we are connected w/ trusted source and name
                authPacket.socketId = client.id;
                console.log(authPacket.name + ' was connected');
                service.s.push(authPacket);                            // hold on to what clients are connected to us
                client.on('disconnect', service.disconnect(client.id));// remove service from service array on disconnect
            } else {                                                   // in case token was wrong or name not provided
                console.log('client tried to connect' + JSON.stringify(authPacket, null, 4));
                client.on('disconnect', function(){
                    mongo.log('Rejected socket disconnected: ' + client.id);
                });
            }
        };
    },
    auth: function(authPacket){
        for(var i = 0; i < socket.tokens.length; i++){ // parse though array of tokens, there is a name for every token
            if(authPacket.token === socket.tokens[i] && authPacket.name === socket.trusted_names[i]){return true;}
        }
        return false;                                  // if we don't find something this client is no
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
    bestCase: function(mongoSuccessCallback){          // awful abstraction layer to be lazy
        return function handleWorstCaseThings(error, wantedThing){
            if(error){
                mongo.log('well guess we failed to plan for this: ' + error);
            } else if (wantedThing){
                mongoSuccessCallback(wantedThing);
            }
        }
    },
    log: function(msg){                                // persistent logs
        mongo.db[RELAY_DB].collection('logs').insertOne({msg: msg}, function onInsert(error){
            if(error){
                console.log('Mongo Log error: ' + error);
                console.log(msg);
            }
        });
    }
}

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
                mongo.db[RELAY_DB].collection('github_secrets').find(findQuery, mongo.bestCase(function onFind(doc){
                    console.log
                    if(github.verifyHook(req.headers['x-hub-signature'], req.body, doc.secret)){
                        signal.deploy(req.body.repository.name);  // to look up git hub secret check if valid request and signal deploy
                    }
                }));
                console.log('Just got a post from ' + req.body.repository.full_name);   // see what we get
            }
        };
    }
};

var signal = {
    deploy: function(repository){
        service.doByName(repository, function deployIt(index){
            socket.io.to(service.s[index].socketId).emit('deploy');
        });
    }
};

var serve = {                                                // depends on cookie, routes, handles express server setup
    express: require('express'),                             // server framework library
    parse: require('body-parser'),                           // middleware to parse JSON bodies
    theSite: function (){                                    // methode call to serve site
        var app = serve.express();                           // create famework object
        var http = require('http').Server(app);              // http server for express frameworkauth)
        app.use(serve.parse.json());                         // support JSON bodies
        // app.use(serve.express.static(__dirname + '/views')); // serve page dependancies (socket, jquery, bootstrap)
        var router = serve.express.Router();                 // create express router object to add routing events to
        router.post('/pullrequest', github.listenEvent());   // real listener post route
        app.use(router);                                     // get express to user the routes we set
        return http;
    }
};

mongo.connect(process.env.MONGODB_URI, RELAY_DB);            // connect to jitploy relay database
var http = serve.theSite();                                  // set express middleware and routes up
socket.listen(http);                                         // listen and handle socket connections
http.listen(process.env.PORT);                               // listen on specified PORT enviornment variable
