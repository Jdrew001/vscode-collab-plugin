import {markLine, replaceText, userJoined, userLeft} from "./extension";
import {CursorMovedData, TextReplacedData} from "./interface/data";
import {message} from "./interface/message";
import {
    buildCursorMovedMessage,
    buildTextReplacedMessage,
    buildUserMessage
} from "./util/jsonUtils";

const webSocket = require('ws');

let ws = new webSocket('ws://localhost:8080');
let wsClose = false;


export function openWS(name: string, project: string) {
    ws = new webSocket('ws://localhost:8080');
    ws.on('open', function open() {
        console.log("connected");

        ws.on('message', function incoming(data: any) {
            const msg: message = JSON.parse(Buffer.from(data).toString());
            console.log(JSON.stringify(msg));
            handleMessage(msg);
        });

        ws.send(buildUserMessage("userJoined", name, project));
    });

    ws.on('close', function close() {
        if (!wsClose) {
            // Starte den Wiederverbindungsprozess nach 10 Sekunden
            console.log('Verbindung geschlossen. retry in 10s');
            setTimeout(() => {
                openWS(name, project);
            }, 10000);
        }
    });

    ws.on('error', (error: Error) => {
        setTimeout(() => {
            console.log(error);
        }, 2000);
    });
}


export function closeWS(name: string, project: string) {
    wsClose = true;
    ws.send(buildUserMessage("userLeft", name, project));
    ws.close(1000, 'connection was closed by the user');
}

export function cursorMoved(pathName: string, lineNumber: number, position: number, selectionLine: number, selectionPosition: number, name: string, project: string) {
    try {
        ws.send(buildCursorMovedMessage(pathName, lineNumber, position, selectionLine, selectionPosition, name, project));
    } catch (Error) {
        console.log(Error);
    }
}

export function textReplaced(pathName: string, fromLine: number, fromPosition: number, toLine: number, toPosition: number, content: string, name: string, project: string) {
    try {
        ws.send(buildTextReplacedMessage(pathName, fromLine, fromPosition, toLine, toPosition, content, name, project));
    } catch (Error) {
        console.log(Error);
    }
}

function handleMessage(msg: message) {
    console.log("handleMessage called");

    if (msg.operation === "userJoined") {
        let data: CursorMovedData = msg.data;
        userJoined(data.name);
        return;
    }

    if (msg.operation === "userLeft") {
        let data: CursorMovedData = msg.data;
        userLeft(data.name);
        return;
    }

    if (msg.operation === "cursorMoved") {
        let data: CursorMovedData = msg.data;
        markLine(data.pathName, data.lineNumber, data.position, data.selectionLine, data.selectionPosition, data.name);
        return;
    }
    if (msg.operation === "textReplaced") {
        let data: TextReplacedData = msg.data;
        replaceText(data.pathName, data.fromLine, data.fromPosition, data.toLine, data.toPosition, data.content, data.name,);
        return;
    }
}
