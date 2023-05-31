import * as vscode from "vscode";
import * as path from 'path';
import {User} from "./class/user";
import {closeWS, cursorMoved, getCursors, openWS, sendTextDelKey, sendTextReplaced, updateWS} from "./ws";
import {ChatViewProvider} from "./class/chatViewProvider";
import {ActiveUsersProvider, UserMapItem} from "./class/activeUsersProvider";
import {randomUUID} from "crypto";
import {Subject} from "rxjs";
import {bufferTime} from "rxjs/operators";
import {TextReplacedData} from "./interface/data";
import {buildSendTextReplacedMessage} from "./util/jsonUtils";

const users = new Map<string, User>();

const receivedDocumentChanges$ = new Subject<TextReplacedData>();
const textDocumentChanges$ = new Subject<vscode.TextDocumentContentChangeEvent>();
let receivedDocumentPipe: any;
let textDocumentPipe: any;
let receivedDocumentChangesBufferTime = vscode.workspace.getConfiguration("vscode-collab").get<number>("receivedDocumentChangesBufferTime") ?? 50;
let textDocumentChangesBufferTime = vscode.workspace.getConfiguration("vscode-collab").get<number>("textDocumentChangesBufferTime") ?? 150;

let chatViewProvider: ChatViewProvider;
let activeUsersProvider: ActiveUsersProvider;
let uuid = randomUUID();
let userId = process.env.USER_ID || process.env.USER || 'userId_' + uuid;
let userName = process.env.USER_NAME || "userName_" + uuid;
let userDisplayName = process.env.USER_DISPLAY_NAME || "userDisplayName_" + uuid;
let project = process.env.PROJECT_ID || process.env.PROJECT || 'default_project';
let textEdits: string[] = [];
let blockCursorUpdate = false;
let delKeyCounter = 0;
let lineCount = 0;
let delta = 0;
let rangeStart = new vscode.Position(0, 0);
let rangeEnd = new vscode.Position(0, 0);
let startRangeStart = new vscode.Position(0, 0);
let startRangeEnd = new vscode.Position(0, 0);
let bufferContent = "";


export async function activate(context: vscode.ExtensionContext) {
    openWS(userId, userName, userDisplayName, project);

    chatViewProvider = new ChatViewProvider(context.extensionUri);
    activeUsersProvider = new ActiveUsersProvider(users);

    vscode.window.createTreeView("vscode-collab-activeUsers", {treeDataProvider: activeUsersProvider});

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider));

    vscode.commands.registerCommand('vscode-collab-plugin.userMapItemClick', (item: UserMapItem) => {
        jumpToUser(item.handleClick());
    });

    vscode.window.onDidChangeTextEditorSelection(() => {
        if (blockCursorUpdate) {
            return;
        }
        sendCurrentCursor();
    });

    lineCount = getLineCount();

    updateReceivedDocumentPipe();
    updateTextDocumentPipe();

    vscode.workspace.onDidChangeTextDocument(changes => { // split this function to make it easier to read
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        for (let change of changes.contentChanges) {
            let range = change.range;
            let content = change.text;
            let uri = editor.document.uri;
            let ownText = true;

            textEdits.filter((edit, index) => {
                const jsonContent: string = JSON.parse(edit).content;
                if (
                    edit === JSON.stringify({uri, range, content}) ||
                    jsonContent.includes(content)
                ) {
                    ownText = false;
                    textEdits.splice(index, 1);
                }
            }); // cheap fix for the temp-storage of LatexWorkshop
            const regex = /^\[\d{2}:\d{2}:\d{2}\]\[/; // format [XX:XX:XX][ | Latexworkshop uses root.tex file as temp storage
            if (regex.test(change.text)) {
                ownText = false;
            }
            if (ownText) {
                blockCursorUpdate = true;
                textDocumentChanges$.next(change);
            }
        }
    });

    vscode.window.onDidChangeActiveTextEditor(() => {
        getCursors(userId, project);
        lineCount = getLineCount();
    });

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
        }
    });
}

function updateReceivedDocumentPipe() {
    if (receivedDocumentPipe) {
        receivedDocumentPipe.unsubscribe();
    }
    receivedDocumentPipe = receivedDocumentChanges$
        .pipe(
            bufferTime(receivedDocumentChangesBufferTime))
        .subscribe(async (changes) => {
            for (const change of changes) {
                await replaceText(change.pathName, change.from, change.to, change.content, change.userId);
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
        )
        .subscribe((changes) => {
            let editor = vscode.window.activeTextEditor;
            const delLinesCounter = lineCount - getLineCount();
            if (!editor) {
                return;
            }
            for (let change of changes) {
                let range = change.range;
                let content = change.text;

                updateBufferedParams(range.start, range.end, content);
            }

            let pathName = pathString(editor.document.fileName);

            if (delta > 0) {
                rangeStart = rangeStart.translate(rangeStart.line + delta, rangeStart.character);
                rangeEnd = rangeEnd.translate(rangeEnd.line + delta, rangeEnd.character);
            }

            if ((!rangeStart.isEqual(new vscode.Position(0, 0)) || !rangeEnd.isEqual(new vscode.Position(0, 0)) || bufferContent !== "") && changes.length > 0) {
                if (delKeyCounter > 1 && (rangeStart.isEqual(startRangeStart) && rangeEnd.isEqual(startRangeEnd))) {
                    const delCharCounter = delKeyCounter - delLinesCounter;
                    sendTextDelKey(pathName, rangeStart, delLinesCounter, delCharCounter, userId, project);
                } else {
                    sendTextReplaced(
                        pathName,
                        rangeStart,
                        rangeEnd,
                        bufferContent,
                        userId,
                        project
                    );
                }
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
    delta = 0;
    lineCount = getLineCount();
    bufferContent = "";
}

export function delKeyDelete(pathName: string, from: vscode.Position, delLinesCounter: number, delCharCounter: number, id: string) {
    const editor = vscode.window.activeTextEditor;
    let user = users.get(id);
    if (!editor || !user || userId === id || pathName.replace("\\", "/") !== pathString(editor.document.fileName).replace("\\", "/")) {
        return;
    }
    let to = new vscode.Position(from.line, from.character).translate(delLinesCounter, delCharCounter);
    let test: TextReplacedData = JSON.parse(buildSendTextReplacedMessage("textReplaced", pathName, from, to, "", id, project)); // rework
    receivedDocumentChanges$.next(test);
}

function getLineCount() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return 0;
    }
    return editor.document.lineCount;
}

export function userJoined(id: string, name: string, displayName: string) {
    users.set(id, new User(id, name, displayName));
    vscode.window.setStatusBarMessage("User: " + id + " joined", 5000);
    activeUsersProvider.refresh();
}

export function userLeft(userId: string) {
    if (users.has(userId)) {
        removeMarking(users.get(userId));
        users.delete(userId);
        vscode.window.setStatusBarMessage("User: " + userId + " left", 5000);
        activeUsersProvider.refresh();
    }
}

export function addActiveUsers(data: []) { //update the activeUsers logic to support id,name and displayName
    for (const {userId, userName, userDisplayName} of data) {
        users.set(userId, new User(userId, userName, userDisplayName));
    }
    activeUsersProvider.refresh();
}

function removeMarking(user: User | undefined) {
    let editor = vscode.window.activeTextEditor;
    if (user && editor) {
        editor.setDecorations(user.getColorIndicator(), []);
        editor.setDecorations(user.getNameTag(), []);
        editor.setDecorations(user.getSelection(), []);
        editor.setDecorations(user.getCursor(), []);
    }
}

export function markLine(pathName: string, cursor: vscode.Position, selectionEnd: vscode.Position, id: string) {
    let editor = vscode.window.activeTextEditor;
    let user = users.get(id);

    if (!editor || !user || userId === id) {
        return;
    }
    user.setPosition(pathName, cursor, selectionEnd);

    if (pathName.replace("\\", "/") !== pathString(editor.document.fileName).replace("\\", "/")) {
        return; // remove old cursor if there is an old cursor
    }
    let line = editor.document.lineAt(cursor.line);

    editor.setDecorations(user.getColorIndicator(), [line.range]);

    let selection = new vscode.Range(cursor, selectionEnd);
    editor.setDecorations(user.getSelection(), [selection]);

    let markerPosition = {
        range: new vscode.Range(cursor, cursor),
    };
    editor.setDecorations(user.getCursor(), [markerPosition]);

    editor.setDecorations(user.getNameTag(), [line.range]);
}

export function sendCurrentCursor() {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    let cursor = editor.selection.active;
    let pathName = pathString(editor.document.fileName);
    let selectionEnd = editor.selection.end;

    if (cursor === selectionEnd) { // flipps, if cursor is the end of the selection
        selectionEnd = editor.selection.start;
    }
    cursorMoved(pathName, cursor, selectionEnd, userId, project);
}

async function replaceText(pathName: string, from: vscode.Position, to: vscode.Position, content: string, id: string) {
    const editor = vscode.window.activeTextEditor;
    const user = users.get(id);

    if (!editor || !user || userId === id || pathName.replace("\\", "/") !== pathString(editor.document.fileName).replace("\\", "/")) {
        return;
    }

    const range = new vscode.Range(from, to);
    textEdits.push(JSON.stringify({uri: editor.document.uri, range, content}));

    const edit = new vscode.WorkspaceEdit();
    edit.replace(editor.document.uri, range, content);

    vscode.workspace.applyEdit(edit).then((fulfilled) => {
        if (fulfilled) {
            let cursorPosition = new vscode.Position(from.line, from.character + content.length);
            if (content.includes("\n")) {
                cursorPosition = new vscode.Position(to.line + content.length, 0);
            }
            markLine(pathName, cursorPosition, cursorPosition, id);
        } else {
            const back: TextReplacedData = {pathName, from, to, content, userId: id, project};
            receivedDocumentChanges$.next(back);
        }
        return Promise;
    });
}

function pathString(path: string) {
    if (vscode.workspace.workspaceFolders !== undefined) {
        const projectRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        path = path.replace(projectRoot, "");
        return path;
    }
    return "";
}


function jumpToUser(userId: string) {
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
