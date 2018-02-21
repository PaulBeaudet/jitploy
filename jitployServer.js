// jitployServer.js ~ Copyright 2017 Paul Beaudet ~ MIT License
// Relays github webhook information to clients
// Libraries
var crypto     = require('crypto');      // native cryptography library for nodejs
var mongodb    = require('mongodb');     // schemaless database
var bodyparser = require('body-parser'); // middleware to parse JSON bodies
var express    = require('express');     // server framework library
var socketio   = require('socket.io');    // compatibility layar for websockets

var RELAY_DB = 'jitployRelay';

var mongo = {
    db: {},                                            // object that contains connected databases
    connect: function(url, dbName){                    // url to db and what well call this db in case we want multiple
        mongodb.MongoClient().connect(url, mongo.bestCase(function onConnect(db){
            mongo.db[dbName] = db;
        }));
    },
    bestCase: function(mongoSuccessCallback, noResultCallback){          // awful abstraction layer to be lazy
        return function handleWorstCaseThings(error, wantedThing){       // this is basically the same pattern for every mongo query callback
            if(error){
                console.log('well guess we failed to plan for this: ' + error);
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

var socket = {                                             // socket.io singleton: handles socket server logic
    listen: function(server){                              // create server and setup on connection events
        socket.io = socketio(server);                      // specify http server to make connections w/ to get socket.io object
        socket.io.on('connection', function(client){       // client holds socket vars and methods for each connection event
            client.on('authenticate', socket.sub(client)); // Subscribe to deploy events for private (w/ token) or open repository
        }); // basically we want to authorize our users before setting up event handlers for them or adding them to emit whitelist
    },
    sub: function(client){
        return function(repo){
            if(repo && repo.hasOwnProperty('token')){      // token should be 0 in cases of public repos
                var query = {token: repo.token};
                var deployChannel = "";
                if(repo.hasOwnProperty('name')){
                    query.name = repo.name;
                    deployChannel = repo.name;
                } else if(repo.hasOwnProperty('url')){
                    query.url = repo.url;
                    deployChannel = repo.url;
                } else {socket.invalidClient(client, repo, 'Malformed request')();}

                mongo.db[RELAY_DB].collection('clients').findOne(query, function onDoc(error, validClient){
                    if(validClient){client.join(deployChannel);}
                    else {socket.invalidClient(client, repo, error)();}
                });
            } else {socket.invalidClient(client, repo)();}
        }
    },
    invalidClient(client, authPacket, error){
        return function(){
            if(!error){error = '';}
            console.log(error + ' Invalid connection attempt: ' + JSON.stringify(authPacket, null, 4));
            socket.io.to(client.id).emit('rejected');
        }
    },
    deploy: function(repoName){
        socket.io.to(repoName).emit('deploy'); // Emit deploy signal to everyone subscribed to this repo
    }
};

var github = {
    verifyHook: function(signature, payload, secret){
        var computedSignature = 'sha1=' + crypto.createHmac("sha1", secret).update(JSON.stringify(payload)).digest("hex");
        return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(computedSignature, 'utf8'));
    },
    listenEvent: function(responseURI){                           // create route handler for test or prod
        return function(req, res){                                // route handler
            if(req.body){
                res.status(200).send('OK');res.end();             // ACK notification
                var findQuery = {fullRepoName: req.body.repository.full_name.toLowerCase()};
                mongo.db[RELAY_DB].collection('github_secrets').findOne(findQuery, mongo.bestCase(function onFind(doc){
                    if(github.verifyHook(req.headers['x-hub-signature'], req.body, doc.secret)){
                        console.log(JSON.stringify(req.body.repository, null, 4));
                        socket.deploy(req.body.repository.name);  // to look up git hub secret check if valid request and signal deploy
                    } else {console.log('secret no good');}
                }));
                console.log('Just got a post from ' + req.body.repository.full_name);   // see what we get
            }
        };
    }
};

var serve = {                                                // handles express server setup
    theSite: function (){                                    // methode call to serve site
        var app = express();                                 // create famework object
        var http = require('http').Server(app);              // http server for express framework
        app.use(bodyparser.json());                          // support JSON bodies
        var router = express.Router();                       // create express router object to add routing events to
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
