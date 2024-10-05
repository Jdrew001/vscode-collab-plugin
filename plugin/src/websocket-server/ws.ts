import WebSocket, {WebSocketServer} from 'ws';
import {Message} from "./interface/message";
import {Data} from "./interface/data";
import {User} from "./interface/user";
import path from 'path';
import {randomUUID} from "crypto";
import os from 'os';
import { userJoinedEx } from '../extension';

const crdsMap = new Map<string, string[]>
function getLocalIpAddress(): string | undefined {
    const interfaces = os.networkInterfaces();  // Get network interfaces

    for (const ifaceName in interfaces) {
        const iface = interfaces[ifaceName];

        if (iface) {
            for (const alias of iface) {
                // Check for IPv4 and ignore internal (i.e., 127.0.0.1)
                if (alias.family === 'IPv4' && !alias.internal) {
                    return alias.address;
                }
            }
        }
    }
    return undefined;
}

let wss: WebSocketServer;
const rooms = new Map<string, Set<User>>();

// Function to get the local IP address

export function initializeWebSocket() {
    const wss = new WebSocketServer({
        host: getLocalIpAddress(),
        port: +(process.env.PORT || 8080),
        path: process.env.WS_PATH,
    });

    wss.on('listening', () => {
        console.log(`WebSocket server running on ws://${wss.options.host}:${wss.options.port}.`);
    });
    
    wss.on('connection', function connection(ws) {
        ws.on('message', (data: any) => {
            console.log(Buffer.from(data).toString() + "\n");
            const msg: Message = JSON.parse(Buffer.from(data).toString());
            handleMessage(msg, ws);
        });
    
        ws.on('close', (code, reason) => {
            removeWs(ws);
            console.log(`Connection closed: code ${code}, reason: ${reason}`);
        });
    });
    
    wss.on('error', (error) => {
        console.log(`Error: ${error}`);
    });
}

function handleMessage(msg: Message, ws: WebSocket) {
    switch (msg.operation) {
        case "userJoined":
            userJoined(msg, ws);
            broadcastMessage(msg);
            return sendUserList(msg, ws);
        case "userLeft":
        case "chatMsg":
        case "getCursors":
            return broadcastMessage(msg);
        case "cursorMoved":
            checkForFile(msg, ws);
            return broadcastMessage(msg);
        case "textReplaced":
            checkForFile(msg, ws);
            updateIdArray(msg);
            return broadcastMessage(msg);
        case "sendFile":
            createFileID(msg);
            break;
        default:
            console.error('unhandled message: %s', msg);
    }
}


function userJoined(msg: Message, ws: WebSocket) {
    let data: Data = msg.data;
    let project = data.project;
    let userId = data.userId+"1";
    let userName = data.userName;
    let userDisplayName = data.userDisplayName;
    checkForRoom(project, userId, userName, userDisplayName, ws);
    userJoinedEx(userId, userName, userDisplayName);

}

function sendUserList(msg: Message, ws: WebSocket) {
    let data: Data = msg.data;
    let project = data.project;
    let users = rooms.get(project);
    console.log(users);
    let userNames = [];

    if (users) {
        for (const user of users) {
            userNames.push({userId: user.userId, userName: user.userName, userDisplayName: user.userDisplayName});
        }
    }
    ws.send(JSON.stringify({operation: "activeUsers", data: userNames}))
}

function broadcastMessage(msg: Message) {
    msg.time = new Date().getTime();

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg));
        }
    });
}

function checkForRoom(project: string, userId: string, userName: string, userDisplayName: string, ws: WebSocket) {
    let room = rooms.get(project);
    if (!room) {
        room = new Set<User>();
        rooms.set(project, room)
    }
    room.add({userId: userId, userName: userName, userDisplayName: userDisplayName, ws});
}

function removeWs(ws: WebSocket) {
    for (const key of rooms.keys()) {
        const room = rooms.get(key)
        removeUser(room, key, ws)
    }
}

function removeUser(room: Set<User> | undefined, projectName: string, ws: WebSocket) {
    if (!room) {
        return
    }
    for (const user of room) {
        if (user.ws === ws) {
            room.delete(user);
        }
    }
    if (room.size == 0) {
        rooms.delete(projectName);
        for (const key of crdsMap.keys()) {
            if (key.startsWith(projectName)) {
                crdsMap.delete(key);
            }
        }
    }
}

function checkForFile(msg: Message, ws: WebSocket) {
    const key = path.join(msg.data.project, msg.data.pathName);
    if (crdsMap.get(key)) {
        return;
    }
    sendFileRequest(ws)
}

function sendFileRequest(ws: WebSocket) {
    const msg = JSON.stringify({operation: "sendFile"});
    ws.send(msg);
}

function createFileID(msg: Message) {
    const project = msg.data.project;
    const pathName = msg.data.pathName
    const key = path.join(project, pathName);
    let idArray: string[] = []
    if (!crdsMap.get(key)) {
        for (let i = 0; i < msg.data.lineCount; i++) {
            idArray[i] = randomUUID();
        }
        crdsMap.set(key, idArray);
    } else {
        idArray = crdsMap.get(key) ?? []
    }
    sendIdArray(pathName, project, idArray);
}

function sendIdArray(pathName: string, project: string, idArray: string[]) {
    const msg: Message = {operation: "idArray", data: {project, pathName, idArray}, time: new Date().getTime()}
    broadcastMessage(msg);
}

function updateIdArray(msg: Message) {
    const project = msg.data.project;
    const pathName = msg.data.pathName
    const key = path.join(project, pathName);
    const idArray = crdsMap.get(key);
    if (!idArray) {
        return
    }
    const fromIndex = idArray.lastIndexOf(msg.data.from.line);
    const toIndex = idArray.lastIndexOf(msg.data.to.line);
    if (fromIndex === -1 || toIndex === -1) {
        return
    }
    if (msg.data.content !== "") {
        if (msg.data.newLineIds !== undefined) {
            idArray.splice(fromIndex + 1, 0, ...msg.data.newLineIds);
        }
    } else {
        idArray.splice(fromIndex + 1, toIndex - fromIndex);
    }
    crdsMap.set(key, idArray);
}
