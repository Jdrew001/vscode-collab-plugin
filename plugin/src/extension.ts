import * as vscode from "vscode";
import * as path from 'path';
import {User} from "./class/user";
import {closeWS, cursorMoved, getCursors, openWS, sendFile, sendTextReplaced, updateWS} from "./ws";
import {ChatViewProvider} from "./class/chatViewProvider";
import {ActiveUsersProvider, UserMapItem} from "./class/activeUsersProvider";
import {randomUUID} from "crypto";
import {Subject} from "rxjs";
import {bufferTime, filter} from "rxjs/operators";
import {TextReplacedData} from "./interface/data";
import {Position} from "./interface/position";
import { ServerControlProvider } from "./class/serverControlProvider";
import { initializeWebSocket } from "./websocket-server/ws";

const users = new Map<string, User>();

const receivedDocumentChanges$ = new Subject<TextReplacedData>();
const textDocumentChanges$ = new Subject<vscode.TextDocumentContentChangeEvent>();
let receivedDocumentPipe: any;
let textDocumentPipe: any;
let receivedDocumentChangesBufferTime = vscode.workspace.getConfiguration("vscode-collab").get<number>("receivedDocumentChangesBufferTime") ?? 50;
let textDocumentChangesBufferTime = vscode.workspace.getConfiguration("vscode-collab").get<number>("textDocumentChangesBufferTime") ?? 150;
let userDisplayMode = vscode.workspace.getConfiguration("vscode-collab").get<string>("displayMode") ?? "name";

let chatViewProvider: ChatViewProvider;
let activeUsersProvider: ActiveUsersProvider;
let serverControlProvider: ServerControlProvider;
const uuid = randomUUID();
const userId = process.env.USER_ID || process.env.USER || 'userId_' + uuid;
const userName = process.env.USER_NAME || "userName_" + uuid;
const userDisplayName = process.env.USER_DISPLAY_NAME || "userDisplayName_" + uuid;
const project = process.env.PROJECT_ID || process.env.PROJECT || 'default_project';
const textEdits: string[] = [];
let blockCursorUpdate = false;
let delKeyCounter = 0;
let lineCount = 0;
let rangeStart = new vscode.Position(0, 0);
let rangeEnd = new vscode.Position(0, 0);
let startRangeStart = new vscode.Position(0, 0);
let startRangeEnd = new vscode.Position(0, 0);
let bufferContent = "";

let idArray: string[];
let newLineIds: string[] = [];


export async function activate(context: vscode.ExtensionContext) {

    // Chat and Active Users Providers
    chatViewProvider = new ChatViewProvider(context.extensionUri);
    activeUsersProvider = new ActiveUsersProvider(users, userDisplayMode);
    serverControlProvider = new ServerControlProvider();

    // Create Tree View for Active Users
    vscode.window.createTreeView("vscode-collab-activeUsers", { treeDataProvider: activeUsersProvider });
    vscode.window.createTreeView("vscode-collab-serverControl", { treeDataProvider: serverControlProvider });

    // Register Webview for Chat
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider)
    );

    // Server Control - Status bar item with IP address
    const ipAddress = 'localhost';
    const serverPort = 8080;  // Assuming your server will run on port 8080

    // Create a status bar button to start the server
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'vscode-collab.startServerWithLAN';
    statusBarItem.text = `Start Collab Server (LAN) ${ipAddress}:${serverPort}`;
    statusBarItem.show();

    // Register the command to start the server
    vscode.commands.registerCommand('vscode-collab.startServerWithLAN', () => {
        initializeWebSocket();
        vscode.window.showInformationMessage(`Collab Server started at ${ipAddress}:${serverPort}`);
        setTimeout(() => {openWS(userId, userName, userDisplayName, project)}, 250);
    });

    // Register the command to join an existing server
    vscode.commands.registerCommand('vscode-collab.joinServer', () => {
        let wsAddress = `ws://192.168.12.152:8080`;
        setTimeout(() => {
            openWS(userId, userName, userDisplayName, project);
            vscode.window.showInformationMessage(`Joined Collab Server at ${wsAddress}`);
        }, 250);
    });

    context.subscriptions.push(statusBarItem);

    // User Map Item Click Command
    vscode.commands.registerCommand('vscode-collab-plugin.userMapItemClick', (item: UserMapItem) => {
        jumpToUser(item.handleClick());
    });

    // Handle cursor updates
    vscode.window.onDidChangeTextEditorSelection(() => {
        if (blockCursorUpdate) {
            return;
        }
        sendCurrentCursor();
    });

    lineCount = getLineCount();
    updateReceivedDocumentPipe();
    updateTextDocumentPipe();

    // Handle document changes
    vscode.workspace.onDidChangeTextDocument(changes => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        for (const change of changes.contentChanges) {
            const range = change.range;
            const content = change.text;
            const uri = editor.document.uri;
            let ownText = true;

            textEdits.filter((edit, index) => {
                const jsonContent: string = JSON.parse(edit).content;
                if (edit === JSON.stringify({ uri, range, content }) || jsonContent.includes(content)) {
                    ownText = false;
                    textEdits.splice(index, 1);
                }
            });

            if (ownText) {
                blockCursorUpdate = true;
                if (content !== "") {
                    const regex = /\n/g;
                    const enterCount = content.match(regex)?.length ?? 0;
                    const tmpIds: string[] = [];
                    for (let i = 0; i < enterCount; i++) {
                        const newUUID = randomUUID();
                        newLineIds.push(newUUID);
                        tmpIds.push(newUUID);
                    }
                    if (enterCount > 0) {
                        idArray.splice(range.end.line + 1, 0, ...tmpIds);
                    }
                }
                textDocumentChanges$.next(change);
            }
        }
    });

    // Handle active text editor change
    vscode.window.onDidChangeActiveTextEditor(() => {
        onActiveEditor();
    });

    // Handle configuration changes
    vscode.workspace.onDidChangeConfiguration(event => {
        const rootConfiguration = "vscode-collab.";
        const configuration = event.affectsConfiguration.bind(event);

        switch (true) {
            case configuration(rootConfiguration + "ws-address"): {
                const wsAddress = vscode.workspace.getConfiguration("vscode-collab").get<string>("ws-address");
                if (wsAddress !== undefined) {
                    updateWS(wsAddress);
                }
                break;
            }
            case configuration(rootConfiguration + "receivedDocumentChangesBufferTime"): {
                const newBufferTime = vscode.workspace.getConfiguration("vscode-collab").get<number>("receivedDocumentChangesBufferTime");
                if (newBufferTime !== undefined) {
                    receivedDocumentChangesBufferTime = newBufferTime;
                    updateReceivedDocumentPipe();
                }
                break;
            }
            case configuration(rootConfiguration + "textDocumentChangesBufferTime"): {
                const newBufferTime = vscode.workspace.getConfiguration("vscode-collab").get<number>("textDocumentChangesBufferTime");
                if (newBufferTime !== undefined) {
                    textDocumentChangesBufferTime = newBufferTime;
                    updateTextDocumentPipe();
                }
                break;
            }
            case configuration(rootConfiguration + "displayMode"): {
                const newDisplayMode = vscode.workspace.getConfiguration("vscode-collab").get<string>("displayMode") ?? "name";
                if (newDisplayMode !== undefined) {
                    userDisplayMode = newDisplayMode;
                    activeUsersProvider.setDisplayMode(newDisplayMode);
                    activeUsersProvider.refresh();
                    chatViewProvider.chatUpdateDisplayMode(newDisplayMode);
                    for (const user of users) {
                        const path = user[1].position.path;
                        const cursor = user[1].position.cursor;
                        const selectionEnd = user[1].position.selectionEnd;
                        const id = user[0];
                        markLine(path, cursor, selectionEnd, id);
                    }
                }
                break;
            }
        }
    });
}

function updateReceivedDocumentPipe() {
    if (receivedDocumentPipe) {
        receivedDocumentPipe.unsubscribe();
    }
    receivedDocumentPipe = receivedDocumentChanges$
        .pipe(
            bufferTime(receivedDocumentChangesBufferTime),
            filter(changes => changes.length > 0)
        )
        .subscribe(async (changes) => {
            for (const change of changes) {
                await replaceText(change.pathName, change.from, change.to, change.content, change.newLineIds, change.userId);
            }
        });
}

function updateTextDocumentPipe() {
    if (textDocumentPipe) {
        textDocumentPipe.unsubscribe();
    }
    textDocumentPipe = textDocumentChanges$
        .pipe(
            bufferTime(textDocumentChangesBufferTime),
            filter(changes => changes.length > 0),
        )
        .subscribe((changes) => {
            const editor = vscode.window.activeTextEditor;
            const delLinesCounter = lineCount - getLineCount();
            if (!editor) {
                return;
            }
            for (const change of changes) {
                const range = change.range;
                const content = change.text;

                updateBufferedParams(range.start, range.end, content);
            }
            if (changes.length > 1 && bufferContent !== "") {
                rangeEnd = rangeStart;
            }
            const pathName = pathString(editor.document.fileName);

            if ((!rangeStart.isEqual(new vscode.Position(0, 0)) || !rangeEnd.isEqual(new vscode.Position(0, 0)) || bufferContent !== "") && changes.length > 0) {
                const start: Position = {line: idArray[rangeStart.line], character: rangeStart.character};
                if (delKeyCounter > 1 && (rangeStart.isEqual(startRangeStart) && rangeEnd.isEqual(startRangeEnd))) {
                    const delCharCounter = delKeyCounter - delLinesCounter;
                    rangeEnd = rangeStart.translate(delLinesCounter, delCharCounter);
                }
                const end: Position = {line: idArray[rangeEnd.line], character: rangeEnd.character};
                if (bufferContent === "") {
                    idArray.splice(rangeStart.line + 1, rangeEnd.line - rangeStart.line);
                }
                sendTextReplaced(
                    pathName,
                    start,
                    end,
                    bufferContent,
                    newLineIds,
                    userId,
                    project
                );

            }
            clearBufferedParams();
            blockCursorUpdate = false;
        });
}


function updateBufferedParams(start: vscode.Position, end: vscode.Position, content: string) {  // rebuild logic to work with "del"-key
    if (rangeStart.isEqual(new vscode.Position(0, 0)) && rangeEnd.isEqual(new vscode.Position(0, 0))) {
        startRangeStart = start;
        startRangeEnd = end;
    }
    if (rangeStart.isAfter(start) || rangeStart.isEqual(new vscode.Position(0, 0))) {
        rangeStart = start;
    }
    if (rangeEnd.isEqual(new vscode.Position(0, 0))) {
        rangeEnd = end;
    }
    if (content === "") {
        if (bufferContent.length > 0) {
            bufferContent = bufferContent.substring(0, bufferContent.length - 1);
            return;
        } else {
            if (rangeStart.isEqual(startRangeStart) && rangeEnd.isEqual(startRangeEnd)) {
                delKeyCounter += 1;
                return;
            }
        }
    } else {
        bufferContent += content;
        return;
    }
}

function clearBufferedParams() {
    rangeStart = new vscode.Position(0, 0);
    rangeEnd = new vscode.Position(0, 0);
    delKeyCounter = 0;
    lineCount = getLineCount();
    bufferContent = "";
    newLineIds = [];
}

function getLineCount() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return 0;
    }
    return editor.document.lineCount;
}

export function userJoinedEx(id: string, name: string, displayName: string) {
    users.set(id, new User(id, name, displayName));
    let label = id;
    if (userDisplayMode === "name") {
        label = name;
    }
    if (userDisplayMode === "displayName") {
        label = displayName;
    }
    vscode.window.setStatusBarMessage("User: " + label + " joined", 5000);
    activeUsersProvider.refresh();
}

export function userLeft(id: string) {
    const user = users.get(id);
    if (user) {
        let label = id;
        if (userDisplayMode === "name") {
            label = user.name;
        }
        if (userDisplayMode === "displayName") {
            label = user.displayName;
        }
        removeMarking(user);
        users.delete(id);
        vscode.window.setStatusBarMessage("User: " + label + " left", 5000);
        activeUsersProvider.refresh();
    }
}

export function addActiveUsers(data: []) {
    for (const {userId, userName, userDisplayName} of data) {
        users.set(userId, new User(userId, userName, userDisplayName));
    }
    activeUsersProvider.refresh();
}

function removeMarking(user: User | undefined) {
    const editor = vscode.window.activeTextEditor;
    if (user && editor) {
        editor.setDecorations(user.getColorIndicator(), []);
        editor.setDecorations(user.getNameTag(userDisplayMode), []);
        editor.setDecorations(user.getSelection(), []);
        editor.setDecorations(user.getCursor(), []);
    }
}

export function markLine(pathName: string, cursor: vscode.Position, selectionEnd: vscode.Position, id: string) {
    try {
        const editor = vscode.window.activeTextEditor;
        const user = users.get(id);

        if (!editor || !user || userId === id) {
            return;
        }
        user.setPosition(pathName, cursor, selectionEnd);

        if (pathName.replace("\\", "/") !== pathString(editor.document.fileName).replace("\\", "/")) {
            removeMarking(user);
            return;
        }
        const line = editor.document.lineAt(cursor.line);

        editor.setDecorations(user.getColorIndicator(), [line.range]);

        const selection = new vscode.Range(cursor, selectionEnd);
        editor.setDecorations(user.getSelection(), [selection]);

        const markerPosition = {
            range: new vscode.Range(cursor, cursor),
        };
        editor.setDecorations(user.getCursor(), [markerPosition]);

        editor.setDecorations(user.getNameTag(userDisplayMode), [line.range]);
    } catch (e) {
        console.log(e);
    }
}

export function sendCurrentCursor(id?: string) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || userId === id) {
        return;
    }
    const cursor = editor.selection.active;
    const pathName = pathString(editor.document.fileName);
    let selectionEnd = editor.selection.end;

    if (cursor === selectionEnd) { // flips, if cursor is the end of the selection
        selectionEnd = editor.selection.start;
    }
    cursorMoved(pathName, cursor, selectionEnd, userId, project);
}

async function replaceText(pathName: string, from: Position, to: Position, content: string, lineIds: string[], id: string) {
    try {
        const editor = vscode.window.activeTextEditor;
        const user = users.get(id);

        if (!editor || !user || userId === id || pathName.replace("\\", "/") !== pathString(editor.document.fileName).replace("\\", "/")) {
            return;
        }
        const fromLine = idArray.lastIndexOf(from.line);
        const toLine = idArray.lastIndexOf(to.line);
        if (fromLine === -1 || toLine === -1) {
            const back: TextReplacedData = {pathName, from, to, content, newLineIds: lineIds, userId: id, project};
            receivedDocumentChanges$.next(back);
            return;
        }
        const fromPosition = new vscode.Position(fromLine, from.character);
        const toPosition = new vscode.Position(toLine, to.character);
        const range = new vscode.Range(fromPosition, toPosition);
        textEdits.push(JSON.stringify({uri: editor.document.uri, range, content}));

        const edit = new vscode.WorkspaceEdit();
        edit.replace(editor.document.uri, range, content);

        vscode.workspace.applyEdit(edit).then((fulfilled) => {
            if (fulfilled) {
                let cursorPosition = new vscode.Position(fromPosition.line, from.character + content.length);
                if (content.includes("\n")) {
                    cursorPosition = new vscode.Position(toPosition.line + content.length, 0);
                }
                markLine(pathName, cursorPosition, cursorPosition, id);
                if (content !== "") {
                    if (lineIds !== undefined) {
                        idArray.splice(fromPosition.line + 1, 0, ...lineIds);
                    }
                } else {
                    idArray.splice(fromPosition.line + 1, toPosition.line - fromPosition.line);
                }
            } else {
                const back: TextReplacedData = {pathName, from, to, content, newLineIds: lineIds, userId: id, project};
                receivedDocumentChanges$.next(back);
            }
            return;
        });
    } catch (e) {
        console.log(e);
    }
}

function pathString(path: string) {
    if (vscode.workspace.workspaceFolders !== undefined) {
        const projectRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        path = path.replace(projectRoot, "");
        return path;
    }
    return "";
}


function jumpToUser(userId: string) { // needs work
    const editor = vscode.window.activeTextEditor;
    const user = users.get(userId);
    if (user && editor) {
        const position = user.getPosition();
        if (position.path.replace("\\", "/") !== editor.document.fileName.replace("\\", "/")) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (workspaceFolder) {
                const rootPath = workspaceFolder.uri.fsPath;
                const filePath = path.join(rootPath, position.path);
                vscode.workspace.openTextDocument(vscode.Uri.file(filePath)).then((document) => {
                    vscode.window.showTextDocument(document).then((textEditor) => {
                        const range = new vscode.Range(position.cursor, position.cursor);
                        textEditor.revealRange(range);
                    });
                });
            }
        } else {
            const range = new vscode.Range(position.cursor, position.cursor);
            editor.revealRange(range);
        }
    }
}

export function jumpToLine(lineNumber: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const range = editor.document.lineAt(lineNumber - 1).range;
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(range.start, range.end);
}

export function clearUsers() {
    users.forEach((user) => {
        removeMarking(user);
    });
    users.clear();
}

export function getFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const pathName = pathString(editor.document.fileName);
    const lineCount = editor.document.lineCount;
    sendFile(pathName, lineCount, userId, project);
}

export function updateIdArray(pathName: string, array: [string]) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || pathName.replace("\\", "/") !== pathString(editor.document.fileName).replace("\\", "/")) {
        return;
    }
    idArray = array;
}

export function onActiveEditor() {
    sendCurrentCursor();
    getCursors(userId, project);
    getFile();
    lineCount = getLineCount();
}

export function getUsers() {
    return users;
}

export function getUserId() {
    return userId;
}

export function getUserName() {
    return userName;
}

export function getUserDisplayName() {
    return userDisplayName;
}

export function getProjectId() {
    return project;
}

export function getUserDisplayMode() {
    return userDisplayMode;
}

export function getChatViewProvider() {
    return chatViewProvider;
}

export function getReceivedDocumentChanges() {
    return receivedDocumentChanges$;
}

export function deactivate() {
    return new Promise(() => {
        closeWS(userId, project);
    });
}
