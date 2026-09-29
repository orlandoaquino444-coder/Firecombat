const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

const PORT = process.env.PORT || 3000;


/* =====================================================
   DATOS DEL JUEGO
===================================================== */

const players = new Map();

const accounts = new Map();

const matches = new Map();

const friendRequests = new Map();

const randomQueue = [];


/* =====================================================
   ARCHIVOS
===================================================== */

app.get("/", (req,res) => {

    res.sendFile(
        path.join(__dirname,"juego.html")
    );

});

app.get("/juego.html",(req,res) => {

    res.sendFile(
        path.join(__dirname,"juego.html")
    );

});


/* =====================================================
   CREAR ID
===================================================== */

function createPlayerId(){

    let id;

    do{

        id =
            "RA-" +
            Math.floor(
                100000 +
                Math.random()*900000
            );

    }while(players.has(id));

    return id;

}


/* =====================================================
   DISTANCIA
===================================================== */

function distance(a,b){

    const dx = a.x-b.x;
    const dz = a.z-b.z;

    return Math.sqrt(
        dx*dx + dz*dz
    );

}


/* =====================================================
   REGISTRO
===================================================== */

io.on("connection",socket => {

    console.log(
        "Jugador conectado:",
        socket.id
    );


    socket.on("register",data => {

        if(!data || !data.email || !data.password){

            socket.emit(
                "registerError",
                "Completa todos los campos."
            );

            return;
        }

        const email =
            String(data.email)
            .trim()
            .toLowerCase();

        const password =
            String(data.password);

        if(password.length < 4){

            socket.emit(
                "registerError",
                "La contraseña es demasiado corta."
            );

            return;
        }


        /*
          Para esta primera versión se guardan
          las cuentas en memoria.

          Para producción deberías utilizar
          una base de datos y almacenar contraseñas
          con hash seguro.
        */

        let account =
            accounts.get(email);

        if(account){

            if(account.password !== password){

                socket.emit(
                    "registerError",
                    "Contraseña incorrecta."
                );

                return;
            }

        }else{

            account = {
                email,
                password
            };

            accounts.set(
                email,
                account
            );

        }


        const id =
            createPlayerId();

        const player = {

            id,

            email,

            socketId:socket.id,

            x:0,
            z:0,
            y:0,

            hp:15000,

            rotation:0,

            match:null

        };

        players.set(id,player);

        socket.playerId = id;

        socket.emit(
            "registered",
            {
                id
            }
        );

        console.log(
            "Jugador registrado:",
            id
        );

    });


    /* =================================================
       SOLICITUD DE AMISTAD
    ================================================= */

    socket.on("friendRequest",data => {

        const sender =
            players.get(socket.playerId);

        if(!sender){

            socket.emit(
                "errorMessage",
                "Primero debes iniciar sesión."
            );

            return;
        }

        const target =
            players.get(
                String(data.target)
                .toUpperCase()
            );

        if(!target){

            socket.emit(
                "friendStatus",
                "Ese jugador no está conectado."
            );

            return;
        }

        if(target.id === sender.id){

            socket.emit(
                "friendStatus",
                "No puedes agregarte a ti mismo."
            );

            return;
        }

        friendRequests.set(
            target.id,
            sender.id
        );

        io.to(target.socketId).emit(
            "friendRequest",
            {
                from:sender.id
            }
        );

        socket.emit(
            "friendStatus",
            "Solicitud enviada."
        );

    });


    /* =================================================
       RESPUESTA AMISTAD
    ================================================= */

    socket.on("friendResponse",data => {

        const receiver =
            players.get(socket.playerId);

        const sender =
            players.get(data.from);

        if(!receiver || !sender)
            return;

        if(data.accepted){

            io.to(sender.socketId)
                .emit(
                    "friendStatus",
                    receiver.id +
                    " aceptó tu solicitud."
                );

            io.to(receiver.socketId)
                .emit(
                    "friendStatus",
                    "Amigo agregado: " +
                    sender.id
                );

            /*
              Al aceptar se crea automáticamente
              la partida entre ambos.
            */

            createOnlineMatch(
                sender,
                receiver
            );

        }else{

            io.to(sender.socketId)
                .emit(
                    "friendStatus",
                    receiver.id +
                    " rechazó la solicitud."
                );

        }

    });


    /* =================================================
       PARTIDA ALEATORIA
    ================================================= */

    socket.on("findRandomMatch",() => {

        const player =
            players.get(socket.playerId);

        if(!player)
            return;

        if(player.match){

            socket.emit(
                "errorMessage",
                "Ya estás en una partida."
            );

            return;
        }

        /*
          Evitar duplicados.
        */

        const index =
            randomQueue.indexOf(player);

        if(index !== -1)
            randomQueue.splice(index,1);


        /*
          Buscar otro jugador.
        */

        let opponent = null;

        for(const candidate of randomQueue){

            if(candidate.id !== player.id &&
               !candidate.match){

                opponent = candidate;
                break;
            }

        }


        if(opponent){

            const i =
                randomQueue.indexOf(opponent);

            if(i !== -1)
                randomQueue.splice(i,1);

            createOnlineMatch(
                player,
                opponent
            );

        }else{

            randomQueue.push(player);

            socket.emit(
                "friendStatus",
                "Buscando otro jugador..."
            );

        }

    });


    /* =================================================
       PARTIDA CONTRA BOT
    ================================================= */

    socket.on("startBot",() => {

        const player =
            players.get(socket.playerId);

        if(!player)
            return;

        if(player.match){

            socket.emit(
                "errorMessage",
                "Ya estás en una partida."
            );

            return;
        }

        const matchId =
            "BOT-" + player.id;

        matches.set(
            matchId,
            {
                id:matchId,
                players:[
                    player.id,
                    "BOT"
                ],
                bot:true
            }
        );

        player.match = matchId;

        player.x = -3;
        player.z = 0;
        player.hp = 15000;

        socket.emit(
            "botMatch",
            {
                id:matchId
            }
        );

    });


    /* =================================================
       MOVIMIENTO
    ================================================= */

    socket.on("move",data => {

        const player =
            players.get(socket.playerId);

        if(!player)
            return;

        if(!player.match)
            return;

        /*
          Límites de arena.
        */

        player.x =
            Math.max(
                -7,
                Math.min(
                    7,
                    Number(data.x) || 0
                )
            );

        player.z =
            Math.max(
                -7,
                Math.min(
                    7,
                    Number(data.z) || 0
                )
            );

        player.y =
            Math.max(
                0,
                Math.min(
                    2,
                    Number(data.y) || 0
                )
            );

        player.rotation =
            Number(data.rotation) || 0;

    });


    /* =================================================
       DISPARO
    ================================================= */

    socket.on("shoot",data => {

        const player =
            players.get(socket.playerId);

        if(!player || !player.match)
            return;

        const match =
            matches.get(player.match);

        if(!match)
            return;


        let opponentId;

        if(match.bot){

            opponentId = "BOT";

        }else{

            opponentId =
                match.players.find(
                    id => id !== player.id
                );

        }


        if(!opponentId)
            return;


        let opponent;

        if(opponentId === "BOT"){

            opponent = {
                id:"BOT",
                x:3,
                z:0,
                hp:15000
            };

        }else{

            opponent =
                players.get(opponentId);

        }

        if(!opponent)
            return;


        const d =
            distance(
                player,
                opponent
            );


        /*
          Ataque de 2 metros.
        */

        if(d <= 2){

            applyDamage(
                match,
                player.id,
                opponentId,
                1000
            );

        }

    });


    /* =================================================
       HABILIDAD
    ================================================= */

    socket.on("skill",data => {

        const player =
            players.get(socket.playerId);

        if(!player || !player.match)
            return;

        const match =
            matches.get(player.match);

        if(!match)
            return;


        let opponentId;

        if(match.bot){

            opponentId = "BOT";

        }else{

            opponentId =
                match.players.find(
                    id => id !== player.id
                );

        }


        if(!opponentId)
            return;


        let opponent;

        if(opponentId === "BOT"){

            opponent = {
                id:"BOT",
                x:3,
                z:0,
                hp:15000
            };

        }else{

            opponent =
                players.get(opponentId);

        }

        if(!opponent)
            return;


        const d =
            distance(
                player,
                opponent
            );


        /*
          13 proyectiles.
          Cada uno hace 3000.
        */

        if(d <= 6){

            for(let i=0;i<13;i++){

                setTimeout(() => {

                    applyDamage(
                        match,
                        player.id,
                        opponentId,
                        3000
                    );

                },i*100);

            }

        }

    });


    /* =================================================
       HABILIDAD ESPECIAL
    ================================================= */

    socket.on("special",data => {

        const player =
            players.get(socket.playerId);

        if(!player)
            return;

        if(data.code !== "733054")
            return;

        player.hp = 15000;

        io.to(player.socketId)
            .emit(
                "state",
                getMatchState(player.match)
            );

    });


    /* =================================================
       SALIR
    ================================================= */

    socket.on("leaveMatch",() => {

        leaveMatch(socket);

    });


    /* =================================================
       DESCONECTAR
    ================================================= */

    socket.on("disconnect",() => {

        console.log(
            "Jugador desconectado:",
            socket.playerId
        );

        leaveMatch(socket);

        if(socket.playerId){

            players.delete(
                socket.playerId
            );

        }

    });

});


/* =====================================================
   CREAR PARTIDA ONLINE
===================================================== */

function createOnlineMatch(a,b){

    if(a.match || b.match)
        return;

    const matchId =
        "MATCH-" +
        Math.random()
        .toString(36)
        .slice(2,10)
        .toUpperCase();

    const match = {

        id:matchId,

        players:[
            a.id,
            b.id
        ],

        bot:false

    };

    matches.set(
        matchId,
        match
    );

    a.match = matchId;
    b.match = matchId;

    a.x = -3;
    a.z = 0;
    a.y = 0;
    a.hp = 15000;

    b.x = 3;
    b.z = 0;
    b.y = 0;
    b.hp = 15000;


    const aSocket =
        io.sockets.sockets.get(
            a.socketId
        );

    const bSocket =
        io.sockets.sockets.get(
            b.socketId
        );


    if(aSocket){

        aSocket.emit(
            "matchFound",
            {
                matchId,

                me:{
                    id:a.id,
                    x:a.x,
                    z:a.z
                },

                enemy:{
                    id:b.id,
                    x:b.x,
                    z:b.z
                }

            }
        );

    }


    if(bSocket){

        bSocket.emit(
            "matchFound",
            {
                matchId,

                me:{
                    id:b.id,
                    x:b.x,
                    z:b.z
                },

                enemy:{
                    id:a.id,
                    x:a.x,
                    z:a.z
                }

            }
        );

    }

}


/* =====================================================
   DAÑO
===================================================== */

function applyDamage(
    match,
    attackerId,
    targetId,
    amount
){

    let target;

    if(targetId === "BOT"){

        /*
          En esta versión el bot tiene
          su propio HP dentro del match.
        */

        if(!match.botHp)
            match.botHp = 15000;

        match.botHp =
            Math.max(
                0,
                match.botHp - amount
            );

        const attacker =
            players.get(attackerId);

        if(attacker){

            const socket =
                io.sockets.sockets.get(
                    attacker.socketId
                );

            if(socket){

                socket.emit(
                    "damage",
                    {
                        target:"BOT",
                        amount
                    }
                );

            }

        }

        if(match.botHp <= 0){

            const attacker =
                players.get(attackerId);

            if(attacker){

                io.to(attacker.socketId)
                    .emit(
                        "gameOver",
                        {
                            winner:attacker.id
                        }
                    );

            }

            endMatch(match);

        }

        return;

    }


    target =
        players.get(targetId);

    if(!target)
        return;


    target.hp =
        Math.max(
            0,
            target.hp - amount
        );


    const targetSocket =
        io.sockets.sockets.get(
            target.socketId
        );

    if(targetSocket){

        targetSocket.emit(
            "damage",
            {
                target:target.id,
                amount
            }
        );

    }


    if(target.hp <= 0){

        const winner =
            players.get(attackerId);

        if(winner){

            io.to(winner.socketId)
                .emit(
                    "gameOver",
                    {
                        winner:winner.id
                    }
                );

        }

        if(targetSocket){

            targetSocket.emit(
                "gameOver",
                {
                    winner:attackerId
                }
            );

        }

        endMatch(match);

    }

}


/* =====================================================
   ESTADO
===================================================== */

function getMatchState(matchId){

    const match =
        matches.get(matchId);

    if(!match)
        return null;

    const result = {
        players:{}
    };


    for(const id of match.players){

        if(id === "BOT"){

            result.players.BOT = {

                x:3,
                z:0,
                y:0,
                hp:match.botHp ?? 15000,
                rotation:Math.PI

            };

            continue;

        }


        const p =
            players.get(id);

        if(!p)
            continue;

        result.players[id] = {

            x:p.x,
            z:p.z,
            y:p.y,
            hp:p.hp,
            rotation:p.rotation

        };

    }

    return result;

}


/* =====================================================
   ACTUALIZACIÓN DEL ESTADO
===================================================== */

setInterval(() => {

    for(const [matchId,match]
         of matches){

        const state =
            getMatchState(matchId);

        if(!state)
            continue;


        for(const id of match.players){

            if(id === "BOT")
                continue;

            const p =
                players.get(id);

            if(!p)
                continue;

            const socket =
                io.sockets.sockets.get(
                    p.socketId
                );

            if(socket){

                socket.emit(
                    "state",
                    state
                );

            }

        }

    }

},50);


/* =====================================================
   BOT
===================================================== */

setInterval(() => {

    for(const [matchId,match]
         of matches){

        if(!match.bot)
            continue;

        const player =
            players.get(
                match.players[0]
            );

        if(!player)
            continue;

        /*
          Posición del bot.
        */

        if(!match.botX)
            match.botX = 3;

        if(!match.botZ)
            match.botZ = 0;


        const dx =
            player.x - match.botX;

        const dz =
            player.z - match.botZ;

        const d =
            Math.sqrt(
                dx*dx + dz*dz
            );


        /*
          Seguir al jugador.
        */

        if(d > 1.8){

            match.botX +=
                dx/d*.055;

            match.botZ +=
                dz/d*.055;

        }


        /*
          Disparar cuando está cerca.
        */

        if(d <= 2){

            applyDamage(
                match,
                "BOT",
                player.id,
                1000
            );

        }

    }

},500);


/* =====================================================
   TERMINAR PARTIDA
===================================================== */

function endMatch(match){

    if(!match)
        return;

    for(const id of match.players){

        if(id === "BOT")
            continue;

        const p =
            players.get(id);

        if(p)
            p.match = null;

    }

    matches.delete(match.id);

}


/* =====================================================
   SALIR
===================================================== */

function leaveMatch(socket){

    if(!socket.playerId)
        return;

    const player =
        players.get(socket.playerId);

    if(!player)
        return;

    if(!player.match)
        return;

    const match =
        matches.get(player.match);

    if(!match){

        player.match = null;

        return;
    }


    const opponentId =
        match.players.find(
            id => id !== player.id
        );


    if(opponentId &&
       opponentId !== "BOT"){

        const opponent =
            players.get(opponentId);

        if(opponent){

            const opponentSocket =
                io.sockets.sockets.get(
                    opponent.socketId
                );

            if(opponentSocket){

                opponentSocket.emit(
                    "gameOver",
                    {
                        winner:opponent.id
                    }
                );

            }

        }

    }

    endMatch(match);

}


/* =====================================================
   SERVIDOR
===================================================== */

server.listen(
    PORT,
    () => {

        console.log(
            `Robot Arena ejecutándose en puerto ${PORT}`
        );

    }
);
